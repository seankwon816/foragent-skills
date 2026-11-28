/**
 * ForAgent Claude Code hooks module: observes the remote server's read-only accepted-call wait over the host's own
 * authenticated MCP connection (zero tokens touched) and queues the approved prompt once when the user accepts a call.
 */
import type { EngineInterface, McpToolResult, Register } from 'claude-code';
import {
  FORAGENT_REMOTE_SERVER,
  PLUGIN_REMOTE_SERVER,
  formatWakePrompt,
  isMissingWakeTool,
  isRetryableDrop,
  isTerminalDrop,
  isWakeExpired,
  type ParsedWake,
  parseWakePayload,
  retryDelayMs,
  WAIT_FOR_WAKE_TOOL,
  WAIT_TIMEOUT_SEC,
  WakeDedupe,
  wakeErrorRetryMs,
} from './wake-logic';

type ClockTimer = ReturnType<EngineInterface['clock']['after']>;

interface WakeLoopState {
  server: string;
  alive: boolean;
  inFlight: boolean;
  generation: number;
  failures: number;
  timer: ClockTimer | null;
  pendingWake: ParsedWake | null;
  dedupe: WakeDedupe;
}

function textOf(result: McpToolResult): string {
  return result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

function stopLoop(state: WakeLoopState): void {
  state.alive = false;
  state.generation += 1;
  state.pendingWake = null;
  state.timer?.cancel();
  state.timer = null;
}

function scheduleNext($: EngineInterface, state: WakeLoopState, delayMs: number): void {
  if (!state.alive || state.inFlight) return;
  const gen = state.generation;
  state.timer?.cancel();
  state.timer = $.clock.after(delayMs, () => {
    state.timer = null;
    if (state.generation !== gen) return;
    void waitOnce($, state);
  });
}

async function submitWake($: EngineInterface, state: WakeLoopState, wake: ParsedWake, gen: number): Promise<void> {
  if (!state.alive || state.generation !== gen) return;
  const now = await $.clock.now();
  if (!state.alive || state.generation !== gen || isWakeExpired(wake, now)) return;
  let dropReason = '';
  try {
    const result = await $.prompt.submit({ text: formatWakePrompt(wake.number) });
    if (result.drop !== undefined) dropReason = result.drop;
  } catch (error) {
    dropReason = error instanceof Error ? error.message : String(error);
  }
  if (!state.alive || state.generation !== gen || !dropReason) return;
  if (isTerminalDrop(dropReason)) {
    stopLoop(state);
    return;
  }
  if (isRetryableDrop(dropReason)) {
    state.pendingWake = wake;
  }
}

async function callWakeTool($: EngineInterface, state: WakeLoopState, gen: number): Promise<McpToolResult> {
  const server = state.server;
  const args = { timeoutSec: WAIT_TIMEOUT_SEC };
  try {
    return await $.mcp.call(server, WAIT_FOR_WAKE_TOOL, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!state.alive || state.generation !== gen || !isMissingWakeTool(message, server)) throw error;
  }
  // A host lookup miss occurs before dispatch. Keep account and transport errors on their original connection.
  const alternate = server === FORAGENT_REMOTE_SERVER ? PLUGIN_REMOTE_SERVER : FORAGENT_REMOTE_SERVER;
  const result = await $.mcp.call(alternate, WAIT_FOR_WAKE_TOOL, args);
  if (state.generation === gen) state.server = alternate;
  return result;
}

async function waitOnce($: EngineInterface, state: WakeLoopState): Promise<void> {
  if (!state.alive || state.inFlight) return;
  const gen = state.generation;
  state.inFlight = true;
  let nextDelayMs: number | null = 0;
  try {
    const result = await callWakeTool($, state, gen);
    if (!state.alive || state.generation !== gen) return;
    if (result.isError) {
      nextDelayMs = wakeErrorRetryMs(textOf(result), ++state.failures);
      return;
    }
    const now = await $.clock.now();
    if (!state.alive || state.generation !== gen) return;
    const parsed = parseWakePayload(textOf(result), now);
    if (parsed.kind === 'invalid' || parsed.kind === 'cancelled') {
      state.failures += 1;
      nextDelayMs = retryDelayMs(state.failures);
      return;
    }
    state.failures = 0;
    if (parsed.kind === 'accepted' && state.dedupe.claim(parsed.wake)) {
      void submitWake($, state, parsed.wake, gen);
    }
  } catch (error) {
    if (!state.alive || state.generation !== gen) return;
    nextDelayMs = wakeErrorRetryMs(error instanceof Error ? error.message : String(error), ++state.failures);
  } finally {
    if (state.generation === gen) {
      state.inFlight = false;
      if (nextDelayMs === null) stopLoop(state);
      else scheduleNext($, state, nextDelayMs);
    }
  }
}

export const register: Register = (on) => {
  const state: WakeLoopState = {
    server: FORAGENT_REMOTE_SERVER,
    alive: false,
    inFlight: false,
    generation: 0,
    failures: 0,
    timer: null,
    pendingWake: null,
    dedupe: new WakeDedupe(),
  };

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    if (!e.isInteractive) return started;
    state.generation += 1;
    state.server = FORAGENT_REMOTE_SERVER;
    state.alive = true;
    state.inFlight = false;
    state.failures = 0;
    state.pendingWake = null;
    scheduleNext($, state, 0);
    return started;
  });

  on('session.end', async (_$, e, next) => {
    if (e.reason === 'clear') {
      state.pendingWake = null;
    } else {
      stopLoop(state);
    }
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e);
    if (e.agentId === undefined && !e.isAborted && state.alive && state.pendingWake !== null) {
      const wake = state.pendingWake;
      state.pendingWake = null;
      void submitWake($, state, wake, state.generation);
    }
    return completed;
  });
};
