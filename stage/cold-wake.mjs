/**
 * Cold-profile mention waking for Hermes Stage.
 *
 * A bot reply can mention a profile that is not connected yet. The caller supplies
 * the current roster, connected clients, and profile-wake callback. Keeping this
 * pure and separate from the connection effect makes the failure path testable.
 */

export function mentionedRosterRows(text, selfBot, roster) {
  const raw = String(text || '');
  const matches = [...raw.matchAll(/(?:^|[^A-Za-z0-9_])@([A-Za-z][\w-]*)\b/g)];
  const rows = [];
  const seen = new Set();
  for (const m of matches) {
    const handle = m[1].toLowerCase();
    const row = roster.find((r) =>
      r.name.toLowerCase() === handle ||
      r.name.toLowerCase().split(' · ')[0].toLowerCase() === handle ||
      String(r.profile || '').toLowerCase() === handle);
    if (!row) continue;
    if (row.name === selfBot.name || row.profile === selfBot.profile) continue;
    if (seen.has(row.profile)) continue;
    seen.add(row.profile);
    rows.push(row);
  }
  return rows;
}

export async function wakeColdMentions({
  text,
  selfBot,
  roster,
  clients,
  ensureProfile,
  triggerAddressed,
  isAlive = () => true,
  notify = () => {},
}) {
  for (const row of mentionedRosterRows(text, selfBot, roster)) {
    if (clients.some((b) => b.profile === row.profile || b.name === row.name)) continue;
    const bot = await ensureProfile?.(row.profile);
    if (!bot) {
      if (isAlive()) notify(`${row.name}: mentioned but could not wake`);
      continue;
    }
    triggerAddressed(bot);
  }
}
