/**
 * ForAgent Claude Code hooks module: observes the remote server's read-only accepted-call wait over the host's own
 * authenticated MCP connection (zero tokens touched) and queues the approved prompt once when the user accepts a call.
 */
import type { EngineInterface, McpToolResult, Register } from 'claude-code';
import {
  FORAGENT_REMOTE_SERVER,
  formatWakePrompt,
  isRetryableDrop,
  isTerminalDrop,
  isWakeExpired,
  type ParsedWake,
  parseWakePayload,
  retryDelayMs,
  WAIT_FOR_WAKE_TOOL,
  WAIT_TIMEOUT_SEC,
  WakeDedupe,
} from './wake-logic';

type ClockTimer = ReturnType<EngineInterface['clock']['after']>;

interface WakeLoopState {
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

async function waitOnce($: EngineInterface, state: WakeLoopState): Promise<void> {
  if (!state.alive || state.inFlight) return;
  const gen = state.generation;
  state.inFlight = true;
  let nextDelayMs = 0;
  try {
    const result = await $.mcp.call(FORAGENT_REMOTE_SERVER, WAIT_FOR_WAKE_TOOL, { timeoutSec: WAIT_TIMEOUT_SEC });
    if (!state.alive || state.generation !== gen) return;
    if (result.isError) {
      state.failures += 1;
      nextDelayMs = retryDelayMs(state.failures);
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
  } catch {
    if (!state.alive || state.generation !== gen) return;
    state.failures += 1;
    nextDelayMs = retryDelayMs(state.failures);
  } finally {
    if (state.generation === gen) {
      state.inFlight = false;
      if (state.alive) scheduleNext($, state, nextDelayMs);
    }
  }
}

export const register: Register = (on) => {
  const state: WakeLoopState = {
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
