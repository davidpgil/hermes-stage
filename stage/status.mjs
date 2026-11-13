/**
 * Status-board source resolution for Hermes Stage.
 *
 * The status board used to render only when a connected bot resolved, so a failed
 * connect made the whole row (model, context, latency) disappear. A roster placeholder
 * keeps the row visible and degraded instead.
 */

export function resolveStatusSource(bots, roster, focusName) {
  const list = Array.isArray(bots) ? bots : [];
  const focused = list.find((b) => b.name === focusName) || null;
  if (focused) return focused;

  const rows = Array.isArray(roster) ? roster : [];
  const focusRow = focusName
    ? rows.find((r) => r.name === focusName || r.profile === focusName) || null
    : null;
  if (focusRow) {
    return {
      name: focusRow.name,
      icon: focusRow.icon || '',
      placeholder: true,
      modelHint: focusRow.model || '',
    };
  }

  const primary = list.find((b) => b.primary) || null;
  if (primary) return primary;

  const row = rows.length ? rows[0] : null;
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
