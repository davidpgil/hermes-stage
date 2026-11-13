/**
 * Live status refresh policy.
 *
 * The model row used to update only when a turn ended or a session opened. A periodic
 * refresh keeps model/context data current while the room is idle, without polling a
 * bot that is already streaming.
 */

export const DEFAULT_STATUS_REFRESH_MS = 15000;
export const MIN_STATUS_REFRESH_MS = 5000;
export const MAX_STATUS_REFRESH_MS = 60000;

export function resolveStatusRefreshMs(value, fallback = DEFAULT_STATUS_REFRESH_MS) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_STATUS_REFRESH_MS, Math.max(MIN_STATUS_REFRESH_MS, Math.floor(n)));
}

export function shouldRefreshRuntime(bot, status) {
  if (!bot || bot.placeholder || bot.offline) return false;
  if (!bot.sessionId || typeof bot.rpc !== 'function') return false;
  if (status && !['ready', 'error', 'not-ready'].includes(status)) return false;
  return true;
}
