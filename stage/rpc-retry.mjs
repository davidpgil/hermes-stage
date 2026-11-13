/**
 * Retry helper for idempotent gateway reads.
 *
 * The room used to swallow every session.info / capabilities / approval.pending
 * failure, so a 60 s RPC timeout looked like missing model data. Idempotent reads may
 * be retried; writes (prompt.submit, session.create) must never be, because a retry
 * would duplicate a turn or a session.
 */

export const DEFAULT_RETRY_ATTEMPTS = 2;
export const DEFAULT_RETRY_DELAY_MS = 400;

export function isRetryableRpcError(err) {
  const text = String((err && (err.message || err.stderr)) || err || '');
  return /gateway RPC timeout|gateway socket not open|gateway socket closed|gateway socket error|ECONN|ETIMEDOUT|EAI_AGAIN|timeout/i.test(text);
}

export async function retryRpc(fn, {
  attempts = DEFAULT_RETRY_ATTEMPTS,
  delayMs = DEFAULT_RETRY_DELAY_MS,
  isRetryable = isRetryableRpcError,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const total = Math.max(1, Number(attempts) || 1);
  let last;
  for (let i = 0; i < total; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || i + 1 >= total) break;
      await sleep(delayMs * (i + 1));
    }
  }
  throw last;
}
