import { createInterface } from 'node:readline';
import { ForAgentOAuthClient } from './oauth.mjs';

function writeStdoutMessage(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
  process.stdout.write(`${line}\n`);
}

function writeErrorResponse(id, code, message) {
  if (id === undefined) return;
  writeStdoutMessage({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

async function forwardSseBody(response, onMessage) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines = [];

  const flushEvent = () => {
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n').trim();
    dataLines = [];
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload);
      onMessage(parsed);
    } catch {
      // Ignore non-JSON SSE heartbeats or comments.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line === '') {
        flushEvent();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
  if (buffer.trim().startsWith('data:')) {
    dataLines.push(buffer.trim().slice(5).trimStart());
  }
  flushEvent();
}

export async function runStdioBridge({ mcpUrl, storePath } = {}) {
  const targetUrl = mcpUrl || process.env.FORAGENT_MCP_URL || 'https://foragent.io/mcp';
  const log = (msg) => process.stderr.write(`[foragent] ${msg}\n`);
  const oauth = new ForAgentOAuthClient(targetUrl, { storePath, log });

  let sessionId = null;
  let protocolVersion = null;
  const inflight = new Set();

  async function sendHttp(payload, allowRetry = true) {
    let token = await oauth.ensureAccessToken();
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (response.status === 401 && allowRetry) {
      const wwwAuth = response.headers.get('www-authenticate');
      await response.text().catch(() => '');
      token = await oauth.ensureAccessToken({ forceRefresh: true, wwwAuthenticate: wwwAuth });
      return sendHttp(payload, false);
    }

    const nextSession = response.headers.get('mcp-session-id');
    if (nextSession) sessionId = nextSession;

    if (response.status === 202 || response.status === 204) {
      await response.text().catch(() => '');
      return;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.jsonrpc === '2.0') {
            writeStdoutMessage(parsed);
            return;
          }
        } catch {
          // Fall through to structured JSON-RPC error.
        }
      }
      throw new Error(`Remote MCP HTTP ${response.status}`);
    }

    const emit = (msg) => {
      if (Array.isArray(msg)) {
        for (const item of msg) emit(item);
        return;
      }
      if (msg && typeof msg === 'object') {
        if (payload?.method === 'initialize' && msg.result?.protocolVersion) {
          protocolVersion = msg.result.protocolVersion;
        }
        writeStdoutMessage(msg);
      }
    };

    if (contentType.includes('text/event-stream')) {
      await forwardSseBody(response, emit);
      return;
    }

    const text = await response.text();
    if (!text.trim()) return;
    emit(JSON.parse(text));
  }

  async function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      writeErrorResponse(null, -32700, 'Parse error');
      return;
    }
    try {
      await sendHttp(payload, true);
    } catch (err) {
      log(err instanceof Error ? err.message : String(err));
      if (!Array.isArray(payload) && payload?.id !== undefined) {
        writeErrorResponse(payload.id, -32000, err instanceof Error ? err.message : 'ForAgent bridge request failed');
      }
    }
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const task = handleLine(line);
    inflight.add(task);
    task.finally(() => inflight.delete(task));
  });

  await new Promise((resolve) => {
    rl.once('close', resolve);
  });

  await Promise.allSettled([...inflight]);

  if (sessionId) {
    try {
      const token = oauth.getCachedAccessToken();
      if (token) {
        await fetch(targetUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Mcp-Session-Id': sessionId,
          },
        }).catch(() => {});
      }
    } catch {
      // Best-effort session teardown.
    }
  }
}
