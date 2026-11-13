/**
 * Bounded connection parallelism.
 *
 * Each profile connection mints a single-use ticket by spawning
 * gateway_bootstrap.py, so startup cost is spawn count / parallelism. Two at a time
 * measured ~12 s for 15 profiles; four measured ~4.3 s. The cap stays bounded so a
 * large roster does not stampede the gateway.
 */

export const DEFAULT_CONNECT_PARALLELISM = 4;
export const MAX_CONNECT_PARALLELISM = 8;

export function resolveConnectParallelism(value, fallback = DEFAULT_CONNECT_PARALLELISM) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_CONNECT_PARALLELISM, Math.floor(n));
}
