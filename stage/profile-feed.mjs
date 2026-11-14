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
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_FEED_MS = 15000;
export const FEED_STATE_VERSION = 2;

const CRON_PREFIX = /^\[Cronjob\s+[\s\S]*?\s+output\s+—\s+scheduled job, not the user\. Review it, act on anything that needs action, and summarize for the chat\.\]\s*/;

// Job name from the same transport header, used for the report tag.
const CRON_JOB_NAME = /^\[Cronjob\s+"?([^"\]]*?)"?\s+output\s+—/;

const PUBLIC_FEED_FILTER = `
  s.title NOT LIKE 'Hermes Stage Room%'
  AND (s.title = 'Bot Chat' OR s.source = 'cron')
  AND m.role IN ('assistant', 'user')
  AND (m.display_kind IS NULL OR m.display_kind NOT IN ('hidden', 'failed_turn'))
  AND m.content IS NOT NULL AND TRIM(m.content) <> ''
  AND NOT (m.role = 'assistant' AND TRIM(m.content) = '(pass)')
  AND (
    (m.role = 'assistant' AND (m.display_kind IS NULL OR m.display_kind <> 'internal_notification'))
    OR (m.role = 'user' AND m.display_kind = 'internal_notification'
        AND SUBSTR(m.content, 1, 8) = '[Cronjob')
  )
`;

export function cleanCronNotification(text) {
  return String(text || '').replace(CRON_PREFIX, '').trim();
}

export function cronJobNameFromText(text) {
  const match = CRON_JOB_NAME.exec(String(text || '').trim());
  return match ? String(match[1] || '').trim() : null;
}

export function loadFeedState(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { version: FEED_STATE_VERSION, cursors: {} };
    }
    if (value.version !== FEED_STATE_VERSION) {
      return { version: FEED_STATE_VERSION, cursors: {} };
    }
    return value;
  } catch {
    return { version: FEED_STATE_VERSION, cursors: {} };
  }
}

export function saveFeedState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    state.version = FEED_STATE_VERSION;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, path);
  } catch {
    // Feed state is an optimization, not a correctness requirement.
  }
}

/**
 * Start a profile from its most recent feed-eligible public row, not from the
 * newest row of any kind. A newer tool row or Stage Room row must not push the
 * cursor past an unseen notification or speech item.
 */
function latestPublicCursor(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const row = db.prepare(`
      SELECT m.id, m.timestamp
      FROM messages AS m
      JOIN sessions AS s ON s.id = m.session_id
      WHERE ${PUBLIC_FEED_FILTER}
      ORDER BY m.timestamp DESC, m.id DESC
      LIMIT 1
    `).get();
    if (!row) return { ts: Date.now() / 1000, id: 0 };
    return { ts: Number(row.timestamp || 0), id: Number(row.id || 0) - 1 };
  } finally {
    db.close();
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
    db.exec('PRAGMA busy_timeout = 5000');
    return db.prepare(`
      SELECT m.id, m.session_id, m.role, m.display_kind, m.content, m.timestamp,
             s.title, s.source
      FROM messages AS m
      JOIN sessions AS s ON s.id = m.session_id
      WHERE (m.timestamp > ? OR (m.timestamp = ? AND m.id > ?))
        AND ${PUBLIC_FEED_FILTER}
      ORDER BY m.timestamp ASC, m.id ASC
      LIMIT 50
    `).all(cursor.ts, cursor.ts, cursor.id);
  } finally {
    db.close();
  }
}

export function makeFeedBubble({ speaker, icon, text, machine, tag = null, at, id }) {
  return {
    id,
    speaker,
    color: machine ? 'gray' : undefined,
    borderColor: machine ? 'gray' : undefined,
    text,
    done: true,
    at,
    role: 'bot',
    icon: icon || '',
    auto: true,
    machine: Boolean(machine),
    tag,
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
  onError,
  statePath,
  intervalMs = DEFAULT_FEED_MS,
}) {
  const state = loadFeedState(statePath);
  const cursors = state.cursors && typeof state.cursors === 'object' ? state.cursors : {};
  const profiles = roster.filter((r) => r && r.profile && r.home && !r.isDefault);
  let stopped = false;
  let timer = null;
  const reported = new Set();

  const report = (profile, err) => {
    if (reported.has(profile)) return;
    reported.add(profile);
    onError?.(profile, err);
  };

  const poll = () => {
    if (stopped) return;
    for (const row of profiles) {
      const profile = row.profile;
      const dbPath = `${row.home}/state.db`;
      if (!existsSync(dbPath)) continue;
      if (!cursors[profile]) {
        try {
          cursors[profile] = latestPublicCursor(dbPath);
          reported.delete(profile);
        } catch (err) {
          report(profile, err);
          continue;
        }
      }
      let rows;
      try {
        rows = speechRows(dbPath, cursors[profile]);
        reported.delete(profile);
      } catch (err) {
        report(profile, err);
        continue;
      }
      for (const message of rows) {
        // A cron row is a report the job delivered, so it renders as content
        // (normal text) with a dim tag naming the job — not as a machine note.
        const isReport = message.role === 'user';
        const rawText = String(message.content || '').trim();
        if (message.role === 'assistant' && rawText === '(pass)') continue;
        const text = isReport ? cleanCronNotification(rawText) : rawText;
        if (!text) continue;
        const id = `feed:${profile}:${message.id}`;
        const at = Number(message.timestamp || 0) * 1000;
        addBubble(makeFeedBubble({
          speaker: row.name,
          icon: row.icon,
          text,
          machine: false,
          tag: isReport ? `⚙ cron · ${cronJobNameFromText(rawText) || 'scheduled'}` : null,
          at,
          id,
        }));
        markUnread?.(row.name);
        cursors[profile] = { ts: Number(message.timestamp || 0), id: Number(message.id || 0) };
      }
    }
    state.cursors = cursors;
    state.version = FEED_STATE_VERSION;
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
