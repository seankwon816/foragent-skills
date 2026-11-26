import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 180_000;
const EXPIRY_BUFFER_MS = 60_000;

export function getAuthStorePath() {
  if (process.env.FORAGENT_AUTH_FILE) return process.env.FORAGENT_AUTH_FILE;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? join(xdg, 'foragent') : join(homedir(), '.config', 'foragent');
  return join(base, 'bridge-auth.json');
}

function readStore(storePath) {
  try {
    const raw = readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(storePath, data) {
  mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${storePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    // Windows does not enforce POSIX modes.
  }
  renameSync(tmpPath, storePath);
}

export function clearAuthStore(storePath = getAuthStorePath()) {
  try {
    rmSync(storePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createPkce() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function parseResourceMetadataUrl(wwwAuthenticate, mcpUrl) {
  if (typeof wwwAuthenticate === 'string') {
    const match = wwwAuthenticate.match(/resource_metadata="([^"]+)"/i);
    if (match?.[1]) return match[1];
  }
  const u = new URL(mcpUrl);
  const suffix = u.pathname === '/' ? '' : u.pathname;
  return `${u.origin}/.well-known/oauth-protected-resource${suffix}${u.search}`;
}

export async function discoverOAuthMetadata(mcpUrl, wwwAuthenticate = null) {
  const resourceMetadataUrl = parseResourceMetadataUrl(wwwAuthenticate, mcpUrl);
  const prRes = await fetch(resourceMetadataUrl, { headers: { Accept: 'application/json' } });
  if (!prRes.ok) {
    throw new Error(`Failed to fetch OAuth protected resource metadata (${prRes.status})`);
  }
  const prMeta = await prRes.json();
  const issuer = prMeta.authorization_servers?.[0];
  if (!issuer) {
    throw new Error('OAuth protected resource metadata did not include an authorization server.');
  }
  const issuerOrigin = new URL(issuer).origin;
  const asMetaUrl = `${issuerOrigin}/.well-known/oauth-authorization-server`;
  const asRes = await fetch(asMetaUrl, { headers: { Accept: 'application/json' } });
  if (!asRes.ok) {
    throw new Error(`Failed to fetch OAuth authorization server metadata (${asRes.status})`);
  }
  const asMeta = await asRes.json();
  return {
    resource: prMeta.resource || mcpUrl,
    scopesSupported: Array.isArray(prMeta.scopes_supported) ? prMeta.scopes_supported : (asMeta.scopes_supported ?? []),
    authorizationEndpoint: asMeta.authorization_endpoint,
    tokenEndpoint: asMeta.token_endpoint,
    registrationEndpoint: asMeta.registration_endpoint,
  };
}

function openBrowser(url) {
  if (process.env.FORAGENT_NO_BROWSER === '1') return;
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  const child = execFile(cmd, args, () => {});
  child.unref();
}

function startCallbackServer(expectedState, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let signInUrl;
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    codePromise.catch(() => {}); // The callback may time out before registration has finished.
    const server = createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (reqUrl.pathname === '/sign-in' && signInUrl) {
          res.writeHead(302, { Location: signInUrl, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
          res.end();
          return;
        }
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        const error = reqUrl.searchParams.get('error');

        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');

        if (state !== expectedState) {
          res.writeHead(400).end('Invalid sign-in response.');
          return;
        }
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><html><body><h2>ForAgent sign-in was cancelled.</h2><p>You can close this tab.</p></body></html>');
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            server.close();
            rejectCode(new Error('Authorization was declined.'));
          }
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><html><body><h2>Invalid sign-in response.</h2><p>Please retry from your AI app.</p></body></html>');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body><h2>Sign-in response received.</h2><p>You can close this tab and return to your AI app.</p></body></html>');
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          server.close();
          resolveCode(code);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Callback error');
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          server.close();
          rejectCode(err);
        }
      }
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        rejectCode(new Error('Timed out waiting for ForAgent browser sign-in.'));
      }
    }, timeoutMs);
    timer.unref();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to bind local OAuth callback port.'));
        return;
      }
      resolve({
        redirectUri: `http://127.0.0.1:${addr.port}/callback`,
        prepareSignIn: (url) => {
          signInUrl = url;
          return `http://127.0.0.1:${addr.port}/sign-in`;
        },
        waitForCode: () => codePromise,
        close: () => {
          clearTimeout(timer);
          server.close();
          server.closeAllConnections();
        },
      });
    });
  });
}

async function registerPublicClient(registrationEndpoint, redirectUri, scope) {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'ForAgent MCP Bridge (npm)',
      client_uri: 'https://foragent.io',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(scope ? { scope } : {}),
    }),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Dynamic OAuth client registration failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.client_id) throw new Error('Dynamic OAuth client registration response omitted client_id.');
  return data.client_id;
}

async function requestToken(tokenEndpoint, params) {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    await res.body?.cancel();
    const err = new Error(`OAuth token request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export class ForAgentOAuthClient {
  constructor(mcpUrl, { storePath = getAuthStorePath(), log = (msg) => process.stderr.write(`[foragent] ${msg}\n`) } = {}) {
    this.mcpUrl = mcpUrl;
    this.storeKey = createHash('sha256').update(mcpUrl).digest('hex');
    this.storePath = storePath;
    this.log = log;
    this.authInFlight = null;
    this.metadata = null;
  }

  getEntry() {
    const store = readStore(this.storePath);
    return store[this.storeKey] || null;
  }

  saveEntry(entry) {
    const store = readStore(this.storePath);
    store[this.storeKey] = entry;
    writeStore(this.storePath, store);
  }

  getCachedAccessToken() {
    if (process.env.FORAGENT_ACCESS_TOKEN) return process.env.FORAGENT_ACCESS_TOKEN;
    const entry = this.getEntry();
    if (!entry?.accessToken) return null;
    if (entry.expiresAt && Date.now() >= entry.expiresAt - EXPIRY_BUFFER_MS) return null;
    return entry.accessToken;
  }

  async ensureAccessToken({ forceRefresh = false, wwwAuthenticate = null } = {}) {
    if (process.env.FORAGENT_ACCESS_TOKEN) return process.env.FORAGENT_ACCESS_TOKEN;
    if (!forceRefresh) {
      const cached = this.getCachedAccessToken();
      if (cached) return cached;
    }
    if (this.authInFlight) return this.authInFlight;

    this.authInFlight = this.#authorize(wwwAuthenticate).finally(() => {
      this.authInFlight = null;
    });
    return this.authInFlight;
  }

  async #authorize(wwwAuthenticate) {
    const meta = await discoverOAuthMetadata(this.mcpUrl, wwwAuthenticate);
    this.metadata = meta;
    const existing = this.getEntry();

    if (existing?.refreshToken && existing?.clientId && meta.tokenEndpoint) {
      try {
        const refreshed = await requestToken(meta.tokenEndpoint, {
          grant_type: 'refresh_token',
          refresh_token: existing.refreshToken,
          client_id: existing.clientId,
          resource: meta.resource,
        });
        if (refreshed.access_token) {
          const nextEntry = {
            clientId: existing.clientId,
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token || existing.refreshToken,
            expiresAt: refreshed.expires_in ? Date.now() + Number(refreshed.expires_in) * 1000 : null,
          };
          this.saveEntry(nextEntry);
          return nextEntry.accessToken;
        }
      } catch {
        this.log('Saved session expired; starting browser sign-in.');
      }
    }

    if (!meta.registrationEndpoint || !meta.authorizationEndpoint || !meta.tokenEndpoint) {
      throw new Error('ForAgent OAuth metadata is incomplete.');
    }

    const state = base64Url(randomBytes(24));
    const pkce = createPkce();
    const scope = meta.scopesSupported.join(' ');
    const callback = await startCallbackServer(state);

    try {
      const clientId = await registerPublicClient(meta.registrationEndpoint, callback.redirectUri, scope);
      const authUrl = new URL(meta.authorizationEndpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', callback.redirectUri);
      authUrl.searchParams.set('code_challenge', pkce.challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('resource', meta.resource);
      if (scope) authUrl.searchParams.set('scope', scope);

      const localUrl = callback.prepareSignIn(authUrl.toString());
      this.log(`Sign in to ForAgent in your browser: ${localUrl}`);
      openBrowser(localUrl);

      const code = await callback.waitForCode();
      const tokenRes = await requestToken(meta.tokenEndpoint, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: callback.redirectUri,
        client_id: clientId,
        code_verifier: pkce.verifier,
        resource: meta.resource,
      });
      if (!tokenRes.access_token) {
        throw new Error('OAuth token response did not include access_token.');
      }

      const nextEntry = {
        clientId,
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token || null,
        expiresAt: tokenRes.expires_in ? Date.now() + Number(tokenRes.expires_in) * 1000 : null,
      };
      this.saveEntry(nextEntry);
      return nextEntry.accessToken;
    } finally {
      callback.close();
    }
  }
}
