/**
 * Pure wake-event parsing, deduplication, retry backoff, and prompt formatting for the ForAgent Claude Code hook.
 */

export const FORAGENT_REMOTE_SERVER = 'foragent-remote';
export const WAIT_FOR_WAKE_TOOL = 'foragent_wait_for_wake';
export const WAIT_TIMEOUT_SEC = 50;
export const INITIAL_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 15_000;

const SEEN_LIMIT = 200;
const PUBLIC_NUMBER_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

const RETRYABLE_DROP_REASONS = [
  'the session was stopped and nobody has sent input since',
  'was removed from the queue before it ran',
] as const;

const TERMINAL_DROP_REASONS = [
  'the host has ended its input',
] as const;

export interface ParsedWake {
  eventId: string;
  callPublicId: string | null;
  number: string;
  expiresAtMs: number | null;
}

export type WakePayload =
  | { kind: 'accepted'; wake: ParsedWake }
  | { kind: 'none' }
  | { kind: 'cancelled' }
  | { kind: 'invalid' };

/** Exact approved wake prompt sent into the idle session once the user accepts a call. */
export function formatWakePrompt(number: string): string {
  const clean = number.replace(/^@+/, '').trim();
  return `You have a ForAgent call on @${clean}. Pick up now.`;
}

/** Bounded exponential retry delay (1 s -> 2 s -> 4 s -> 8 s -> 15 s cap). */
export function retryDelayMs(failures: number): number {
  const step = Math.min(Math.max(0, failures - 1), 4);
  return Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** step);
}

/** A host with no connected tool may still finish connecting. A server denial is definitive for this session. */
export function wakeErrorRetryMs(message: string, failures: number): number | null {
  if (message === `MCP error -32602: Tool ${WAIT_FOR_WAKE_TOOL} not found`) return null;
  const missing = `$.mcp.call: no connected MCP tool "${WAIT_FOR_WAKE_TOOL}" on a server named "${FORAGENT_REMOTE_SERVER}"`;
  if (message.includes(missing)) return 300_000;
  try {
    const payload = JSON.parse(message);
    if (payload?.ok === false && ['unauthorized', 'insufficient_scope', 'no_allowed_number'].includes(payload.error)) {
      return null;
    }
  } catch {
    // Transport errors and other plain-text responses use the usual retry schedule.
  }
  return retryDelayMs(failures);
}

export function isWakeExpired(wake: ParsedWake, nowMs: number): boolean {
  return wake.expiresAtMs !== null && nowMs >= wake.expiresAtMs;
}

export function isRetryableDrop(reason: string): boolean {
  return RETRYABLE_DROP_REASONS.some((needle) => reason.includes(needle));
}

export function isTerminalDrop(reason: string): boolean {
  return TERMINAL_DROP_REASONS.some((needle) => reason.includes(needle));
}

export function parseWakePayload(raw: string, nowMs: number): WakePayload {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'none') return { kind: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'invalid' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'invalid' };
  const record = parsed as Record<string, unknown>;
  if (record.status === 'none') return { kind: 'none' };
  if (record.status === 'cancelled') return { kind: 'cancelled' };
  if (record.ok !== true || record.status !== 'accepted') return { kind: 'invalid' };

  const rawNumber = typeof record.number === 'string' ? record.number.replace(/^@+/, '').trim() : '';
  if (!PUBLIC_NUMBER_SHAPE.test(rawNumber)) return { kind: 'invalid' };

  const callPublicId = typeof record.callPublicId === 'string' && record.callPublicId.trim() !== ''
    ? record.callPublicId.trim()
    : null;
  const eventId = typeof record.eventId === 'string' && record.eventId.trim() !== ''
    ? record.eventId.trim()
    : callPublicId;
  if (!eventId) return { kind: 'invalid' };

  let expiresAtMs: number | null = null;
  if (typeof record.expiresAt === 'string' && record.expiresAt.trim() !== '') {
    const parsedTime = Date.parse(record.expiresAt);
    if (!Number.isFinite(parsedTime)) return { kind: 'invalid' };
    expiresAtMs = parsedTime;
    if (nowMs >= expiresAtMs) return { kind: 'none' };
  }

  return {
    kind: 'accepted',
    wake: { eventId, callPublicId, number: rawNumber, expiresAtMs },
  };
}

/** Bounded deduplication tracker so one accepted call wakes this session at most once. */
export class WakeDedupe {
  readonly #seenEventIds = new Set<string>();
  readonly #seenCallIds = new Set<string>();

  claim(wake: ParsedWake): boolean {
    if (this.#seenEventIds.has(wake.eventId)) return false;
    if (wake.callPublicId && this.#seenCallIds.has(wake.callPublicId)) return false;
    this.#seenEventIds.add(wake.eventId);
    if (wake.callPublicId) this.#seenCallIds.add(wake.callPublicId);
    this.#trim(this.#seenEventIds);
    this.#trim(this.#seenCallIds);
    return true;
  }

  #trim(set: Set<string>): void {
    while (set.size > SEEN_LIMIT) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  }
}
