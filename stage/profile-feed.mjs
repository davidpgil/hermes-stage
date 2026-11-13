/**
 * Public profile speech feed for Hermes Stage.
 *
 * Stage already owns the shared room transcript. This module makes each
 * profile's public Bot Chat speech and cron notification text visible in that
 * room without importing tool calls, reasoning, or private session machinery.
 *
 * It reads profile state.db files directly with node:sqlite. No gateway or
 * core changes are involved.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_FEED_MS = 15000;

const CRON_PREFIX = /^\[Cronjob\s+"[^"]+"\s+output\s+—\s+scheduled job, not the user\. Review it, act on anything that needs action, and summarize for the chat\.\]\s*/;

export function cleanCronNotification(text) {
  return String(text || '').replace(CRON_PREFIX, '').trim();
}

export function loadFeedState(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function saveFeedState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch {
    // Feed state is an optimization, not a correctness requirement.
  }
}

function maxCursor(dbPath) {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare(
        'SELECT id, timestamp FROM messages ORDER BY timestamp DESC, id DESC LIMIT 1'
      ).get();
      return { ts: Number(row?.timestamp || 0), id: Number(row?.id || 0) };
    } finally {
      db.close();
    }
  } catch {
    return { ts: Date.now() / 1000, id: 0 };
  }
}

/**
 * New public speech rows for one profile.
 * Assistant final text from the canonical Bot Chat and cron sessions, plus
 * cron notification rows. Tool rows and failed turns are excluded.
 */
export function speechRows(dbPath, cursor = { ts: 0, id: 0 }) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT m.id, m.session_id, m.role, m.display_kind, m.content, m.timestamp,
             s.title, s.source
      FROM messages AS m
      JOIN sessions AS s ON s.id = m.session_id
      WHERE (m.timestamp > ? OR (m.timestamp = ? AND m.id > ?))
        AND s.title NOT LIKE 'Hermes Stage Room%'
        AND (s.title = 'Bot Chat' OR s.source = 'cron')
        AND m.role IN ('assistant', 'user')
        AND (m.display_kind IS NULL OR m.display_kind NOT IN ('hidden', 'failed_turn'))
        AND m.content IS NOT NULL AND TRIM(m.content) <> ''
        AND (
          (m.role = 'assistant' AND (m.display_kind IS NULL OR m.display_kind <> 'internal_notification'))
          OR (m.role = 'user' AND m.display_kind = 'internal_notification'
              AND SUBSTR(m.content, 1, 8) = '[Cronjob')
        )
      ORDER BY m.timestamp ASC, m.id ASC
      LIMIT 50
    `).all(cursor.ts, cursor.ts, cursor.id);
  } finally {
    db.close();
  }
}

export function makeFeedBubble({ profile, speaker, icon, text, machine, at, id }) {
  return {
    id,
    speaker,
    color: machine ? 'gray' : '#cbd5e1',
    borderColor: 'gray',
    text,
    done: true,
    at,
    role: 'bot',
    icon: icon || '',
    auto: true,
    machine: Boolean(machine),
    parts: [{ kind: 'text', text }],
    asksPeer: false,
  };
}

/**
 * Poll all non-default roster profiles for new public speech.
 * addBubble(bubble) inserts a bubble; markUnread(profileName) is invoked by the
 * caller. The feed itself does not know the current view.
 */
export function startProfileFeed({
  roster,
  addBubble,
  markUnread,
  statePath,
  intervalMs = DEFAULT_FEED_MS,
  now = () => Date.now(),
}) {
  const state = loadFeedState(statePath);
  const cursors = state.cursors && typeof state.cursors === 'object' ? state.cursors : {};
  const profiles = roster.filter((r) => r && r.profile && r.home && !r.isDefault);
  let stopped = false;
  let timer = null;

  const poll = () => {
    if (stopped) return;
    for (const row of profiles) {
      const profile = row.profile;
      const dbPath = `${row.home}/state.db`;
      if (!cursors[profile]) cursors[profile] = maxCursor(dbPath);
      let rows;
      try {
        rows = speechRows(dbPath, cursors[profile]);
      } catch {
        continue;
      }
      for (const message of rows) {
        const machine = message.role === 'user';
        const rawText = String(message.content || '').trim();
        const text = machine ? cleanCronNotification(rawText) : rawText;
        if (!text) continue;
        const id = `feed:${profile}:${message.id}`;
        const at = Number(message.timestamp || 0) * 1000;
        addBubble(makeFeedBubble({
          profile,
          speaker: row.name,
          icon: row.icon,
          text,
          machine,
          at,
          id,
        }));
        markUnread?.(row.name);
        cursors[profile] = { ts: Number(message.timestamp || 0), id: Number(message.id || 0) };
      }
    }
    state.cursors = cursors;
    saveFeedState(statePath, state);
  };

  poll();
  timer = setInterval(poll, Math.max(1000, Number(intervalMs) || DEFAULT_FEED_MS));
  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    poll,
  };
}
