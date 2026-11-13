/**
 * Status-board source resolution for Hermes Stage.
 *
 * The status board used to render only when a connected bot resolved, so a failed
 * connect made the whole row (model, context, latency) disappear. A roster placeholder
 * keeps the row visible and degraded instead.
 */

export function resolveStatusSource(bots, roster, focusName) {
  const list = Array.isArray(bots) ? bots : [];
  const focused = list.find((b) => b.name === focusName)
    || list.find((b) => b.primary)
    || null;
  if (focused) return focused;

  const row = Array.isArray(roster) && roster.length ? roster[0] : null;
  if (!row) return null;
  return {
    name: row.name,
    icon: row.icon || '',
    placeholder: true,
    modelHint: row.model || '',
  };
}

export function modelForDisplay(runtime, bot) {
  const raw = (runtime && runtime.model) || (bot && bot.modelHint) || '';
  return raw ? raw.replace(/^.*\//, '') : '—';
}
