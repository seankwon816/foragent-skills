import { expect, mock, test } from 'claude-code/testing';

const jsonResult = (payload: Record<string, unknown>, isError = false) => ({
  value: {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    isError,
  },
});

test('(1) accepted call wakes an idle interactive session with the approved prompt exactly once', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 });
  const mcpCalls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = [];
  const prompts: string[] = [];

  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });

  let callIndex = 0;
  on('mcp.call', async ($, e) => {
    mcpCalls.push({ server: e.server, tool: e.tool, args: e.args });
    callIndex += 1;
    if (callIndex === 1) {
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-1',
        callPublicId: 'call-1',
        number: '21',
        expiresAt: new Date(1_030_000).toISOString(),
      });
    }
    if (callIndex === 2) {
      // Duplicate eventId must never submit twice.
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-1',
        callPublicId: 'call-1',
        number: '21',
        expiresAt: new Date(1_030_000).toISOString(),
      });
    }
    await clock.sleep(50_000);
    return jsonResult({ ok: true, status: 'none' });
  });

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();

  expect(mcpCalls[0]).toEqual({
    server: 'foragent-remote',
    tool: 'foragent_wait_for_wake',
    args: { timeoutSec: 50 },
  });
  expect(mcpCalls.some((call) => call.tool === 'foragent_listen')).toBe(false);
  expect(prompts).toEqual(['You have a ForAgent call on @21. Pick up now.']);

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-1', resume: {} as never });
});

test('(2) expired, canceled, malformed, and non-interactive sessions produce no prompt', async ($, on) => {
  const clock = mock.clock(on, { now: 2_000_000 });
  const mcpCalls: Array<{ server: string; tool: string }> = [];
  const prompts: string[] = [];

  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });

  let step = 0;
  on('mcp.call', async ($, e) => {
    mcpCalls.push({ server: e.server, tool: e.tool });
    step += 1;
    if (step === 1) {
      // Expired event.
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-expired',
        callPublicId: 'call-expired',
        number: '21',
        expiresAt: new Date(1_999_000).toISOString(),
      });
    }
    if (step === 2) {
      // Cancelled wait.
      return jsonResult({ ok: true, status: 'cancelled' });
    }
    if (step === 3) {
      // Malformed / missing number.
      return jsonResult({ ok: true, status: 'accepted', eventId: 'evt-bad', number: '' });
    }
    await clock.sleep(50_000);
    return jsonResult({ ok: true, status: 'none' });
  });

  // Non-interactive session must not start waiting at all.
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' });
  await clock.settle();
  expect(mcpCalls).toEqual([]);
  expect(prompts).toEqual([]);

  // Interactive session ignores expired, cancelled, and malformed payloads.
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.advance(2_000);
  expect(prompts).toEqual([]);

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-2', resume: {} as never });
});

test('(3a) startup rejection and isError recover with bounded backoff and deliver subsequent wake once', async ($, on) => {
  const clock = mock.clock(on, { now: 3_000_000 });
  const callTimes: number[] = [];
  const prompts: string[] = [];

  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });

  let attempt = 0;
  on('mcp.call', async () => {
    callTimes.push(clock.now());
    attempt += 1;
    if (attempt === 1) return { deny: 'MCP tools not listed yet' };
    if (attempt === 2) return jsonResult({ ok: false, error: 'timeout' }, true);
    if (attempt === 3) return { deny: 'server temporarily unreachable' };
    if (attempt === 4) {
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-recovered',
        callPublicId: 'call-recovered',
        number: '09',
        expiresAt: new Date(clock.now() + 30_000).toISOString(),
      });
    }
    await clock.sleep(50_000);
    return jsonResult({ ok: true, status: 'none' });
  });

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();
  expect(attempt).toBe(1);

  // Backoff: 1s after failure 1, 2s after failure 2, 4s after failure 3.
  await clock.advance(999);
  expect(attempt).toBe(1);
  await clock.advance(1);
  expect(attempt).toBe(2);

  await clock.advance(1_999);
  expect(attempt).toBe(2);
  await clock.advance(1);
  expect(attempt).toBe(3);

  await clock.advance(3_999);
  expect(attempt).toBe(3);
  await clock.advance(1);
  expect(attempt).toBe(5); // attempt 4 returned accepted, immediately armed attempt 5 (sleeping 50s)
  expect(prompts).toEqual(['You have a ForAgent call on @09. Pick up now.']);

  // Session end stops cleanly with no further calls.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-3', resume: {} as never });
  const countAtEnd = callTimes.length;
  await clock.advance(120_000);
  expect(callTimes.length).toBe(countAtEnd);
});

test('(3b) dropped prompt after Esc retries on next clean turn.complete only if unexpired', async ($, on) => {
  const clock = mock.clock(on, { now: 4_000_000 });
  const prompts: string[] = [];
  let dropNext = true;

  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('turn.complete', () => ({ text: '' }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    if (dropNext) {
      dropNext = false;
      return { drop: 'the session was stopped and nobody has sent input since' };
    }
    return { text: e.text };
  });

  let delivered = 0;
  on('mcp.call', async () => {
    delivered += 1;
    if (delivered === 1) {
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-drop-1',
        callPublicId: 'call-drop-1',
        number: '31',
        expiresAt: new Date(clock.now() + 20_000).toISOString(),
      });
    }
    await clock.sleep(50_000);
    return jsonResult({ ok: true, status: 'none' });
  });

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();
  expect(prompts).toEqual(['You have a ForAgent call on @31. Pick up now.']);

  // Aborted turn does not retry while the session stays stopped.
  await $.turn.complete({ turnId: 't-aborted', answer: '', durationMs: 100, isAborted: true, reason: 'aborted' });
  await clock.settle();
  expect(prompts).toHaveLength(1);

  // Clean user turn completes within expiry: retries once.
  await clock.advance(5_000);
  await $.turn.complete({ turnId: 't-clean', answer: 'ok', durationMs: 100, isAborted: false, reason: 'answer' });
  await clock.settle();
  expect(prompts).toEqual([
    'You have a ForAgent call on @31. Pick up now.',
    'You have a ForAgent call on @31. Pick up now.',
  ]);

  // Another clean turn does not submit again.
  await $.turn.complete({ turnId: 't-clean-2', answer: 'ok', durationMs: 100, isAborted: false, reason: 'answer' });
  await clock.settle();
  expect(prompts).toHaveLength(2);

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-4', resume: {} as never });
});

test('(3c) dropped prompt that expires before next turn.complete is discarded without submitting', async ($, on) => {
  const clock = mock.clock(on, { now: 5_000_000 });
  const prompts: string[] = [];
  let dropNext = true;

  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('turn.complete', () => ({ text: '' }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    if (dropNext) {
      dropNext = false;
      return { drop: 'the session was stopped and nobody has sent input since' };
    }
    return { text: e.text };
  });

  let delivered = 0;
  on('mcp.call', async () => {
    delivered += 1;
    if (delivered === 1) {
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-drop-exp',
        callPublicId: 'call-drop-exp',
        number: '31',
        expiresAt: new Date(clock.now() + 10_000).toISOString(),
      });
    }
    await clock.sleep(50_000);
    return jsonResult({ ok: true, status: 'none' });
  });

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();
  expect(prompts).toHaveLength(1);

  // Expiry passes before user resumes -> discarded, no stale prompt!
  await clock.advance(15_000);
  await $.turn.complete({ turnId: 't-late', answer: 'ok', durationMs: 100, isAborted: false, reason: 'answer' });
  await clock.settle();
  expect(prompts).toHaveLength(1);

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-5', resume: {} as never });
});

test('(4) idle waiting across multiple 50s waits without a call produces zero prompts and keeps one wait in flight', async ($, on) => {
  const clock = mock.clock(on, { now: 6_000_000 });
  const prompts: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let completedWaits = 0;

  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });

  on('mcp.call', async ($, e) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const sec = Number(e.args.timeoutSec ?? 50);
    await clock.sleep(sec * 1000);
    inFlight -= 1;
    completedWaits += 1;
    return jsonResult({ ok: true, status: 'none' });
  });

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();
  expect(inFlight).toBe(1);

  // Advance 5 minutes (6 consecutive 50s waits) with no call.
  await clock.advance(300_000);
  expect(completedWaits).toBe(6);
  expect(maxInFlight).toBe(1);
  expect(prompts).toEqual([]);

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-6', resume: {} as never });
});

test('(5) malformed and repeated cancelled payloads back off instead of tight-looping, and dedupe by callPublicId across eventIds', async ($, on) => {
  const clock = mock.clock(on, { now: 7_000_000 });
  const prompts: string[] = [];
  let calls = 0;

  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });

  on('mcp.call', async () => {
    calls += 1;
    if (calls === 1) return { value: { content: [{ type: 'text' as const, text: 'not-json' }], isError: false } };
    if (calls === 2) return jsonResult({ ok: true, status: 'cancelled' });
    if (calls === 3) {
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-a',
        callPublicId: 'call-same',
        number: '42',
        expiresAt: new Date(clock.now() + 30_000).toISOString(),
      });
    }
    if (calls === 4) {
      // Different eventId for the same callPublicId must still wake only once.
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-b',
        callPublicId: 'call-same',
        number: '42',
        expiresAt: new Date(clock.now() + 30_000).toISOString(),
      });
    }
    await clock.sleep(50_000);
    return jsonResult({ ok: true, status: 'none' });
  });

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();
  expect(calls).toBe(1);

  // Invalid payload backs off 1s (no 0ms tight loop).
  await clock.advance(999);
  expect(calls).toBe(1);
  await clock.advance(1);
  expect(calls).toBe(2);

  // Subsequent cancelled payload backs off 2s.
  await clock.advance(1_999);
  expect(calls).toBe(2);
  await clock.advance(1);
  expect(calls).toBe(5);
  expect(prompts).toEqual(['You have a ForAgent call on @42. Pick up now.']);

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-7', resume: {} as never });
});

test('(6) terminal prompt drop stops the wake loop, while session clear drops pending retries without stopping waits', async ($, on) => {
  const clock = mock.clock(on, { now: 8_000_000 });
  const prompts: string[] = [];
  let dropMode: 'retryable' | 'terminal' | 'none' = 'retryable';
  let calls = 0;

  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('turn.complete', () => ({ text: '' }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    if (dropMode === 'retryable') return { drop: 'the session was stopped and nobody has sent input since' };
    if (dropMode === 'terminal') return { drop: 'the host has ended its input' };
    return { text: e.text };
  });

  on('mcp.call', async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-clear-1',
        callPublicId: 'call-clear-1',
        number: '11',
        expiresAt: new Date(clock.now() + 20_000).toISOString(),
      });
    }
    if (calls === 2) {
      await clock.sleep(5_000);
      return jsonResult({
        ok: true,
        status: 'accepted',
        eventId: 'evt-term-2',
        callPublicId: 'call-term-2',
        number: '12',
        expiresAt: new Date(clock.now() + 20_000).toISOString(),
      });
    }
    await clock.sleep(50_000);
    return jsonResult({ ok: true, status: 'none' });
  });

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();
  expect(prompts).toEqual(['You have a ForAgent call on @11. Pick up now.']);

  // /clear drops pending retry for call-clear-1, so next clean turn does not resubmit it, but wait loop stays alive.
  await $.session.end({ reason: 'clear', sessionId: 's-8', resume: {} as never });
  dropMode = 'terminal';
  await $.turn.complete({ turnId: 't-after-clear', answer: 'ok', durationMs: 50, isAborted: false, reason: 'answer' });
  await clock.settle();
  expect(prompts).toHaveLength(1);

  // Second accepted call arrives while wait loop is still alive, hits terminal drop -> stops loop permanently.
  await clock.advance(5_000);
  expect(prompts).toEqual([
    'You have a ForAgent call on @11. Pick up now.',
    'You have a ForAgent call on @12. Pick up now.',
  ]);
  const callsAfterTerminal = calls;
  await clock.advance(120_000);
  expect(calls).toBe(callsAfterTerminal);
});

test('confirmed access and tool errors stop polling until a new interactive session', async ($, on) => {
  const clock = mock.clock(on, { now: 9_000_000 });
  const missingTool = 'MCP error -32602: Tool foragent_wait_for_wake not found';
  const replies = [
    jsonResult({ ok: false, error: 'unauthorized' }, true),
    jsonResult({ ok: false, error: 'no_allowed_number' }, true),
    jsonResult({ ok: false, error: 'insufficient_scope' }, true),
    { value: { content: [{ type: 'text' as const, text: missingTool }], isError: true } },
  ];
  let calls = 0;
  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  let current = jsonResult({ ok: false, error: 'unauthorized' }, true);
  on('mcp.call', () => { calls++; return current; });
  for (const [i, reply] of replies.entries()) {
    current = reply;
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    await clock.settle();
    await clock.advance(600_000);
    expect(calls).toBe(i + 1);
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-terminal', resume: {} as never });
  }
});

test('a tool discovered just after startup is retried after one second', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 });
  let calls = 0;
  on('session.start', () => ({ cwd: '/work' }));
  on('mcp.call', async () => {
    if (++calls === 1) {
      return { deny: 'foragent-call: $.mcp.call: no connected MCP tool "foragent_wait_for_wake" on a server named "foragent-remote"' };
    }
    await clock.sleep(50_000);
    return jsonResult({ ok: true, status: 'none' });
  });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();
  await clock.advance(999);
  expect(calls).toBe(1);
  await clock.advance(1);
  expect(calls).toBe(2);
});

test('a persistently missing host tool slows down after the first ringing window', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 });
  let calls = 0;
  on('session.start', () => ({ cwd: '/work' }));
  on('mcp.call', () => {
    calls++;
    return { deny: 'foragent-call: $.mcp.call: no connected MCP tool "foragent_wait_for_wake" on a server named "foragent-remote"' };
  });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.settle();
  for (const delay of [1000, 2000, 4000, 8000, ...Array(11).fill(15000)]) {
    await clock.advance(delay);
  }
  expect(calls).toBe(16);
  await clock.advance(299_999);
  expect(calls).toBe(16);
  await clock.advance(1);
  expect(calls).toBe(17);
});
