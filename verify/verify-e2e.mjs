import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverOAuthMetadata } from '../packages/npm-foragent/src/oauth.mjs';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function startMockForAgentServer() {
  const clients = new Map();
  const authCodes = new Map();
  const tokens = new Map();
  const refreshTokens = new Map();
  const stats = { register: 0, authorize: 0, tokenAuthCode: 0, tokenRefresh: 0, mcpCalls: 0, deletes: 0, seenSessions: new Set() };

  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url || '/', origin);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');

    if (req.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource/mcp' || url.pathname === '/.well-known/oauth-protected-resource')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        resource: `${origin}/mcp`,
        authorization_servers: [`${origin}/`],
        scopes_supported: ['foragent:read', 'foragent:call', 'foragent:receive'],
        resource_name: 'ForAgent',
        resource_documentation: 'https://foragent.io/manual',
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        issuer: `${origin}/`,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['foragent:read', 'foragent:call', 'foragent:receive'],
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      stats.register += 1;
      const body = JSON.parse(rawBody);
      assert.ok(Array.isArray(body.redirect_uris) && body.redirect_uris.length >= 1, 'redirect_uris required');
      const clientId = `cli_${randomBytes(6).toString('hex')}`;
      clients.set(clientId, body);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: body.redirect_uris,
        grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        client_name: body.client_name,
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/authorize') {
      stats.authorize += 1;
      const clientId = url.searchParams.get('client_id');
      const redirectUri = url.searchParams.get('redirect_uri');
      const codeChallenge = url.searchParams.get('code_challenge');
      const method = url.searchParams.get('code_challenge_method');
      const state = url.searchParams.get('state');
      assert.ok(clients.has(clientId), 'registered client required');
      assert.equal(method, 'S256', 'PKCE S256 required');
      assert.ok(codeChallenge, 'code_challenge required');

      const code = `code_${randomBytes(8).toString('hex')}`;
      authCodes.set(code, { clientId, redirectUri, codeChallenge });

      const cb = new URL(redirectUri);
      cb.searchParams.set('code', code);
      if (state) cb.searchParams.set('state', state);
      res.writeHead(302, { Location: cb.toString() });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      const form = new URLSearchParams(rawBody);
      const grantType = form.get('grant_type');
      if (grantType === 'authorization_code') {
        stats.tokenAuthCode += 1;
        const code = form.get('code');
        const verifier = form.get('code_verifier');
        const record = authCodes.get(code);
        assert.ok(record, 'valid authorization code');
        const expected = b64url(createHash('sha256').update(verifier || '').digest());
        assert.equal(expected, record.codeChallenge, 'PKCE S256 mismatch');
        authCodes.delete(code);

        const accessToken = `tok_${randomBytes(10).toString('hex')}`;
        const refreshToken = `ref_${randomBytes(10).toString('hex')}`;
        tokens.set(accessToken, { active: true });
        refreshTokens.set(refreshToken, { clientId: record.clientId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refreshToken,
          scope: 'foragent:read foragent:call foragent:receive',
        }));
        return;
      }
      if (grantType === 'refresh_token') {
        stats.tokenRefresh += 1;
        const oldRef = form.get('refresh_token');
        assert.ok(refreshTokens.has(oldRef), 'valid refresh_token');
        const rec = refreshTokens.get(oldRef);
        refreshTokens.delete(oldRef);
        const accessToken = `tok_${randomBytes(10).toString('hex')}`;
        const nextRefresh = `ref_${randomBytes(10).toString('hex')}`;
        tokens.set(accessToken, { active: true });
        refreshTokens.set(nextRefresh, rec);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: nextRefresh,
        }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
      return;
    }

    if (url.pathname === '/mcp') {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token || !tokens.get(token)?.active) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        });
        res.end(JSON.stringify({ error: 'invalid_token' }));
        return;
      }

      if (req.method === 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }
      if (req.method === 'DELETE') {
        stats.deletes += 1;
        res.writeHead(204);
        res.end();
        return;
      }

      stats.mcpCalls += 1;
      const sid = req.headers['mcp-session-id'];
      if (sid) stats.seenSessions.add(sid);
      const rpc = JSON.parse(rawBody);

      if (rpc.method === 'initialize') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'sess_test_12345',
        });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'io.foragent/foragent', version: '1.0.0' },
          },
        }));
        return;
      }

      if (rpc.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }

      if (rpc.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            tools: [
              { name: 'foragent_list_my_agents', description: 'List my agent numbers', inputSchema: { type: 'object', properties: {} } },
              { name: 'foragent_doctor', description: 'Check ForAgent connection', inputSchema: { type: 'object', properties: {} } },
            ],
          },
        }));
        return;
      }

      if (rpc.method === 'tools/call' && rpc.params?.name === 'foragent_doctor') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { content: [{ type: 'text', text: 'ForAgent connection healthy (JSON).' }] },
        }));
        return;
      }

      if (rpc.method === 'tools/call' && rpc.params?.name === 'foragent_list_my_agents') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const payload = JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { content: [{ type: 'text', text: 'Numbers: @12 (SSE verified).' }] },
        });
        res.end(`event: message\ndata: ${payload}\n\n`);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    mcpUrl: `${origin}/mcp`,
    stats,
    invalidateAllAccessTokens() {
      for (const [, val] of tokens) val.active = false;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function runBridgeSession({ cmd, args, env, expectBrowserFlow }) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env, FORAGENT_ACCESS_TOKEN: '', FORAGENT_NO_BROWSER: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = [];
  let stdoutBuf = '';
  let stderrTail = '';
  let browserOpened = false;
  let preconnect;

  const waitForResponseId = (id, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const found = responses.find((m) => m.id === id);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout waiting for response id=${id}.`));
      }
      setTimeout(check, 25);
    };
    check();
  });

  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    stderrTail = (stderrTail + text).slice(-512);
    if (expectBrowserFlow && !browserOpened) {
      const match = stderrTail.match(/https?:\/\/127\.0\.0\.1:\d+\/sign-in\b/);
      if (match) {
        browserOpened = true;
        // Browsers can open a spare loopback connection ahead of a navigation.
        const signIn = new URL(match[0]);
        preconnect = createConnection(Number(signIn.port), signIn.hostname);
        preconnect.on('error', () => {});
        preconnect.once('connect', () => fetch(signIn).then(r => r.body?.cancel()).catch(() => {}));
      }
    }
  });

  try {
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-test', version: '1.0.0' } },
    });
    const initRes = await waitForResponseId(1);
    assert.equal(initRes.result.serverInfo.name, 'io.foragent/foragent');

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listRes = await waitForResponseId(2);
    assert.equal(listRes.result.tools.length, 2);

    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'foragent_doctor', arguments: {} } });
    const jsonCall = await waitForResponseId(3);
    assert.match(jsonCall.result.content[0].text, /JSON/);

    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'foragent_list_my_agents', arguments: {} } });
    const sseCall = await waitForResponseId(4);
    assert.match(sseCall.result.content[0].text, /SSE verified/);

    child.stdin.end();
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Bridge did not exit after stdin closed.')), 6000);
      child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(exitCode, 0, `Bridge exited with ${exitCode}.`);
    if (expectBrowserFlow) assert.equal(browserOpened, true, 'Expected browser OAuth flow to trigger');
  } finally {
    preconnect?.destroy();
    if (child.exitCode === null) child.kill();
  }
}

async function liveDiscovery() {
  console.log('1) Live read-only discovery check against https://foragent.io/mcp ...');
  const liveProbe = await fetch('https://foragent.io/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'verify', version: '1.0' } } }),
  });
  assert.equal(liveProbe.status, 401);
  const liveWwwAuth = liveProbe.headers.get('www-authenticate');
  const liveMeta = await discoverOAuthMetadata('https://foragent.io/mcp', liveWwwAuth);
  assert.equal(liveMeta.resource, 'https://foragent.io/mcp');
  assert.equal(liveMeta.authorizationEndpoint, 'https://foragent.io/authorize');
  assert.equal(liveMeta.tokenEndpoint, 'https://foragent.io/token');
  assert.equal(liveMeta.registrationEndpoint, 'https://foragent.io/register');
  console.log('   PASS: Live 401 -> RFC 9728 -> RFC 8414 OAuth discovery verified (zero prod mutation).');

}

async function main() {
  if (process.argv.includes('--live-discovery')) await liveDiscovery();
  const tmp = mkdtempSync(join(tmpdir(), 'foragent-phase2-e2e-'));
  const mock = await startMockForAgentServer();
  try {
    const nodeAuthFile = join(tmp, 'node-auth.json');
    const nodeCli = fileURLToPath(new URL('../packages/npm-foragent/bin/cli.mjs', import.meta.url));

    console.log('2) Node (npm:foragent) cold-start OAuth DCR + PKCE S256 + stdio <-> Streamable HTTP (JSON & SSE) ...');
    await runBridgeSession({
      cmd: process.execPath,
      args: [nodeCli, '--url', mock.mcpUrl],
      env: { FORAGENT_AUTH_FILE: nodeAuthFile },
      expectBrowserFlow: true,
    });
    assert.equal(mock.stats.register, 1);
    assert.equal(mock.stats.tokenAuthCode, 1);
    assert.ok(mock.stats.seenSessions.has('sess_test_12345'), 'Mcp-Session-Id must be forwarded');
    assert.equal(mock.stats.deletes, 1, 'DELETE /mcp must fire on shutdown');
    assert.equal(statSync(nodeAuthFile).mode & 0o777, 0o600, 'auth file must be 0600');
    console.log('   PASS: Node cold-start OAuth + JSON/SSE + Mcp-Session-Id + 0600 store + DELETE cleanup.');

    console.log('3) Node (npm:foragent) warm-cache reuse + refresh_token rotation ...');
    await runBridgeSession({
      cmd: process.execPath,
      args: [nodeCli, '--url', mock.mcpUrl],
      env: { FORAGENT_AUTH_FILE: nodeAuthFile },
      expectBrowserFlow: false,
    });
    assert.equal(mock.stats.register, 1, 'warm cache must not re-register');

    mock.invalidateAllAccessTokens();
    await runBridgeSession({
      cmd: process.execPath,
      args: [nodeCli, '--url', mock.mcpUrl],
      env: { FORAGENT_AUTH_FILE: nodeAuthFile },
      expectBrowserFlow: false,
    });
    assert.equal(mock.stats.tokenRefresh, 1, 'expired access token must refresh via refresh_token');
    assert.equal(mock.stats.register, 1, 'refresh must not reopen browser');
    console.log('   PASS: Node warm cache & refresh_token rotation verified.');

    console.log('4) Python (PyPI:foragent / uvx foragent) cold-start OAuth DCR + PKCE S256 + stdio <-> Streamable HTTP (JSON & SSE) ...');
    const pyAuthFile = join(tmp, 'py-auth.json');
    const pyProject = fileURLToPath(new URL('../packages/pypi-foragent', import.meta.url));
    await runBridgeSession({
      cmd: 'uv',
      args: ['run', '--locked', '--python', '3.12', '--project', pyProject, 'foragent', '--url', mock.mcpUrl],
      env: { FORAGENT_AUTH_FILE: pyAuthFile },
      expectBrowserFlow: true,
    });
    assert.equal(mock.stats.register, 2);
    assert.equal(mock.stats.tokenAuthCode, 2);
    assert.equal(statSync(pyAuthFile).mode & 0o777, 0o600, 'python auth file must be 0600');
    console.log('   PASS: Python cold-start OAuth (official mcp SDK OAuthClientProvider) + JSON/SSE verified.');

    console.log('5) Python (PyPI:foragent) warm-cache reuse ...');
    await runBridgeSession({
      cmd: 'uv',
      args: ['run', '--locked', '--python', '3.12', '--project', pyProject, 'foragent', '--url', mock.mcpUrl],
      env: { FORAGENT_AUTH_FILE: pyAuthFile },
      expectBrowserFlow: false,
    });
    assert.equal(mock.stats.register, 2, 'python warm cache must not re-register');
    console.log('   PASS: Python warm-cache reuse verified.');

    const pkgJson = JSON.parse(readFileSync(new URL('../packages/npm-foragent/package.json', import.meta.url), 'utf8'));
    const serverJson = JSON.parse(readFileSync(new URL('../mcp-registry/server.json', import.meta.url), 'utf8'));
    const pyReadme = readFileSync(new URL('../packages/pypi-foragent/README.md', import.meta.url), 'utf8');
    assert.equal(pkgJson.mcpName, serverJson.name, 'npm mcpName must match server.json name');
    assert.match(pyReadme, /mcp-name:\s*io\.foragent\/foragent(?:\s|-->|$)/, 'PyPI README must include mcp-name marker');
    console.log('   PASS: Registry ownership markers verified.');
  } finally {
    await mock.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
