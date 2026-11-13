/**
 * Reconnect policy for Hermes Stage.
 *
 * A gateway restart (or a failed first attach) currently leaves a Stage bot offline
 * forever. Reconnect is bounded: a transient failure retries with exponential backoff,
 * a terminal bootstrap failure stops immediately, and the budget never loops forever.
 */

export const DEFAULT_MAX_ATTEMPTS = 8;
export const BASE_DELAY_MS = 1000;
export const MAX_DELAY_MS = 30000;

export function backoffDelay(attempt, base = BASE_DELAY_MS, max = MAX_DELAY_MS) {
  const n = Math.max(0, Number(attempt) || 0);
  return Math.min(max, base * 2 ** n);
}

/**
 * Terminal verdicts from gateway_bootstrap: retrying cannot fix a missing dependency
 * environment or a protocol mismatch, so the client must stop rather than spin.
 */
export function isTerminalError(err) {
  const text = String((err && (err.stderr || err.message)) || err || '');
  return /bootstrap_dependencies|dependency environment unavailable|bad subprotocol/i.test(text);
}

export function attemptAllowed(attempt, max = DEFAULT_MAX_ATTEMPTS) {
  return Number(attempt) < Number(max);
}
