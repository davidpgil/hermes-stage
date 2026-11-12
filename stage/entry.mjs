#!/usr/bin/env node
/**
 * Hermes Stage - Bot Room.
 *
 * One authenticated gateway connection per profile. Each connection opens a Stage Room
 * session (`Hermes Stage Room …`); Stage owns one ordered room log, feeds each addressed
 * member only the new room lines, and posts one reply per member. No message_agent relay.
 *
 * Speakers are derived from `profiles.list`; `HERMES_STAGE_PROFILES` is an optional
 * allow-list, not a hardcoded roster. Names come from skin branding first, then
 * profile metadata (display_name, Bot Mode title, profile id). The default profile is
 * the primary bot.
 *
 * Views: the all-caps STAGE tab is the full room; every profile tab, including the default profile, is a lens over the same log.
 * React.createElement only - no JSX build step.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { render, Box, Text, useApp, useInput, useBoxMetrics, useWindowSize } from 'ink';
import stringWidth from 'string-width';

const h = React.createElement;
const ROOT = process.env.HERMES_STAGE_ROOT || '';
const PY = process.env.HERMES_STAGE_PY || 'python3';
const DEFAULT_HOME = process.env.HERMES_STAGE_HOME || '';
const ENV_PROFILES = (process.env.HERMES_STAGE_PROFILES || '').trim();
const PROFILE_ORDER = ENV_PROFILES
  ? (ENV_PROFILES === 'all' ? null : ENV_PROFILES.split(',').map((s) => s.trim()).filter(Boolean))
  : null;
const PROFILE_FILTER = PROFILE_ORDER ? new Set(PROFILE_ORDER) : null;
const PROFILE_RANK = PROFILE_ORDER ? new Map(PROFILE_ORDER.map((n, i) => [n, i])) : null;
const AT_COMMANDS = [
  { display: '@mention', text: '@mention', meta: 'One-time message to a profile' },
  { display: '@focus', text: '@focus', meta: 'Switch the focused profile' },
];
const AT_BACK = { display: '‹ Back', text: 'back', meta: 'Close menu', isBack: true };

const MAX_ROUNDS = 3;
const MAX_MESSAGES = 10;
const MAX_DELTA_MESSAGES = 200;
const MAX_DELTA_CHARS = 32000;
const OVERSIZED_MESSAGE_CHARS = 8000;
const MAX_STATE_MESSAGES = 400;
const TOOL_CALL_COLOR = '#8A8F98';
const ACK_PHRASES = {
  Seed: 'Acknowledged.',
  Shir: '*nods*',
  Alys: '*nods*',
  Amy: '*nods*',
  Chaz: '*nods*',
  Demi: '*nods*',
  Hahn: '*nods*',
  Lutz: '*nods*',
  Mieu: '*nods*',
  Nei: '*nods*',
  Raja: '*smiles*',
  Rika: '*nods*',
  Rolf: 'Acknowledged.',
  Rune: '*nods*',
  Wren: 'Acknowledged.',
};

export function acknowledgementFor(bot) {
  const short = String((bot && bot.name) || '').split(' · ')[0].trim();
  return ACK_PHRASES[short] || '*nods*';
}

const MAX_PARALLEL_PROFILES = 2;
const RPC_TIMEOUT_MS = 60000;
const ROOM_STATE_PATH = process.env.HERMES_STAGE_ROOM_STATE
  || (DEFAULT_HOME
    ? `${DEFAULT_HOME}/state/hermes-stage-room.json`
    : `${process.env.HOME || '.'}/.hermes/hermes-stage-room.json`);
const DIFF_ADDED_BG = '#14532d';
const DIFF_REMOVED_BG = '#7f1d1d';
const STAGE_VERSION = '0.50.38';

function getGrant(home) {
  const helper = `${ROOT}/ui-tui/dist/scripts/gateway_bootstrap.py`;
  // Async so the Ink frame keeps repainting while a profile's ticket is minted.
  return new Promise((resolve, reject) => {
    execFile(PY, [helper, '--start'], {
      cwd: ROOT,
      env: { ...process.env, HERMES_HOME: home, PYTHONPATH: ROOT, HERMES_PYTHON_SRC_ROOT: ROOT },
      timeout: 90000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => {
      if (err) { reject(err); return; }
      try {
        const line = stdout.toString().trim().split('\n').filter(Boolean).pop();
        resolve(JSON.parse(line));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function loadRoomState() {
  try {
    const raw = readFileSync(ROOM_STATE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.bubbles) ? data.bubbles : []);
    return list
      .filter((b) => b && typeof b === 'object'
        && typeof b.id === 'string'
        && typeof b.speaker === 'string'
        && typeof b.text === 'string')
      .map((b) => ({ ...b, done: true }))
      .slice(-MAX_STATE_MESSAGES);
  } catch {
    return [];
  }
}

function saveRoomState(bubbles) {
  try {
    const clean = bubbles
      .filter((b) => b && b.done !== false
        && typeof b.id === 'string'
        && typeof b.speaker === 'string'
        && typeof b.text === 'string')
      .slice(-MAX_STATE_MESSAGES);
    const dir = dirname(ROOM_STATE_PATH);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${ROOM_STATE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      bubbles: clean,
    }, null, 2), { mode: 0o600 });
    renameSync(tmp, ROOM_STATE_PATH);
  } catch {
    // Persistence is best-effort; a failed save must never break the room.
  }
}

let stateSaveTimer = null;
function scheduleRoomStateSave(bubbles) {
  if (stateSaveTimer) clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(() => {
    stateSaveTimer = null;
    saveRoomState(bubbles);
  }, 150);
}

export async function connectRaw(home, onEvent, onRequest, onClose) {
  const grant = await getGrant(home);
  return new Promise((resolve, reject) => {
    let settleReady;
    let settleReadyReject;
    const ready = new Promise((res, rej) => { settleReady = res; settleReadyReject = rej; });
    let readyDone = false;
    let readyPayload = {};
    let connected = false;
    let finished = false;
    const ws = new WebSocket(grant.url, grant.protocols);
    const pending = new Map();
    let nextId = 1;

    const close = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(readyTimer);
      for (const entry of pending.values()) entry.reject(err);
      pending.clear();
      if (!readyDone) settleReadyReject(err);
      if (!connected) { reject(err); return; }
      try { onClose?.(err); } catch {}
    };
    const readyTimer = setTimeout(() => close(new Error('gateway ready timeout')), 30000);

    const rpc = (method, params = {}) => new Promise((res, rej) => {
      if (ws.readyState !== 1) return rej(new Error('gateway socket not open'));
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`gateway RPC timeout: ${method}`));
      }, RPC_TIMEOUT_MS);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); res(value); },
        reject: (error) => { clearTimeout(timer); rej(error); },
      });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.method === 'event') {
        const p = msg.params || {};
        if (p.type === 'gateway.ready') {
          if (!readyDone) {
            readyDone = true;
            readyPayload = p.payload || {};
            clearTimeout(readyTimer);
            settleReady();
          }
          return;
        }
        if (readyDone) onEvent(p);
        return;
      }
      if (msg.method && msg.id) {
        if (readyDone) onRequest?.(msg);
        return;
      }
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
      }
    });

    ws.addEventListener('error', () => close(new Error('gateway socket error')));
    ws.addEventListener('close', () => close(new Error('gateway socket closed')));

    ws.addEventListener('open', async () => {
      if (ws.protocol !== 'hermes-gateway-v1') {
        close(new Error(`bad subprotocol: ${ws.protocol}`));
        return;
      }
      try {
        await ready;
        try { await rpc('client.capabilities', { server_requests: true }); } catch {}
        connected = true;
        resolve({ ws, rpc, skin: readyPayload.skin || {} });
      } catch (e) {
        close(e);
      }
    });
  });
}

function skinAgentName(skin) {
  const b = (skin && skin.branding) || {};
  const n = String(b.agent_name || '').trim();
  return n ? n.replace(/\s+Agent$/i, '') : '';
}

function skinIcon(skin) {
  const b = (skin && skin.branding) || {};
  return String(b.icon || b.glyph || '').trim();
}

function profileIcon(p, skin) {
  const meta = (p && p.ui_meta && p.ui_meta['hermes-bots']) || {};
  return String(meta.icon || skinIcon(skin) || '').trim();
}

function displayName(p, skin, defaultAgent = '') {
  const d = String(p.display_name || '').trim();
  const t = String((p.ui_meta?.['hermes-bots'] || {}).title || '').trim();
  const agent = skinAgentName(skin);
  // The default profile is branded by its skin, not by the Bot Mode title.
  if (p.is_default && agent) return agent;
  // A custom per-profile skin may name a bot even without display_name; do not let the
  // install-wide default skin branding rename every profile.
  if (agent && agent !== defaultAgent && !d) return agent;
  return d || t || p.name;
}

function scrollbarLines(offset, total, visible) {
  const vp = Math.max(0, Math.min(visible, total));
  if (!vp) return [];
  if (total <= vp) return Array(vp).fill('┃');
  const thumb = Math.max(1, Math.round((vp * vp) / total));
  const travel = Math.max(1, vp - thumb);
  const pos = Math.max(0, Math.min(offset, total - vp));
  const top = Math.round((pos / travel) * Math.max(0, total - vp));
  const below = Math.max(0, vp - top - thumb);
  return [
    ...Array(top).fill('│'),
    ...Array(thumb).fill('┃'),
    ...Array(below).fill('│'),
  ];
}

function buildTheme(skin) {
  const b = (skin && skin.branding) || {};
  const c = (skin && skin.colors) || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = c[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  return {
    primary: pick('ui_primary', 'banner_title', 'ui_accent', 'banner_accent') || '#FFD700',
    accent: pick('ui_accent', 'banner_accent', 'ui_primary') || '#FFBF00',
    border: pick('ui_border', 'banner_border', 'input_rule', 'response_border') || '#CD7F32',
    bubbleBorder: pick('bubble_border') || '',
    text: pick('ui_text', 'banner_text', 'prompt') || '#FFF8DC',
    label: pick('ui_label', 'session_label', 'banner_dim') || '#DAA520',
    muted: pick('banner_dim', 'status_bar_dim', 'session_border') || '#B8860B',
    ok: pick('ui_ok', 'status_bar_good') || '#4caf50',
    warn: pick('ui_warn', 'status_bar_warn') || '#ffa726',
    error: pick('ui_error', 'status_bar_bad') || '#ef5350',
    tool: pick('ui_tool', 'ui_accent', 'banner_accent') || '#FFBF00',
    completionBg: pick('completion_menu_bg', 'background') || '#1b1b1b',
    completionCurrentBg: pick('completion_menu_current_bg', 'completion_menu_bg', 'background') || '#3a3a3a',
    promptSymbol: String(b.prompt_symbol || '❯').trim() || '❯',
    toolPrefix: String(skin && skin.tool_prefix || '┊').trim() || '┊',
  };
}

const AUTOMATION_KINDS = new Set([
  'process_complete',
  'async_delegation_complete',
  'internal_notification',
  'auto_continue',
  'diagnostic',
  'hidden',
  'model_switch',
]);

function isAutomationTurn(payload) {
  if (!payload) return false;
  const kind = String(payload.display_kind || '');
  if (kind && AUTOMATION_KINDS.has(kind)) return true;
  if (payload.notification_category) return true;
  const text = String(payload.text || payload.display_text || '');
  if (!text) return false;
  return /^\[IMPORTANT:|Background process \S+ completed|^\[ASYNC DELEGATION|^\[System:/.test(text);
}

export function admitDelta(cursor, payload, text) {
  const turnId = payload && typeof payload.turn_id === 'string' ? payload.turn_id : '';
  const segment = payload && Number.isInteger(payload.segment) ? payload.segment : null;
  if (!turnId || segment === null) return { cursor, text };
  const offset = Number.isInteger(payload.offset) ? payload.offset : 0;
  const end = offset + text.length;
  if (!cursor || cursor.turnId !== turnId || segment > cursor.segment) {
    return { cursor: { turnId, segment, end }, text };
  }
  if (segment < cursor.segment || end <= cursor.end) return { cursor, text: '' };
  return { cursor: { ...cursor, end }, text: text.slice(Math.max(0, cursor.end - offset)) };
}

const STAGE_ART = [
  '██╗  ██╗███████╗██████╗ ███╗   ███╗███████╗███████╗    ███████╗████████╗ █████╗  ██████╗ ███████╗',
  '██║  ██║██╔════╝██╔══██╗████╗ ████║██╔════╝██╔════╝    ██╔════╝╚══██╔══╝██╔══██╗██╔════╝ ██╔════╝',
  '███████║█████╗  ██████╔╝██╔████╔██║█████╗  ███████╗    ███████╗   ██║   ███████║██║  ███╗█████╗',
  '██╔══██║██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══╝  ╚════██║    ╚════██║   ██║   ██╔══██║██║   ██║██╔══╝',
  '██║  ██║███████╗██║  ██║██║ ╚═╝ ██║███████╗███████║    ███████║   ██║   ██║  ██║╚██████╔╝███████╗',
  '╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚══════╝    ╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
];
const STAGE_ART_WIDTH = Math.max(...STAGE_ART.map((line) => line.length));
const STAGE_ART_COLORS = ['primary', 'primary', 'accent', 'accent', 'border', 'border'];

const STAGE_FEATURES = [
  'Runs inside a terminal over SSH or a headless session.',
  'Fast startup and lightweight footprint, lower resource overhead.',
  'Keyboard-first operation; no window management or pointer dependency.',
  'Persistent terminal/tmux session that survives disconnects, preserving room state.',
  'Text-native transcript that is easy to copy, grep, log, or automate.',
  'Compact layout with the room, status, tabs, and composer in one frame.',
  'Theme and colors derived from the profile skin and terminal palette.',
  'Straightforward CLI launch and environment-configured roster.',
  'More predictable behavior on remote or low-resource machines.',
  'One user-centered multi-profile room with a single shared transcript.',
  'Unfiltered room view plus per-profile lens views over the same log.',
  'Public @name addressing, @everyone/@all, and opt-in peer pull-in.',
  'Bounded whole-room context per member, with each reply posted once.',
  'Concurrent turns for different profiles, with queued messages for a busy profile.',
  'Focused-profile status board: thinking/tool activity, queue state, and unread indicators.',
  'Profile-lens switching, focus control, and a separate STAGE room row.',
];

function StageHelp({ columns, t }) {
  const width = Math.max(20, Math.min(columns - 2, 120));
  const col = Math.max(14, Math.floor((width - 6) / 2));
  const gap = Math.max(0, width - (2 * col + 6));
  const title = 'HOW TO USE';
  const topDashes = Math.max(0, width - title.length - 5);

  const row = (leftKey, leftDesc, rightKey, rightDesc, key) => {
    const descLeftWidth = Math.max(6, col - stringWidth(leftKey) - 2);
    const descRightWidth = Math.max(6, col - stringWidth(rightKey) - 2);
    const leftDescFit = fitText(leftDesc, descLeftWidth);
    const rightDescFit = fitText(rightDesc, descRightWidth);
    const leftPlain = `${leftKey}  ${leftDescFit}`;
    const rightPlain = `${rightKey}  ${rightDescFit}`;
    const leftPad = ' '.repeat(Math.max(0, col - stringWidth(leftPlain)));
    const rightPad = ' '.repeat(Math.max(0, col - stringWidth(rightPlain)));
    return h(Text, { key, wrap: 'truncate-end' },
      h(Text, { color: t.border }, '│ '),
      h(Text, { color: t.label }, leftKey),
      h(Text, { color: t.muted }, `  ${leftDescFit}`),
      h(Text, { color: t.border }, leftPad + '  '),
      h(Text, { color: t.label }, rightKey),
      h(Text, { color: t.muted }, `  ${rightDescFit}`),
      h(Text, { color: t.border }, rightPad + ' '.repeat(gap) + ' │'));
  };

  return h(Box, { flexDirection: 'column', marginTop: 1, flexShrink: 0 },
    h(Text, { wrap: 'truncate-end' },
      h(Text, { color: t.border }, '╭─ '),
      h(Text, { color: t.primary, bold: true }, title),
      h(Text, { color: t.border }, ` ${'─'.repeat(topDashes)}╮`)),
    row('@', 'command menu', 'Shift+Arrow', 'focus profile', 'help-1'),
    row('Tab / Shift+Tab', 'cycle lenses', '↑ ↓ ← →', 'select tab', 'help-2'),
    row('@name', 'route one message', 'Esc', 'STAGE room', 'help-3'),
    row('Enter', 'send', 'PgUp / PgDn', 'scroll / wheel', 'help-4'),
    h(Text, { color: t.border }, `╰${'─'.repeat(Math.max(0, width - 2))}╯`));
}

function StageFeatures({ columns, t }) {
  const width = Math.max(20, Math.min(columns - 2, 120));
  const title = 'FEATURES';
  const topDashes = Math.max(0, width - title.length - 5);
  const textWidth = Math.max(10, width - 6);

  return h(Box, { flexDirection: 'column', marginTop: 0, flexShrink: 0 },
    h(Text, { wrap: 'truncate-end' },
      h(Text, { color: t.border }, '╭─ '),
      h(Text, { color: t.primary, bold: true }, title),
      h(Text, { color: t.border }, ` ${'─'.repeat(topDashes)}╮`)),
    ...STAGE_FEATURES.map((item, i) => {
      const text = fitText(item, textWidth);
      const plain = `• ${text}`;
      const pad = ' '.repeat(Math.max(0, width - 4 - stringWidth(plain)));
      return h(Text, { key: `feature-${i}`, wrap: 'truncate-end' },
        h(Text, { color: t.border }, '│ '),
        h(Text, { color: t.accent }, '• '),
        h(Text, { color: t.muted }, text),
        h(Text, { color: t.border }, pad + ' │'));
    }),
    h(Text, { color: t.border }, `╰${'─'.repeat(Math.max(0, width - 2))}╯`));
}

function StageBanner({ columns, t }) {
  if (columns >= STAGE_ART_WIDTH + 2) {
    return h(Box, { flexDirection: 'column', marginBottom: 0 },
      ...STAGE_ART.map((line, i) => h(Text, {
        key: `logo-${i}`,
        color: t[STAGE_ART_COLORS[i]] || t.muted,
        wrap: 'truncate-end',
      }, line)),
      h(StageFeatures, { columns, t }),
      h(StageHelp, { columns, t }));
  }
  const w = Math.max(20, Math.min(columns - 2, 72));
  return h(Box, { flexDirection: 'column', marginBottom: 0 },
    h(Text, { color: t.primary, bold: true }, '─ HERMES STAGE ─'),
    h(Text, { color: t.muted }, 'multi-bot room'),
    h(Text, { color: t.border }, '─'.repeat(w)));
}

function graphemes(value) {
  return Array.from(graphemeSegmenter.segment(String(value)), (part) => part.segment);
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function trimTrailingSpaces(text) {
  return String(text || '').split('\n').map((line) => line.replace(/[ \t]+$/, '')).join('\n');
}

export function wrapDisplayLine(line, width) {
  const chunks = [];
  let current = '';
  let used = 0;
  for (const glyph of graphemes(line)) {
    const glyphWidth = stringWidth(glyph);
    if (current && used + glyphWidth > width) {
      chunks.push(current);
      current = '';
      used = 0;
    }
    current += glyph;
    used += glyphWidth;
  }
  chunks.push(current);
  return chunks;
}

export function fitTail(text, maxLines, width) {
  const limit = Math.max(1, maxLines);
  const col = Math.max(8, width - 4);
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    const clean = raw.replace(/[ \t]+$/, '');
    if (!clean) { lines.push(''); continue; }
    lines.push(...wrapDisplayLine(clean, col));
  }
  if (lines.length <= limit) return lines.join('\n');
  const tail = limit > 1 ? lines.slice(-(limit - 1)) : lines.slice(-1);
  return `…\n${tail.join('\n')}`;
}

export function fitText(s, width) {
  const text = String(s);
  const max = Math.max(1, width);
  if (stringWidth(text) <= max) return text;
  const limit = Math.max(0, max - 1);
  let out = '';
  let used = 0;
  for (const glyph of graphemes(text)) {
    const glyphWidth = stringWidth(glyph);
    if (used + glyphWidth > limit) break;
    out += glyph;
    used += glyphWidth;
  }
  return `${out}…`;
}



function BootFrame({ columns, t, notice, focusedName, total, view, rows }) {
  return h(Box, { flexDirection: 'column', paddingX: 1, height: rows, flexShrink: 0 },
    h(StagePanelBar, { focusedName, total, view, t, columns }),
    h(Box, { key: 'boot-banner-space', height: 1, flexShrink: 0 }),
    h(StageBanner, { columns, t }),
    h(Text, { color: t.muted }, 'starting room… connecting to the default profile'),
    h(Text, { color: t.muted, dimColor: true }, 'the rest of the crew joins once the default profile is ready'),
    notice ? h(Text, { color: t.error }, notice) : null);
}

function StagePanelBar({ focusedName, total, view, t, columns }) {
  const width = Math.max(20, Math.min(columns - 2, 100));
  const lens = view && view !== 'stage' ? `${String(view).split(' · ')[0]} lens` : 'room';
  const head = `Hermes Stage v${STAGE_VERSION} · ${lens} · ${total} profiles · focus `;
  return h(Box, { width, marginBottom: 0 },
    h(Text, { wrap: 'truncate-end', width },
      h(Text, { color: t.primary, bold: true }, head),
      h(Text, { color: 'yellow', bold: true }, focusedName)));
}

function tabLabel(item) {
  return `${item.name}${item.glyph ? ` ${item.glyph}` : ''}`;
}

function StageTabs({ tabs, view, unread, statuses, t, columns, tick }) {
  const width = Math.max(20, Math.min(columns - 2, 120));
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'][tick % 8];
  const [scroll, setScroll] = React.useState(0);
  const items = [];

  const addTab = (item, key, active, target = items) => {
    const short = `${item.primary ? '*' : ''}${fitText(String(item.name).split(' · ')[0], 11)}`;
    const st = statuses[item.name] || (item.connected ? 'ready' : 'connecting');
    const count = unread[item.name] || 0;
    let glyph = '';
    let color = t.muted;
    let dim = false;
    if (st === 'error' || st === 'not-ready' || st === 'offline') {
      glyph = '●';
      color = t.error;
      dim = st === 'offline';
    } else if (count > 0) {
      glyph = '●';
      color = '#5aa9ff';
    } else if (st.startsWith('queued')) {
      glyph = '⏸';
      color = t.muted;
      dim = true;
    } else if (st === 'connecting') {
      // Roster is known up front: unmounted profiles stay gray with a spinner.
      glyph = `${spinner}  `;
      color = t.muted;
      dim = true;
    } else if (st !== 'ready') {
      glyph = `${spinner}  `;
      color = t.warn;
    }
    target.push({
      key,
      name: short,
      icon: item.icon || '',
      glyph,
      active,
      color,
      dim,
    });
  };

  // Profile lenses: one left-aligned row. STAGE is a separate right-aligned
  // room line rendered above the composer; there is no separator pipe.
  for (const item of tabs) addTab(item, item.name, view === item.name);

  const itemWidth = (item) => stringWidth(`[${tabLabel(item)}]`);
  const totalProfileWidth = items.reduce((sum, item, i) => sum + itemWidth(item) + (i ? 1 : 0), 0);
  const scrollMode = totalProfileWidth > width;
  const windowLimit = Math.max(12, width - (scrollMode ? 4 : 0));
  const takeWindow = (start) => {
    const out = [];
    let used = 0;
    for (let i = start; i < items.length; i += 1) {
      const w = itemWidth(items[i]);
      const add = out.length ? 1 + w : w;
      if (out.length && used + add > windowLimit) break;
      out.push({ item: items[i], index: i });
      used += add;
    }
    return { out, used };
  };

  React.useEffect(() => {
    if (!scrollMode) {
      if (scroll !== 0) setScroll(0);
      return;
    }
    const selected = tabs.findIndex((item) => item.name === view);
    if (selected < 0) return;
    const { out } = takeWindow(scroll);
    const first = scroll;
    const last = scroll + out.length - 1;
    if (selected < first) {
      setScroll(selected);
    } else if (selected > last) {
      setScroll(Math.max(0, selected - out.length + 1));
    }
  }, [view, scrollMode, windowLimit, scroll, tick]);

  const window = scrollMode ? takeWindow(scroll).out : items.map((item, index) => ({ item, index }));
  const hasLeft = scrollMode && scroll > 0;
  const lastIndex = window.length ? window[window.length - 1].index : -1;
  const hasRight = scrollMode && lastIndex < items.length - 1;

  return h(Box, {
    flexDirection: 'column',
    width,
    flexShrink: 0,
    alignItems: 'flex-start',
  },
  h(Text, { key: 'profile-row', wrap: 'truncate-end' },
    hasLeft ? h(Text, { key: 'scroll-left', color: t.border }, '‹ ') : null,
    ...window.flatMap(({ item }, i) => [
      i > 0 ? h(Text, { key: `gap-${i}`, color: t.border }, ' ') : null,
      h(Text, {
        key: `tab-${i}`,
        color: item.active ? t.text : item.color,
        bold: item.active,
        dimColor: item.dim,
        backgroundColor: item.active ? t.completionCurrentBg : t.completionBg,
        wrap: 'truncate-end',
      }, `[${tabLabel(item)}]`),
    ]),
    hasRight ? h(Text, { key: 'scroll-right', color: t.border }, ' ›') : null));
}

function StageRoomRow({ view, t, columns }) {
  const active = view === 'stage';
  const width = Math.max(20, Math.min(columns - 2, 120));
  return h(Box, { width, flexShrink: 0, flexDirection: 'column', alignItems: 'flex-end' },
    h(Text, { key: 'stage-row', wrap: 'truncate-end' },
      h(Text, {
        color: active ? t.text : t.muted,
        bold: active,
        backgroundColor: active ? t.completionCurrentBg : t.completionBg,
        wrap: 'truncate-end',
      }, '[STAGE]')));
}

function centeredRule(label, rule, width, leftShift = 0) {
  const text = String(label);
  if (text.length >= width) return text.slice(0, width);
  const center = (width - text.length) / 2;
  const left = Math.max(1, Math.round(center - (width / 2) * leftShift));
  return rule.repeat(left) + text + rule.repeat(Math.max(0, width - left - text.length));
}

function toolTrailLabel(name) {
  const raw = String(name || 'tool');
  return raw.split('_').filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') || raw;
}

function compactPreview(value, max = 64) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function roomLine(entry) {
  const name = entry.speaker === 'You' ? 'Architect' : entry.speaker;
  return `${name}: ${entry.text}`;
}

export function boundedRoomDelta(log, from) {
  const start = Math.max(0, from || 0);
  let entries = log.slice(start).filter((b) => !b.private);
  let omitted = 0;
  if (entries.length > MAX_DELTA_MESSAGES) {
    omitted += entries.length - MAX_DELTA_MESSAGES;
    entries = entries.slice(-MAX_DELTA_MESSAGES);
  }
  const lines = entries.map((b) => {
    let line = roomLine(b);
    if (line.length > OVERSIZED_MESSAGE_CHARS) {
      line = `${line.slice(0, OVERSIZED_MESSAGE_CHARS)} … [truncated]`;
    }
    return line;
  });
  let joined = lines.join('\n');
  while (joined.length > MAX_DELTA_CHARS && lines.length > 1) {
    lines.shift();
    omitted += 1;
    joined = lines.join('\n');
  }
  if (joined.length > MAX_DELTA_CHARS) {
    joined = `${joined.slice(0, MAX_DELTA_CHARS)} … [truncated]`;
  }
  return { text: joined, omitted };
}

function formatToolCall(name, context = '') {
  const label = toolTrailLabel(name);
  const preview = compactPreview(context, 64);
  return preview ? `${label}("${preview}")` : label;
}

function formatToolLabelPayload(label) {
  const text = String(label.text || label.name || 'tool').trim();
  const preview = compactPreview(label.preview || '', 72);
  const combined = preview ? `${text}  ${preview}` : text;
  return `${String(label.emoji || '●').trim() || '●'} ${combined.slice(0, 72)}`;
}

function formatToolLabels(labels) {
  if (!Array.isArray(labels) || !labels.length) return '';
  const first = formatToolLabelPayload(labels[0]);
  return labels.length > 1 ? `${first} +${labels.length - 1}` : first;
}

function activeToolLabel(toolState, now) {
  if (!toolState) return '';
  const items = [];
  if (toolState.draftName) {
    items.push({ drafting: true, name: toolState.draftName });
  }
  for (const tool of Object.values(toolState.active || {})) items.push(tool);
  if (!items.length) return '';

  const first = items[0];
  let label;
  if (first.drafting) {
    label = `● drafting ${toolTrailLabel(first.name)}…`;
  } else if (first.labels && first.labels.length) {
    label = formatToolLabels(first.labels);
  } else {
    label = `● ${formatToolCall(first.name, first.context)}`;
  }
  if (!first.drafting && first.startedAt) {
    label += ` (${(Math.max(0, now - first.startedAt) / 1000).toFixed(1)}s)`;
  }
  if (items.length > 1) label += ` +${items.length - 1}`;
  return label;
}

function stripAnsi(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '');
}

function cleanInlineDiff(raw) {
  const text = stripAnsi(raw).trim();
  return text.replace(/^\s*┊[^\n]*\n?/, '').trim();
}

const DIFF_FILE_RE = /^a\/(.+?) → b\/(.+)$/m;

// Display paths resolve cwd-relative first, then home-relative, then absolute.
function mentionsMember(name, text) {
  const short = String(name).toLowerCase().split(' · ')[0].trim();
  if (!short) return false;
  const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_])@${escaped}\\b`, 'i').test(String(text || ''));
}

export function displayPath(path, cwd) {
  let p = String(path || '').trim();
  if (p.startsWith('//')) p = p.slice(1);
  if (!p || !p.startsWith('/')) return p;
  const home = process.env.HOME || '';
  const base = String(cwd || '').replace(/\/+$/, '');
  if (base && p.startsWith(`${base}/`)) return p.slice(base.length + 1);
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`;
  return p;
}

// Stock collapses the `a/<path> → b/<path>` header into one path line.
function diffFileLabel(line, cwd) {
  const match = DIFF_FILE_RE.exec(String(line || ''));
  if (!match) return null;
  const oldPath = displayPath(match[1], cwd);
  const newPath = displayPath(match[2], cwd);
  return oldPath === newPath ? newPath : `${oldPath} → ${newPath}`;
}

export function splitDiffFences(text) {
  const src = String(text || '');
  const re = /```[ \t]*diff[ \t]*\r?\n([\s\S]*?)```/gi;
  re.lastIndex = 0;
  const first = re.exec(src);
  if (!first) return null;
  re.lastIndex = 0;
  const parts = [];
  let last = 0;
  let match;
  while ((match = re.exec(src))) {
    const before = src.slice(last, match.index);
    if (before) parts.push({ kind: 'text', text: before });
    const diff = match[1].replace(/[ \t]+$/gm, '').trim();
    if (diff) parts.push({ kind: 'diff', text: diff });
    last = re.lastIndex;
  }
  const after = src.slice(last);
  if (after) parts.push({ kind: 'text', text: after });
  return parts.length ? parts : null;
}

function appendTextPart(parts, delta) {
  const next = Array.isArray(parts) ? parts.slice() : [];
  const last = next[next.length - 1];
  const value = String(delta);
  if (!last || last.kind !== 'text') {
    next.push({ kind: 'text', text: value.replace(/^\s+/, '') });
  } else {
    next[next.length - 1] = {
      ...last,
      text: last.text + (last.text ? value : value.replace(/^\s+/, '')),
    };
  }
  return next;
}

export function upsertToolPart(bubble, tool) {
  const parts = Array.isArray(bubble.parts) ? bubble.parts.slice() : [];
  const id = String(tool.tool_id || tool.id || '');
  let index = -1;
  if (id) {
    index = parts.findIndex((part) => part.kind === 'tool'
      && String(part.tool_id || part.id || '') === id);
  }
  if (index < 0) {
    index = parts.findIndex((part) => part.kind === 'tool'
      && part.name === tool.name
      && part.context === tool.context);
  }
  if (index >= 0) parts[index] = { ...parts[index], ...tool };
  else parts.push({ kind: 'tool', ...tool });
  return { ...bubble, parts };
}

export function hasToolPart(bubble) {
  return Array.isArray(bubble.parts) && bubble.parts.some((part) => part.kind === 'tool');
}

function hasDiffPart(bubble) {
  return Array.isArray(bubble.parts) && bubble.parts.some((part) =>
    part.kind === 'diff' || (part.kind === 'tool' && part.diff));
}

function renderDiffPart(diff, t, partIndex = 0, prefix = '', cwd = '') {
  const lines = String(diff || '').split('\n');
  return h(Box, { key: `diff-part-${partIndex}`, flexDirection: 'column', marginTop: 1 }, lines.map((line, i) => {
    const clean = line.replace(/[ \t]+$/, '');
    const fileLabel = diffFileLabel(clean, cwd);
    if (fileLabel) {
      return h(Text, {
        key: `diff-${partIndex}-${i}`,
        color: t.text,
        bold: true,
        wrap: 'truncate-end',
      }, prefix + fileLabel);
    }
    const add = clean.startsWith('+');
    const del = clean.startsWith('-');
    const hunk = clean.startsWith('@@');
    return h(Text, {
      key: `diff-${partIndex}-${i}`,
      color: add || del ? '#ffffff' : hunk ? t.muted : undefined,
      backgroundColor: add ? DIFF_ADDED_BG : del ? DIFF_REMOVED_BG : undefined,
      dimColor: !add && !del && !hunk && clean.startsWith(' '),
      wrap: 'truncate-end',
    }, prefix + (clean || ' '));
  }));
}

function renderToolPart(part, t, partIndex = 0, ctx = {}) {
  const name = toolTrailLabel(part.name || 'tool');
  const cwd = ctx.cwd || '';
  const context = compactPreview(part.context || part.args_text || '', 80);
  const summary = compactPreview(part.summary || part.result_text || '', 180);
  const status = String(part.status || (part.duration_s != null ? 'done' : 'active'));
  const duration = typeof part.duration_s === 'number' ? ` ${part.duration_s.toFixed(1)}s` : '';
  const mark = status === 'waiting_approval' ? ' …' : status === 'timed_out' || status === 'error' ? ' ✗' : status === 'done' ? ' ✓' : ' …';
  const call = context ? `${name}("${context}")` : name;
  const lead = `🔧 ${call}`;
  const header = `${lead}${duration}${mark}`;
  const children = [
    h(Text, {
      key: `tool-${partIndex}-header`,
      color: TOOL_CALL_COLOR,
      italic: true,
      wrap: 'truncate-end',
    }, header),
  ];
  if (summary) {
    children.push(h(Text, {
      key: `tool-${partIndex}-summary`,
      color: TOOL_CALL_COLOR,
      wrap: 'truncate-end',
      dimColor: true,
    }, summary));
  }
  if (part.diff) children.push(renderDiffPart(part.diff, t, partIndex, '│ ', cwd));
  return h(Box, { key: `tool-part-${partIndex}`, flexDirection: 'column' }, children);
}

export function isEnterKey(input, key) {
  // Composer submit treats any CR/LF in the chunk as Enter. The card must do
  // the same: some terminals deliver one read of CR+LF, which is not key.return
  // and is not a single CR or LF, so the approval branch used to swallow it.
  if (key && key.return) return true;
  const raw = String(input || '');
  return raw.length > 0 && /^[\r\n]+$/.test(raw);
}

export function isEscapeKey(input, key) {
  if (key && key.escape) return true;
  return String(input || '') === '\u001b';
}

export function approvalAction(input, key, selected, choices) {
  if (isEscapeKey(input, key)) return { kind: 'choose', choice: 'deny' };

  const n = Number(input);
  if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
    return { kind: 'choose', choice: choices[n - 1] };
  }

  if (isEnterKey(input, key)) {
    const index = Math.max(0, Math.min(selected, choices.length - 1));
    return { kind: 'choose', choice: choices[index] || 'deny' };
  }

  if (!key) return { kind: 'noop' };
  if (key.upArrow) return { kind: 'move', delta: -1 };
  if (key.downArrow) return { kind: 'move', delta: 1 };
  return { kind: 'noop' };
}

export function approvalAnswer(entry, choice) {
  if (entry.server_request_id) {
    return { path: 'server', id: entry.server_request_id, result: { choice } };
  }
  if (entry.source === 'event' && entry.prompt_id && Number.isFinite(entry.execution_generation)) {
    return {
      path: 'canonical',
      method: 'approval.respond',
      params: {
        session_id: entry.session_id,
        prompt_id: entry.prompt_id,
        execution_generation: entry.execution_generation,
        choice,
      },
    };
  }
  return {
    path: 'legacy',
    method: 'approval.respond',
    params: {
      session_id: entry.session_id,
      request_id: entry.request_id,
      choice,
    },
  };
}

const APPROVAL_LABELS = {
  once: 'Approve once',
  session: 'Approve for session',
  always: 'Always allow',
  deny: 'Deny',
};

function approvalCommandLines(approval, columns) {
  const innerWidth = Math.max(20, Math.min(columns - 8, 100));
  const command = String(approval.command || approval.description || '');
  return wrapDisplayLine(command, innerWidth).slice(0, 6);
}

function approvalCardRows(approval, columns) {
  const choices = approval.choices && approval.choices.length ? approval.choices : ['once', 'deny'];
  return 4 + approvalCommandLines(approval, columns).length + choices.length;
}

function renderApprovalCard({ approval, selected, t, columns }) {
  const width = Math.max(20, Math.min(columns - 2, 120));
  const choices = approval.choices && approval.choices.length ? approval.choices : ['once', 'deny'];
  const lines = approvalCommandLines(approval, columns);
  const sel = Math.max(0, Math.min(selected, choices.length - 1));
  return h(Box, {
    width,
    flexShrink: 0,
    borderStyle: 'double',
    borderColor: t.warn,
    paddingX: 1,
    marginTop: 1,
    flexDirection: 'column',
  },
  h(Text, { color: t.warn, bold: true, wrap: 'truncate-end' },
    `⚠ Approval required · ${approval.bot.name}${approval.tool_name ? ` · ${toolTrailLabel(approval.tool_name)}` : ''}`),
  ...lines.map((line, i) => h(Text, {
    key: `approval-command-${i}`,
    color: t.text,
    wrap: 'truncate-end',
  }, line || ' ')),
  h(Text, { color: t.muted, dimColor: true },
    `↑/↓ select · Enter confirm · 1-${choices.length} pick · Esc deny`),
  ...choices.map((choice, i) => h(Text, {
    key: `approval-choice-${i}`,
    color: i === sel ? t.primary : t.text,
    bold: i === sel,
    backgroundColor: i === sel ? t.completionCurrentBg : undefined,
    wrap: 'truncate-end',
  }, `${i === sel ? '▸ ' : '  '}${i + 1}. ${APPROVAL_LABELS[choice] || choice}`)));
}

function ctxBar(pct, w = 10) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((p / 100) * w);
  return '█'.repeat(filled) + '░'.repeat(w - filled);
}

function ctxBarColor(pct, t) {
  if (pct == null) return t.muted;
  if (pct >= 95) return t.error;
  if (pct > 80) return t.error;
  if (pct >= 50) return t.warn;
  return t.ok;
}

function statusParts(name, runtime, status, t, live, tick, columns, tool, unreadCount = 0, thinking = false, queuedCount = 0) {
  const u = (runtime && runtime.usage) || {};
  const profile = fitText(name.split(' · ')[0], 18);
  const model = fitText(runtime && runtime.model
    ? runtime.model.replace(/^.*\//, '')
    : '—', 24);
  const max = Number(u.context_max) || 0;
  const used = Number(u.context_used) || 0;
  const total = Number(u.total) || 0;
  const pct = typeof u.context_percent === 'number'
    ? Math.max(0, Math.min(100, Math.round(u.context_percent)))
    : (max ? Math.max(0, Math.min(100, Math.round((used / max) * 100))) : null);
  const estimated = u.context_estimated ? '~' : '';
  const contextLabel = max
    ? `${estimated}${compactNumber(used)}/${compactNumber(max)}`
    : total
      ? `${compactNumber(total)} tok`
      : '--';
  const bar = max && pct !== null ? ctxBar(pct) : '';
  const pctText = pct !== null ? `${estimated}${pct}%` : '';
  const barColor = ctxBarColor(pct, t);
  const latency = typeof u.avg_latency_s === 'number'
    ? `◷ ${u.avg_latency_s.toFixed(1)}s`
    : '◷ --';
  const tpsValue = typeof u.avg_tps === 'number' && u.avg_tps > 0
    ? u.avg_tps
    : (live && typeof live.tps === 'number' ? live.tps : 0);
  const tps = `↑ ${Math.round(tpsValue)} t/s`;
  const cacheHit = typeof u.cache_hit_pct === 'number' ? `◎ ${u.cache_hit_pct}%` : '';
  const compressions = typeof u.compressions === 'number' && u.compressions > 0
    ? `cmp ${u.compressions}`
    : '';
  const subagents = typeof u.active_subagents === 'number' && u.active_subagents > 0
    ? `⛓ ${u.active_subagents}`
    : '';
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'][tick % 8];
  const unavailable = status === 'not-ready' || status === 'offline';
  const busy = status !== 'ready' && status !== 'error' && !unavailable;

  let activity = '';
  let activityColor = t.muted;
  if (status === 'error') {
    activity = '●';
    activityColor = t.error;
  } else if (unreadCount > 0) {
    activity = '●';
    activityColor = '#5aa9ff';
  } else if (String(status).startsWith('queued')) {
    activity = '⏸';
    activityColor = t.muted;
  } else if (busy) {
    activity = spinner;
    activityColor = t.warn;
  }

  return {
    profile,
    model,
    contextLabel,
    bar,
    pctText,
    barColor,
    latency,
    tps,
    cacheHit,
    compressions,
    subagents,
    activity,
    activityColor,
    thinkingLabel: thinking ? '◇ Thinking…' : '',
    toolLabel: tool ? activeToolLabel(tool, Date.now()) : '',
    queuedLabel: queuedCount > 0 ? `⏸ ${queuedCount} queued` : '',
    color: String(status).startsWith('queued') ? t.muted : busy ? t.warn : t.muted,
    dim: unavailable,
    width: Math.max(20, columns - 2),
  };
}

function compactNumber(n) {
  const v = Number(n) || 0;
  if (v >= 999950) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 999.5) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
}

function useRoom(viewRef) {
  const [bubbles, setBubbles] = React.useState(() => loadRoomState());
  const bubblesRef = React.useRef(bubbles);
  const setLog = React.useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(bubblesRef.current) : updater;
    bubblesRef.current = next;
    setBubbles(next);
    scheduleRoomStateSave(next);
  }, []);
  React.useEffect(() => {
    const flush = () => saveRoomState(bubblesRef.current);
    process.on('exit', flush);
    return () => process.off('exit', flush);
  }, []);
  const [statuses, setStatuses] = React.useState({});
  const [notice, setNotice] = React.useState('');
  const [tick, setTick] = React.useState(0);
  const clientsRef = React.useRef([]);
  const [botList, setBotList] = React.useState([]);
  const activeRef = React.useRef(new Map());
  const streamTurnRef = React.useRef(new Map());
  const segmentRef = React.useRef(new Map());
  const pendingRef = React.useRef(new Map());
  const [pending, setPending] = React.useState({});
  const queueRef = React.useRef(new Map());
  const [queues, setQueues] = React.useState({});
  const autoTurnRef = React.useRef(new Set());
  const turnMetaRef = React.useRef(new Map());
  const roundRef = React.useRef({
    active: false,
    round: 0,
    current: new Set(),
    remaining: 0,
    seen: new Set(),
    next: new Map(),
    messages: 0,
  });
  const [approvals, setApprovals] = React.useState([]);
  const [runtimes, setRuntimes] = React.useState({});
  const [liveMetrics, setLiveMetrics] = React.useState({});
  const [unread, setUnread] = React.useState({});
  const [roster, setRoster] = React.useState([]);
  const [online, setOnline] = React.useState(false);
  const [tools, setTools] = React.useState({});
  const [thinking, setThinking] = React.useState({});
  const [focusName, setFocusName] = React.useState('');
  const [theme, setTheme] = React.useState(null);

  const clearUnread = React.useCallback((name) => {
    setUnread((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const syncPending = React.useCallback(() => {
    const next = {};
    for (const [name, count] of pendingRef.current) if (count > 0) next[name] = count;
    setPending(next);
  }, []);

  const pendingOf = React.useCallback((name) => pendingRef.current.get(name) || 0, []);

  const syncQueues = React.useCallback(() => {
    const next = {};
    for (const [name, q] of queueRef.current) if (q.length) next[name] = q.length;
    setQueues(next);
  }, []);

  const streaming = Object.values(statuses).some((s) =>
    s && s !== 'ready' && s !== 'error' && s !== 'not-ready' && s !== 'offline')
    || Object.values(tools).some((t) => t && (t.draftName || Object.keys(t.active || {}).length > 0))
    || Object.keys(thinking).length > 0;

  const setRuntimeFor = (bot, info) => {
    if (!bot) return;
    setRuntimes((prev) => {
      const old = prev[bot.name] || {};
      const incoming = info || {};
      const incomingUsage = incoming.usage;
      const usage = incomingUsage
        ? { ...(old.usage || {}), ...incomingUsage }
        : (old.usage || null);
      return {
        ...prev,
        [bot.name]: {
          model: incoming.model || old.model || '',
          cwd: incoming.cwd || old.cwd || '',
          usage,
        },
      };
    });
  };

  React.useEffect(() => {
    if (!streaming) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 400);
    return () => clearInterval(id);
  }, [streaming]);

  function peerExample(bot) {
    const peer = clientsRef.current.find((c) => c !== bot && c.name && !c.offline);
    return String((peer && peer.name) || 'Name').split(' · ')[0];
  }

  function buildMemberPrompt(bot, log) {
    const names = clientsRef.current.filter((c) => !c.offline).map((c) => c.name).join(', ');
    const { text: delta, omitted } = boundedRoomDelta(log, bot.seenSeq || 0);
    return `[Hermes Stage group room: ${names}. You are ${bot.name}. ` +
      'Reply to the room as yourself. Do not use message_agent. ' +
      'The Architect is the user in this room; a request relayed by a teammate in this room is a room request. ' +
      'This is a serial group Discussion. Reply with one conversational message only when you have something new worth adding; if you have nothing new to add, reply exactly "(pass)". ' +
      `Mention a teammate by handle (for example "@${peerExample(bot)}") to pull them into the next round; do not repeat points already made. ` +
      'When the Architect asks you to ask or tell a teammate, write "@Name ..." so that member\'s turn runs. ' +
      'To address every member at once, write "@everyone" (or "@all") in your reply; do not list several @ names. ' +
      'A bot reply containing "@Name" is a public room message that pulls that member into the next round; do not expect a private reply. ' +
      'Keep it short, answer only what was asked, and do not narrate delivery receipts.]\n\n' +
      `New room messages since your last turn${omitted ? ` (${omitted} earlier messages omitted)` : ''}:\n${delta || '(none)'}\n\n` +
      'Reply to the room now.';
  }

  function buildQueuedPrompt(bot, text) {
    const names = clientsRef.current.filter((c) => !c.offline).map((c) => c.name).join(', ');
    const { text: delta, omitted } = boundedRoomDelta(bubblesRef.current, bot.seenSeq || 0);
    return `[Hermes Stage group room: ${names}. You are ${bot.name}. ` +
      'Reply to the room as yourself. Do not use message_agent. ' +
      'The Architect is the user in this room; a request relayed by a teammate in this room is a room request. ' +
      'This is a serial group Discussion. Reply with one conversational message only when you have something new worth adding; if you have nothing new to add, reply exactly "(pass)". ' +
      `Mention a teammate by handle (for example "@${peerExample(bot)}") to pull them into the next round; do not repeat points already made. ` +
      'When the Architect asks you to ask or tell a teammate, write "@Name ..." so that member\'s turn runs. ' +
      'To address every member at once, write "@everyone" (or "@all") in your reply; do not list several @ names. ' +
      'A bot reply containing "@Name" is a public room message that pulls that member into the next round; do not expect a private reply. ' +
      'Keep it short, answer only what was asked, and do not narrate delivery receipts.]\n\n' +
      `New room messages since your last turn${omitted ? ` (${omitted} earlier messages omitted)` : ''}:\n${delta || '(none)'}\n\n` +
      `Architect's queued message: ${text}\n\nReply to the room now.`;
  }

  async function promptMember(bot, overrideText) {
    if (bot.offline) {
      pendingRef.current.set(bot.name, Math.max(0, (pendingRef.current.get(bot.name) || 1) - 1));
      syncPending();
      autoTurnRef.current.delete(bot.name);
      setNotice(`${bot.name} is offline`);
      setStatuses((s) => ({ ...s, [bot.name]: 'offline' }));
      return false;
    }
    try {
      const text = overrideText != null ? overrideText : buildMemberPrompt(bot, bubblesRef.current);
      // The gateway admits this as a queued submission and runs it FIFO behind
      // any running turn (Hermes queue semantics), so no client-side wait.
      await bot.rpc('prompt.submit', {
        session_id: bot.sessionId,
        submission_id: newId('sub'),
        text,
      });
      bot.seenSeq = bubblesRef.current.length;
      return true;
    } catch (e) {
      pendingRef.current.set(bot.name, Math.max(0, (pendingRef.current.get(bot.name) || 1) - 1));
      syncPending();
      autoTurnRef.current.delete(bot.name);
      const d = roundRef.current;
      if (d.active && d.current.has(bot.name)) {
        d.current.delete(bot.name);
        d.remaining = Math.max(0, d.remaining - 1);
      }
      setNotice(`${bot.name}: ${e.message}`);
      setStatuses((s) => ({ ...s, [bot.name]: bot.offline ? 'offline' : 'ready' }));
      if (d.active && d.remaining === 0) advanceDiscussion();
      return false;
    }
  }

  async function drainQueue(bot) {
    if (pendingOf(bot.name) > 0) return false;
    const q = queueRef.current.get(bot.name);
    if (!q || !q.length) return false;
    const entry = q.shift();
    syncQueues();
    pendingRef.current.set(bot.name, 1);
    syncPending();
    setStatuses((s) => ({ ...s, [bot.name]: 'waiting…' }));
    setNotice((n) => (String(n).startsWith('queued for ') ? '' : n));
    const ok = await promptMember(bot, buildQueuedPrompt(bot, entry.text));
    if (!ok) {
      // Never lose a queued message: put it back at the head.
      const rest = queueRef.current.get(bot.name) || [];
      rest.unshift(entry);
      queueRef.current.set(bot.name, rest);
      syncQueues();
      pendingRef.current.set(bot.name, 0);
      syncPending();
    }
    return ok;
  }

  function hasBroadcast(text) {
    return /(?:^|[^A-Za-z0-9_])@(everyone|all)\b/i.test(String(text));
  }

  function mentionedPeers(text, selfName) {
    const raw = String(text);
    const matches = [...raw.matchAll(/(?:^|[^A-Za-z0-9_])@([A-Za-z][\w-]*)\b/g)];
    const peers = [];
    const seen = new Set();
    for (const m of matches) {
      const handle = m[1].toLowerCase();
      const peer = clientsRef.current.find((c) => {
        const short = c.name.toLowerCase().split(' · ')[0];
        return short === handle || c.name.toLowerCase() === handle || String(c.profile || '').toLowerCase() === handle;
      });
      if (!peer || peer.name === selfName || seen.has(peer.name)) continue;
      seen.add(peer.name);
      peers.push(peer);
    }
    return peers;
  }

  function addressedPeers(text, selfName) {
    if (hasBroadcast(text)) {
      return clientsRef.current.filter((c) => c.name !== selfName);
    }
    return mentionedPeers(text, selfName);
  }

  // Public, fire-and-forget address: the named member takes a turn in the shared
  // room. The reply is posted to the log; nothing is fed back to the asker.
  function triggerAddressed(peer) {
    if (!peer || peer.offline) return;
    if (autoTurnRef.current.has(peer.name)) return;
    autoTurnRef.current.add(peer.name);
    turnMetaRef.current.set(peer.name, { asksPeer: false });
    pendingRef.current.set(peer.name, (pendingRef.current.get(peer.name) || 0) + 1);
    syncPending();
    setStatuses((s) => ({ ...s, [peer.name]: 'waiting…' }));
    promptMember(peer);
  }

  function addNextPeer(peer, citeAt) {
    const d = roundRef.current;
    if (!d.active) return;
    const lastPost = d.lastPost.get(peer.name) || 0;
    if (lastPost > citeAt) return;
    d.next.set(peer.name, peer);
    d.citedAt.set(peer.name, citeAt);
  }

  function advanceDiscussion() {
    const d = roundRef.current;
    if (!d.active) return;
    if (d.messages >= MAX_MESSAGES) {
      d.active = false;
      setNotice('Discussion stopped at 10 messages.');
      return;
    }
    const next = [...d.next.values()].filter((peer) => {
      const lastPost = d.lastPost.get(peer.name) || 0;
      const citedAt = d.citedAt.get(peer.name) || 0;
      return lastPost <= citedAt;
    });
    if (!next.length || d.round + 1 >= MAX_ROUNDS) {
      d.active = false;
      if (d.round + 1 >= MAX_ROUNDS && next.length) {
        setNotice(`Discussion stopped at ${MAX_ROUNDS} rounds.`);
      }
      return;
    }
    d.round += 1;
    d.next = new Map();
    d.citedAt = new Map();
    d.current = new Set(next.map((peer) => peer.name));
    d.remaining = next.length;
    for (const peer of next) triggerAddressed(peer);
  }

  function startDiscussion(targets) {
    const names = targets.map((bot) => bot.name);
    roundRef.current = {
      id: newId('round'),
      active: names.length > 0,
      round: 0,
      current: new Set(names),
      remaining: names.length,
      next: new Map(),
      citedAt: new Map(),
      lastPost: new Map(),
      messages: 0,
    };
  }

  React.useEffect(() => {
    let dead = false;

    const updateToolStatus = (bot, toolName, status) => {
      const bubbleId = activeRef.current.get(bot.name);
      if (!bubbleId) return;
      setLog((prev) => prev.map((b) => (b.id === bubbleId
        ? {
          ...b,
          parts: (Array.isArray(b.parts) ? b.parts : []).map((part) => (
            part.kind === 'tool' && (!toolName || part.name === toolName)
              ? { ...part, status }
              : part
          )),
        }
        : b)));
    };

    const handleApprovalRequest = (bot, payload, source, serverRequestId = null) => {
      if (!bot || !payload) return;
      const requestId = String(payload.request_id || payload.prompt_id || serverRequestId || '');
      if (!requestId) return;
      const promptId = String(payload.prompt_id || '');
      const allowed = new Set(['once', 'session', 'always', 'deny']);
      let choices = Array.isArray(payload.choices)
        ? payload.choices.filter((choice) => allowed.has(String(choice)))
        : [];
      if (!choices.length) {
        choices = ['once'];
        if (!payload.smart_denied && payload.allow_session !== false) choices.push('session');
        if (!payload.smart_denied && payload.allow_permanent !== false) choices.push('always');
        choices.push('deny');
      }
      const toolName = payload.tool_name || '';
      const entry = {
        bot,
        request_id: requestId,
        prompt_id: promptId,
        server_request_id: source === 'server' ? serverRequestId : null,
        source,
        session_id: bot.sessionId,
        execution_generation: Number.isFinite(payload.execution_generation) ? payload.execution_generation : null,
        command: String(payload.command || ''),
        description: String(payload.description || 'dangerous command'),
        tool_name: toolName,
        choices,
        created_at: Date.now(),
      };
      setApprovals((prev) => {
        const rest = prev.filter((a) => a.request_id !== requestId);
        return [...rest, entry];
      });
      updateToolStatus(bot, toolName, 'waiting_approval');
      try {
        bot.rpc('approval.received', {
          session_id: bot.sessionId,
          request_id: requestId,
        }).catch(() => {});
      } catch {}
      setNotice(`${bot.name}: approval required`);
    };

    const removeApproval = (requestId) => {
      if (!requestId) return;
      setApprovals((prev) => prev.filter((a) => a.request_id !== String(requestId)));
    };

    const handle = (bot, p) => {
      if (dead || !bot) return;
      const t = p.type;
      const sid = p.payload?.session_id ?? p.session_id;
      if (sid && bot.sessionId && sid !== bot.sessionId) return;

      if (t === 'message.start') {
        // Only a profile with an expected turn may speak. Different profiles
        // may stream concurrently; notifications, stale turns and replays are
        // session machinery.
        if (isAutomationTurn(p.payload)) return;
        if (pendingOf(bot.name) <= 0) return;
        if (activeRef.current.has(bot.name)) return;
        const turnId = String((p.payload && p.payload.turn_id) || '');
        if (turnId && streamTurnRef.current.get(bot.name) === turnId) return;
        const id = newId('b');
        const auto = autoTurnRef.current.has(bot.name);
        bot.discId = roundRef.current.active ? roundRef.current.id : null;
        activeRef.current.set(bot.name, id);
        if (turnId) streamTurnRef.current.set(bot.name, turnId);
        segmentRef.current.delete(bot.name);
        setLog((prev) => [...prev, {
          id, speaker: bot.name, color: bot.color, borderColor: bot.borderColor, text: '', done: false, at: Date.now(), role: 'bot', icon: bot.icon, auto,
          parts: [{ kind: 'text', text: '' }],
          asksPeer: Boolean(turnMetaRef.current.get(bot.name)?.asksPeer),
        }]);
        setLiveMetrics((prev) => ({
          ...prev,
          [bot.name]: { startedAt: Date.now(), chars: 0, tps: 0 },
        }));
        setStatuses((s) => ({ ...s, [bot.name]: 'streaming…' }));
        setThinking((prev) => {
          if (!prev[bot.name]) return prev;
          const next = { ...prev };
          delete next[bot.name];
          return next;
        });
        setTools((prev) => {
          if (!prev[bot.name]) return prev;
          const next = { ...prev };
          delete next[bot.name];
          return next;
        });
        return;
      }
      if (t === 'thinking.delta') {
        if (pendingOf(bot.name) <= 0) return;
        setThinking((prev) => ({ ...prev, [bot.name]: true }));
        return;
      }
      if (t === 'message.delta') {
        const raw = p.payload?.text ?? '';
        if (!raw) return;
        const turnId = String(p.payload?.turn_id || '');
        const expectedTurn = streamTurnRef.current.get(bot.name);
        if (turnId && expectedTurn && turnId !== expectedTurn) return;
        const admitted = admitDelta(segmentRef.current.get(bot.name), p.payload, String(raw));
        segmentRef.current.set(bot.name, admitted.cursor);
        const d = admitted.text;
        if (!d) return;
        const id = activeRef.current.get(bot.name);
        if (!id) return;
        setLog((prev) => prev.map((b) => (b.id === id
          ? {
            ...b,
            text: b.text + (b.text ? d : String(d).replace(/^\s+/, '')),
            parts: appendTextPart(b.parts, d),
            asksPeer: b.asksPeer || addressedPeers(String(d), b.speaker).length > 0,
          }
          : b)));
        setLiveMetrics((prev) => {
          const cur = prev[bot.name] || { startedAt: Date.now(), chars: 0 };
          const chars = cur.chars + String(d).length;
          const seconds = Math.max(0.1, (Date.now() - cur.startedAt) / 1000);
          return { ...prev, [bot.name]: { ...cur, chars, tps: chars / 4 / seconds } };
        });
        return;
      }
      if (t === 'message.complete') {
        const completeTurnId = String(p.payload?.turn_id || '');
        const expectedTurn = streamTurnRef.current.get(bot.name);
        if (completeTurnId && expectedTurn && completeTurnId !== expectedTurn) return;
        const pcount = pendingOf(bot.name);
        if (pcount <= 0) return;
        pendingRef.current.set(bot.name, pcount - 1);
        syncPending();
        const remaining = pcount - 1;
        if (remaining === 0) setNotice((n) => (String(n).startsWith('queued for ') ? '' : n));
        const id = activeRef.current.get(bot.name);
        if (!id) {
          setStatuses((s) => ({ ...s, [bot.name]: remaining > 0 ? 'queued…' : 'ready' }));
          if (remaining === 0) drainQueue(bot);
          return;
        }

        const cur = bubblesRef.current.find((b) => b.id === id);
        const text = ((cur && cur.text) || (p.payload && p.payload.text) || '').trim();
        const pass = /^\(pass\)$/i.test(text);

        setLog((prev) => {
          const cur = prev.find((b) => b.id === id);
          const text = ((cur && cur.text) || (p.payload && p.payload.text) || '').trim();
          const pass = /^\(pass\)$/i.test(text);
          const diff = cur && hasDiffPart(cur);
          const tool = cur && hasToolPart(cur);
          if (!cur) return prev;
          if (!diff && !tool && (!text || pass)) {
            const ack = acknowledgementFor(bot);
            return prev.map((b) => (b.id === id
              ? { ...b, text: ack, done: true, parts: [{ kind: 'text', text: ack }] }
              : b));
          }
          const rawParts = Array.isArray(cur.parts)
            ? cur.parts.map((part) => (part.kind === 'text'
              ? { ...part, text: pass ? '' : part.text.trim() }
              : part))
            : [];
          const parts = [];
          for (const part of rawParts) {
            if (part.kind === 'text') {
              const split = splitDiffFences(part.text);
              if (split) parts.push(...split);
              else parts.push(part);
            } else {
              parts.push(part);
            }
          }
          return prev.map((b) => (b.id === id ? { ...b, text: pass ? '' : text, done: true, parts } : b));
        });
        activeRef.current.delete(bot.name);
        streamTurnRef.current.delete(bot.name);
        segmentRef.current.delete(bot.name);
        setLiveMetrics((prev) => {
          const cur = prev[bot.name] || { startedAt: Date.now(), chars: 0 };
          const seconds = Math.max(0.1, (Date.now() - cur.startedAt) / 1000);
          return { ...prev, [bot.name]: { ...cur, seconds, tps: cur.chars / 4 / seconds } };
        });
        setStatuses((s) => ({ ...s, [bot.name]: remaining > 0 ? 'queued…' : 'ready' }));
        if (viewRef && viewRef.current !== bot.name) {
          setUnread((prev) => ({ ...prev, [bot.name]: (prev[bot.name] || 0) + 1 }));
        }
        setTools((prev) => {
          if (!prev[bot.name]) return prev;
          const next = { ...prev };
          delete next[bot.name];
          return next;
        });
        setThinking((prev) => {
          if (!prev[bot.name]) return prev;
          const next = { ...prev };
          delete next[bot.name];
          return next;
        });
        try {
          bot.rpc('session.info', { session_id: bot.sessionId })
            .then((info) => setRuntimeFor(bot, info))
            .catch(() => {});
        } catch {}
        autoTurnRef.current.delete(bot.name);
        const d = roundRef.current;
        if (d.active && d.current.has(bot.name) && bot.discId === d.id) {
          d.current.delete(bot.name);
          d.remaining = Math.max(0, d.remaining - 1);
          if (text && !pass) {
            const citeAt = d.messages + 1;
            d.messages = citeAt;
            for (const peer of addressedPeers(text, bot.name)) addNextPeer(peer, citeAt);
            d.lastPost.set(bot.name, citeAt);
          }
          if (d.remaining === 0) advanceDiscussion();
        }
        if (remaining === 0) drainQueue(bot);
        return;
      }
      if (t === 'tool.generating' || t === 'tool.start' || t === 'tool.complete') {
        if (pendingOf(bot.name) <= 0) return;
        const payload = p.payload || {};
        if (t === 'tool.generating') {
          setTools((prev) => {
            const cur = prev[bot.name] || { active: {}, draftName: '' };
            return {
              ...prev,
              [bot.name]: { ...cur, draftName: payload.name || 'tool' },
            };
          });
        } else if (t === 'tool.start') {
          const toolId = String(payload.tool_id || payload.id || payload.name || `tool:${Date.now()}`);
          setTools((prev) => {
            const cur = prev[bot.name] || { active: {}, draftName: '' };
            const active = {
              ...cur.active,
              [toolId]: {
                id: toolId,
                name: payload.name || 'tool',
                context: payload.context || payload.args_text || '',
                labels: Array.isArray(payload.labels) ? payload.labels : null,
                startedAt: (cur.active[toolId] && cur.active[toolId].startedAt) || Date.now(),
                drafting: false,
              },
            };
            return { ...prev, [bot.name]: { active, draftName: '' } };
          });
          const bubbleId = activeRef.current.get(bot.name);
          if (bubbleId) {
            setLog((prev) => prev.map((b) => (b.id === bubbleId
              ? upsertToolPart(b, {
                tool_id: toolId,
                name: payload.name || 'tool',
                context: payload.context || payload.args_text || '',
                labels: Array.isArray(payload.labels) ? payload.labels : null,
                started_at: Date.now(),
                status: 'active',
              })
              : b)));
          }
        } else {
          const inlineDiff = payload.inline_diff ? cleanInlineDiff(payload.inline_diff) : '';
          const toolId = String(payload.tool_id || payload.id || '');
          const duration = Number(payload.duration_s);
          const bubbleId = activeRef.current.get(bot.name);
          if (bubbleId) {
            setLog((prev) => prev.map((b) => (b.id === bubbleId
              ? upsertToolPart(b, {
                tool_id: toolId,
                name: payload.name || 'tool',
                context: payload.context || payload.args_text || '',
                labels: Array.isArray(payload.labels) ? payload.labels : null,
                duration_s: Number.isFinite(duration) ? duration : undefined,
                summary: payload.summary || '',
                result_text: payload.result_text || '',
                status: 'done',
                diff: inlineDiff || undefined,
              })
              : b)));
          }
          setTools((prev) => {
            const cur = prev[bot.name];
            if (!cur) return prev;
            const active = { ...cur.active };
            const id = payload.tool_id || payload.id;
            if (id) {
              delete active[String(id)];
            } else {
              for (const [key, tool] of Object.entries(active)) {
                if (!payload.name || tool.name === payload.name) delete active[key];
              }
            }
            const draftName = cur.draftName && cur.draftName !== payload.name ? cur.draftName : '';
            const next = { ...prev };
            if (!Object.keys(active).length && !draftName) delete next[bot.name];
            else next[bot.name] = { active, draftName };
            return next;
          });
        }
        setStatuses((s) => ({ ...s, [bot.name]: s[bot.name] && s[bot.name] !== 'ready' ? s[bot.name] : 'streaming…' }));
        return;
      }
      if (t === 'session.info') {
        setRuntimeFor(bot, p.payload || {});
        return;
      }
      if (t === 'approval.request') {
        handleApprovalRequest(bot, p.payload || {}, 'event');
        return;
      }
      if (t === 'approval.settled') {
        const payload = p.payload || {};
        const id = payload.request_id || payload.prompt_id || payload.id || '';
        if (id) removeApproval(id);
        return;
      }
      if (t === 'approval.cancelled' || t === 'request.cancel') {
        const payload = p.payload || {};
        const id = payload.request_id || payload.prompt_id || payload.id || '';
        if (id) removeApproval(id);
        setLog((prev) => prev.map((b) => ({
          ...b,
          parts: (Array.isArray(b.parts) ? b.parts : []).map((part) => (
            part.kind === 'tool' && part.status === 'waiting_approval'
              ? { ...part, status: 'timed_out' }
              : part
          )),
        })));
        setNotice(`approval ${payload.reason || 'cancelled'}`);
        return;
      }
      if (t === 'error') {
        const activeBubbleId = activeRef.current.get(bot.name);
        if (activeBubbleId) setLog((prev) => prev.filter((b) => b.id !== activeBubbleId));
        activeRef.current.delete(bot.name);
        streamTurnRef.current.delete(bot.name);
        segmentRef.current.delete(bot.name);
        autoTurnRef.current.delete(bot.name);
        turnMetaRef.current.delete(bot.name);
        setTools((prev) => {
          if (!prev[bot.name]) return prev;
          const next = { ...prev };
          delete next[bot.name];
          return next;
        });
        setThinking((prev) => {
          if (!prev[bot.name]) return prev;
          const next = { ...prev };
          delete next[bot.name];
          return next;
        });
        setStatuses((s) => ({ ...s, [bot.name]: 'error' }));
        setNotice(p.payload?.message || `${bot.name}: error`);
        pendingRef.current.set(bot.name, 0);
        syncPending();
        queueRef.current.delete(bot.name);
        syncQueues();
        const d = roundRef.current;
        if (d.active && d.current.has(bot.name)) {
          d.current.delete(bot.name);
          d.remaining = Math.max(0, d.remaining - 1);
          if (d.remaining === 0) advanceDiscussion();
        }
      }
    };

    const makeHandler = (holder) => (p) => handle(holder.bot, p);

    const handleRequest = (bot, msg) => {
      if (dead || !bot || msg.method !== 'approval') return;
      const p = msg.params || {};
      if (p.session_id && bot.sessionId && p.session_id !== bot.sessionId) return;
      handleApprovalRequest(bot, p, 'server', msg.id);
    };

    const makeRequest = (holder) => (msg) => handleRequest(holder.bot, msg);

    const handleDisconnect = (bot, err) => {
      if (dead || !bot) return;
      bot.offline = true;
      const activeId = activeRef.current.get(bot.name);
      if (activeId) setLog((prev) => prev.filter((b) => b.id !== activeId));
      activeRef.current.delete(bot.name);
      streamTurnRef.current.delete(bot.name);
      segmentRef.current.delete(bot.name);
      autoTurnRef.current.delete(bot.name);
      turnMetaRef.current.delete(bot.name);
      setTools((prev) => {
        if (!prev[bot.name]) return prev;
        const next = { ...prev };
        delete next[bot.name];
        return next;
      });
      setThinking((prev) => {
        if (!prev[bot.name]) return prev;
        const next = { ...prev };
        delete next[bot.name];
        return next;
      });
      setLiveMetrics((prev) => {
        const next = { ...prev };
        delete next[bot.name];
        return next;
      });
      pendingRef.current.set(bot.name, 0);
      syncPending();
      queueRef.current.delete(bot.name);
      syncQueues();
      setRoster((prev) => prev.map((r) =>
        r.profile === bot.profile ? { ...r, connected: false } : r));
      setStatuses((s) => ({ ...s, [bot.name]: 'offline' }));
      setNotice(`${bot.name}: ${err.message}`);
      setApprovals((prev) => prev.filter((a) => a.bot !== bot));

      const d = roundRef.current;
      if (d.active && d.current.has(bot.name)) {
        d.current.delete(bot.name);
        d.remaining = Math.max(0, d.remaining - 1);
        if (d.remaining === 0) advanceDiscussion();
      }
    };

    const makeClose = (holder) => (err) => handleDisconnect(holder.bot, err);

    (async () => {
      try {
        // Default connection first: it gives us the roster and doubles as the primary bot.
        const holder = { bot: null };
        const raw = await connectRaw(DEFAULT_HOME, makeHandler(holder), makeRequest(holder), makeClose(holder));
        const defaultTheme = buildTheme(raw.skin);
        const defaultBot = { ...raw, name: '', color: defaultTheme.label, borderColor: defaultTheme.bubbleBorder || defaultTheme.border, profile: '', sessionId: null, preambled: false, primary: true, seenSeq: 0, icon: skinIcon(raw.skin) };
        holder.bot = defaultBot;

        const profs = await raw.rpc('profiles.list', { include_sessions: false });
        const rows = profs.profiles || [];
        let selected = PROFILE_FILTER
          ? rows.filter((p) => PROFILE_FILTER.has(p.name))
          : rows;
        // The default profile is always in the room: it is the unfiltered
        // room view, even if the allow-list omits it.
        const defaultRow = rows.find((p) => p.is_default);
        if (defaultRow && !selected.some((p) => p.is_default)) {
          selected = [defaultRow, ...selected];
        }
        if (!selected.length) selected = rows.filter((p) => p.is_default);
        selected.sort((a, b) => {
          if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
          if (PROFILE_RANK) {
            const ra = PROFILE_RANK.get(a.name);
            const rb = PROFILE_RANK.get(b.name);
            return (ra === undefined ? 1e9 : ra) - (rb === undefined ? 1e9 : rb);
          }
          return 0;
        });

        const defaultAgent = skinAgentName(raw.skin);
        const palette = buildTheme(raw.skin);
        setTheme(palette);

        // One-shot roster: every option is available at once, before any
        // per-profile session is created.
        const rosterEntries = selected.map((p) => ({
          profile: p.name,
          name: displayName(p, raw.skin, defaultAgent),
          isDefault: !!p.is_default,
          icon: profileIcon(p, null),
          connected: false,
        }));
        setRoster(rosterEntries);
        // The roster is known before any connection, so every tab starts gray/connecting.
        setStatuses((s) => {
          const next = { ...s };
          for (const r of rosterEntries) next[r.name] = 'connecting';
          return next;
        });

        const markConnected = (bot) => setRoster((prev) => prev.map((r) =>
          r.profile === bot.profile ? { ...r, icon: bot.icon || r.icon, connected: true } : r));

        const startSession = async (bot) => {
          const snap = await bot.rpc('session.create', {
            source: 'tui',
            title: `Hermes Stage Room ${newId('room')}`,
          });
          bot.sessionId = snap.session_id;
          setStatuses((s) => ({ ...s, [bot.name]: 'ready' }));
          // Do not block the room on approval replay or capabilities; those
          // are background hydration steps. Awaiting them here delayed the
          // profile's connected state when the gateway was slow.
          (async () => {
            try { await bot.rpc('client.capabilities', { server_requests: true }); } catch {}
            try {
              const pendingApprovals = await bot.rpc('approval.pending', { session_id: bot.sessionId });
              for (const approval of pendingApprovals.approvals || []) {
                handleApprovalRequest(bot, approval, 'pending');
              }
            } catch {}
            try {
              const info = await bot.rpc('session.info', { session_id: bot.sessionId });
              if (!dead) setRuntimeFor(bot, info);
            } catch {}
          })();
          return bot;
        };

        const bots = [];
        if (selected.some((p) => p.is_default)) {
          defaultBot.name = displayName(selected.find((p) => p.is_default), raw.skin, defaultAgent);
          defaultBot.color = palette.label;
          defaultBot.skin = raw.skin;
          defaultBot.profile = selected.find((p) => p.is_default).name;
          defaultBot.icon = profileIcon(selected.find((p) => p.is_default), raw.skin);
          defaultBot.primary = true;
          holder.bot = defaultBot;
          bots.push(await startSession(defaultBot));
        }

        // The default profile is ready: paint the room now; the rest of the crew connects behind it.
        markConnected(defaultBot);
        const baseBots = bots.slice();
        clientsRef.current = baseBots.slice();
        setBotList(baseBots.slice());
        const primaryBot = baseBots.find((c) => c.primary) || baseBots[0];
        if (primaryBot) setFocusName((f) => f || primaryBot.name);
        if (!dead) setOnline(true);

        // Connect the remaining profiles with bounded concurrency; each one appears
        // as it arrives, but the gateway is not hit with all 15 at once.
        const otherRows = selected.filter((p) => !p.is_default);
        const slots = new Array(otherRows.length).fill(null);
        const rebuildBots = () => {
          if (dead) return;
          const ordered = baseBots.concat(slots.filter(Boolean));
          clientsRef.current = ordered.slice();
          setBotList(ordered.slice());
        };

        let activeConnections = 0;
        const waitingSlots = [];
        const acquireSlot = () => new Promise((resolve) => {
          if (activeConnections < MAX_PARALLEL_PROFILES) {
            activeConnections += 1;
            resolve();
          } else {
            waitingSlots.push(resolve);
          }
        });
        const releaseSlot = () => {
          activeConnections = Math.max(0, activeConnections - 1);
          const next = waitingSlots.shift();
          if (next) {
            activeConnections += 1;
            next();
          }
        };

        const settled = await Promise.allSettled(otherRows.map(async (p, index) => {
          await acquireSlot();
          try {
            const h2 = { bot: null };
            const home = p.path || `${DEFAULT_HOME}/profiles/${p.name}`;
            const raw2 = await connectRaw(home, makeHandler(h2), makeRequest(h2), makeClose(h2));
            const botTheme = buildTheme(raw2.skin);
            const name = displayName(p, raw2.skin, defaultAgent);
            const bot = {
              ...raw2,
              name,
              profile: p.name,
              color: botTheme.label,
              borderColor: botTheme.bubbleBorder || botTheme.border,
              sessionId: null,
              preambled: false,
              primary: false,
              seenSeq: 0,
              icon: profileIcon(p, raw2.skin),
            };
            h2.bot = bot;
            await startSession(bot);
            slots[index] = bot;
            markConnected(bot);
            rebuildBots();
            return bot;
          } finally {
            releaseSlot();
          }
        }));

        for (let i = 0; i < settled.length; i++) {
          const result = settled[i];
          if (result.status === 'rejected' && !dead) {
            const entry = rosterEntries.find((r) => r.profile === otherRows[i].name);
            if (entry) setStatuses((s) => ({ ...s, [entry.name]: 'not-ready' }));
            setNotice(`skipped ${otherRows[i].name}: ${result.reason && result.reason.message ? result.reason.message : result.reason}`);
          }
        }
        rebuildBots();
        const readyPrimary = bots.find((c) => c.primary) || bots[0];
        if (readyPrimary) setFocusName((f) => f || readyPrimary.name);
        if (!dead) setOnline(true);
      } catch (e) {
        if (!dead) setNotice(`room init failed: ${e.message}`);
      }
    })();

    return () => {
      dead = true;
      for (const b of clientsRef.current) { try { b.ws.close(); } catch {} }
    };
  }, []);

  const respond = React.useCallback(async (choice) => {
    const first = approvals[0];
    if (!first) return;
    try {
      const answer = approvalAnswer(first, choice);
      if (answer.path === 'server') {
        const ws = first.bot.ws;
        if (!ws || ws.readyState !== 1) throw new Error('gateway socket not open');
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: answer.id,
          result: answer.result,
        }));
      } else {
        await first.bot.rpc(answer.method, answer.params);
      }
      setApprovals((prev) => prev.filter((a) => a.request_id !== first.request_id));
      setNotice(`approval: ${choice}`);
    } catch (e) {
      setNotice(`approval: ${e.message}`);
    }
  }, [approvals]);

  const resolveMember = React.useCallback((name) => {
    const q = String(name || '').trim().replace(/^@/, '').toLowerCase();
    const hit = clientsRef.current.filter((c) =>
      c.name.toLowerCase() === q ||
      c.name.toLowerCase().split(' · ')[0].toLowerCase() === q ||
      String(c.profile || '').toLowerCase() === q);
    return hit.length === 1 ? hit[0] : null;
  }, []);

  const cycleFocus = React.useCallback((dir = 1) => {
    const list = clientsRef.current;
    if (!list.length) return;
    let idx = list.findIndex((c) => c.name === focusName);
    if (idx < 0) idx = list.findIndex((c) => c.primary);
    if (idx < 0) idx = 0;
    const next = list[(idx + dir + list.length) % list.length];
    setFocusName(next.name);
  }, [focusName]);

  const setFocus = React.useCallback((name) => {
    setFocusName(name);
  }, []);

  const submit = React.useCallback(async (raw, defaultTarget) => {
    const text = raw.trim();
    if (!text || !clientsRef.current.length) return false;
    const focusCmd = text.match(/^[@/]focus(?:\s+(.+))?$/i);
    if (focusCmd) {
      const arg = (focusCmd[1] || '').trim().toLowerCase();
      if (!arg || arg === 'next' || arg === 'prev') {
        cycleFocus(arg === 'prev' ? -1 : 1);
        return false;
      }
      const hit = resolveMember(arg);
      if (!hit) { setNotice(`Unknown room member: ${arg}`); return false; }
      setFocusName(hit.name);
      return false;
    }
    const everyone = /(^|\s)@(everyone|all)\b/i.test(text);
    let body = text.replace(/\\@/g, '\u0001AT\u0001');
    const resolved = [];
    let bad = null;

    if (!everyone) {
      body = body.replace(/(^|\s)@([A-Za-z0-9_-]+)(?=\s|$)/g, (_full, pre, name) => {
        const q = name.toLowerCase();
        const hit = clientsRef.current.filter((c) =>
          c.name.toLowerCase() === q ||
          c.name.toLowerCase().split(' · ')[0].toLowerCase() === q ||
          String(c.profile || '').toLowerCase() === q);
        if (hit.length !== 1) {
          bad = hit.length ? `Ambiguous room member: @${q}` : `Unknown room member: @${q}`;
          return `${pre}@${name}`;
        }
        resolved.push(hit[0]);
        return `${pre}${hit[0].name}`;
      });
    } else {
      body = body.replace(/@(everyone|all)\b/gi, '').trim();
    }
    body = body.replace(/\u0001AT\u0001/g, '@').trim();

    if (bad) { setNotice(bad); return false; }

    if (defaultTarget && !clientsRef.current.some((c) => c.name === defaultTarget)) {
      setNotice(`${defaultTarget} is still connecting; wait for its tab to light up.`);
      return false;
    }

    let targets;
    if (everyone) {
      targets = clientsRef.current.slice();
      if (!body) body = 'Hello.';
    } else if (resolved.length) {
      // Only the first @name is the addressee. Later @names stay as names in the
      // content so a chain like "ask @member-a to ask @member-b to ask @member-c" works.
      targets = [resolved[0]];
      if (!body) body = 'Hello.';
      // @mention is a one-time route. It does not change the focused profile.
    } else if (defaultTarget) {
      const lensBot = clientsRef.current.find((c) => c.name === defaultTarget);
      targets = [lensBot];
    } else {
      // Desktop room semantics: a bare room message addresses everyone.
      targets = clientsRef.current.slice();
      if (!body) body = 'Hello.';
    }

    targets = targets.filter((bot) => bot && !bot.offline);
    if (!targets.length) {
      setNotice('No connected room member available.');
      return false;
    }

    const busyTargets = targets.filter((b) => pendingOf(b.name) > 0);
    const freeTargets = targets.filter((b) => pendingOf(b.name) <= 0);

    const targetNames = new Set(targets.map((b) => b.name));
    const peerNames = clientsRef.current
      .filter((peer) => !targetNames.has(peer.name) && !peer.offline)
      .map((peer) => peer.name.split(' · ')[0]);
    const userAsksPeer = peerNames.some((name) => {
      if (!name) return false;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(body);
    });
    for (const bot of targets) turnMetaRef.current.set(bot.name, { asksPeer: userAsksPeer });

    startDiscussion(targets);

    setLog((prev) => [...prev, {
      id: newId('u'), speaker: 'You', color: 'gray', text, done: true, at: Date.now(), role: 'user',
      targets: targets.map((b) => b.name),
      queued: busyTargets.length > 0,
    }]);

    for (const bot of busyTargets) {
      const q = queueRef.current.get(bot.name) || [];
      q.push({ text });
      queueRef.current.set(bot.name, q);
    }
    syncQueues();
    setStatuses((s) => {
      const next = { ...s };
      for (const b of freeTargets) next[b.name] = 'waiting…';
      for (const b of busyTargets) next[b.name] = 'queued…';
      return next;
    });
    setNotice(busyTargets.length
      ? `queued for ${busyTargets.map((b) => b.name.split(' · ')[0]).join(', ')}`
      : '');
    for (const bot of freeTargets) {
      pendingRef.current.set(bot.name, (pendingRef.current.get(bot.name) || 0) + 1);
      promptMember(bot);
    }
    syncPending();
    return true;
  }, [focusName, cycleFocus, resolveMember]);

  return { bubbles, statuses, notice, setNotice, tick, online, submit, approvals, respond, runtimes, liveMetrics, focusName, cycleFocus, setFocus, roster, theme, bots: botList, tools, thinking, unread, clearUnread, queues, pending };
}

function Stage() {
  const app = useApp();
  const { columns, rows } = useWindowSize();
  const [view, setView] = React.useState('stage');
  const viewRef = React.useRef('stage');
  const lastLensRef = React.useRef('');
  viewRef.current = view;
  const room = useRoom(viewRef);
  const [approvalSel, setApprovalSel] = React.useState(0);
  const approvalKey = room.approvals.map((approval) => approval.request_id).join('|');
  React.useEffect(() => { setApprovalSel(0); }, [approvalKey]);
  const [composer, setComposer] = React.useState('');
  const [composerCursor, setComposerCursor] = React.useState(0);

  const setComposerText = (next, caret) => {
    const text = typeof next === 'function' ? next(composer) : next;
    setComposer(text);
    setComposerCursor(caret == null ? text.length : Math.max(0, Math.min(caret, text.length)));
  };

  const insertText = (text) => {
    if (!text) return;
    const next = composer.slice(0, composerCursor) + text + composer.slice(composerCursor);
    setComposer(next);
    setComposerCursor(composerCursor + text.length);
  };

  const deleteBackward = () => {
    if (composerCursor <= 0) return;
    const next = composer.slice(0, composerCursor - 1) + composer.slice(composerCursor);
    setComposer(next);
    setComposerCursor(composerCursor - 1);
  };

  const deleteForward = () => {
    if (composerCursor >= composer.length) return;
    const next = composer.slice(0, composerCursor) + composer.slice(composerCursor + 1);
    setComposer(next);
  };
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerMode, setPickerMode] = React.useState(null);
  const [pickerIndex, setPickerIndex] = React.useState(0);
  const [lastProfile, setLastProfile] = React.useState(null);
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashIndex, setSlashIndex] = React.useState(0);
  const [scrollUp, setScrollUp] = React.useState(0);
  const contentRef = React.useRef(null);
  const viewportRef = React.useRef(null);
  const scrollMaxRef = React.useRef(0);
  const contentMetrics = useBoxMetrics(contentRef);
  const viewportMetrics = useBoxMetrics(viewportRef);
  const scrollBy = React.useCallback((delta) => {
    setScrollUp((s) => Math.max(0, Math.min(scrollMaxRef.current, s + delta)));
  }, []);

  React.useEffect(() => {
    const onData = (chunk) => {
      const text = String(chunk);
      for (const match of text.matchAll(/\u001b\[<(\d+);\d+;\d+[Mm]/g)) {
        const button = Number(match[1]);
        if (button === 64) scrollBy(1);
        else if (button === 65) scrollBy(-1);
      }
    };
    process.stdin.on('data', onData);
    return () => process.stdin.off('data', onData);
  }, [scrollBy]);

  const pickerOptions = room.roster;
  const pickerRows = [...pickerOptions, { name: 'Back', profile: '__back__', isBack: true }];
  const pickerVisible = 12;
  const pickerNameMax = Math.max(4, ...pickerRows.map((option) => option.name.length));
  const pickerHasScrollbar = true;
  const pickerMenuWidth = Math.min(columns - 2, Math.max(24, pickerNameMax + 6 + 1));
  const pickerOffset = Math.max(0, Math.min(
    pickerIndex - Math.floor(pickerVisible / 2),
    Math.max(0, pickerRows.length - pickerVisible)
  ));
  const pickerItems = pickerRows.slice(pickerOffset, pickerOffset + pickerVisible);

  const slashQuery = composer.startsWith('@') ? (composer.split(/\s+/)[0] || '@') : '';
  const slashItems = slashOpen
    ? [...AT_COMMANDS.filter((item) => item.display.startsWith(slashQuery)), AT_BACK]
    : [];
  const slashVisible = 12;
  const slashOffset = Math.max(0, Math.min(
    slashIndex - Math.floor(slashVisible / 2),
    Math.max(0, slashItems.length - slashVisible)
  ));
  const slashWindow = slashItems.slice(slashOffset, slashOffset + slashVisible);
  const slashNameWidth = Math.max(8, ...slashWindow.map((item) => item.display.length)) + 2;
  const slashMetaMax = Math.max(8, ...slashWindow.map((item) => item.meta.length));
  const slashHasScrollbar = true;
  const slashMenuWidth = Math.min(
    columns - 2,
    Math.max(24, slashNameWidth + slashMetaMax + 2 + 1)
  );

  const defaultPickerIndex = React.useCallback(() => {
    const wanted = lastProfile || room.focusName;
    let idx = pickerOptions.findIndex((o) => o.profile === wanted || o.name === wanted);
    if (idx < 0) idx = pickerOptions.findIndex((o) => o.isDefault);
    return Math.max(0, idx);
  }, [lastProfile, room.focusName, pickerOptions]);

  const openPicker = React.useCallback((mode = 'mention') => {
    if (!pickerOptions.length) return false;
    setPickerMode(mode);
    setPickerIndex(defaultPickerIndex());
    setPickerOpen(true);
    setSlashOpen(false);
    setComposerText('', 0);
    return true;
  }, [pickerOptions.length, defaultPickerIndex]);

  const submit = React.useCallback(async () => {
    const text = composer;
    if (!text.trim()) return;
    setSlashOpen(false);
    setComposerText('', 0);
    setScrollUp(0);
    const mentionCmd = text.trim().match(/^@mention(?:\s+(.+))?$/i);
    if (mentionCmd) {
      const arg = (mentionCmd[1] || '').trim();
      if (!arg) {
        openPicker('mention');
        return;
      }
      const hit = room.roster.find((o) =>
        o.name.toLowerCase() === arg.toLowerCase() ||
        o.name.toLowerCase().split(' · ')[0].toLowerCase() === arg.toLowerCase() ||
        String(o.profile || '').toLowerCase() === arg.toLowerCase());
      if (!hit) {
        room.setNotice(`Unknown room member: ${arg}`);
        return;
      }
      setLastProfile(hit.profile);
      setComposerText(`@${hit.name.split(' · ')[0]} `);
      return;
    }
    const focusCmd = text.trim().match(/^@focus(?:\s+(.+))?$/i);
    if (focusCmd) {
      const arg = (focusCmd[1] || '').trim();
      if (!arg) {
        openPicker('focus');
        return;
      }
      if (arg === 'next' || arg === 'prev') {
        room.cycleFocus(arg === 'prev' ? -1 : 1);
        setComposerText('', 0);
        return;
      }
      const hit = room.roster.find((o) =>
        o.name.toLowerCase() === arg.toLowerCase() ||
        o.name.toLowerCase().split(' · ')[0].toLowerCase() === arg.toLowerCase() ||
        String(o.profile || '').toLowerCase() === arg.toLowerCase());
      if (!hit) {
        room.setNotice(`Unknown room member: ${arg}`);
        return;
      }
      room.setFocus(hit.name);
      setLastProfile(hit.profile);
      setComposerText('', 0);
      return;
    }
    await room.submit(text, view === 'stage' ? null : view);
  }, [composer, room, openPicker, view]);

  const commitPicker = React.useCallback((option) => {
    if (!option) return;
    if (option.isBack) {
      setPickerOpen(false);
      setPickerMode(null);
      setComposerText('@', 1);
      setSlashOpen(true);
      setSlashIndex(0);
      return;
    }
    setLastProfile(option.profile);
    if (pickerMode === 'mention') {
      const handle = option.name.split(' · ')[0];
      setComposerText(`@${handle} `);
    } else {
      room.setFocus(option.name);
      setComposerText('', 0);
    }
    setPickerOpen(false);
    setPickerMode(null);
    setSlashOpen(false);
  }, [pickerMode, room]);

  const switchView = React.useCallback((next) => {
    const defaultBot = room.bots.find((b) => b.primary);
    const target = next;
    if (target === 'stage') {
      if (viewRef.current !== 'stage') lastLensRef.current = viewRef.current;
      if (defaultBot) room.setFocus(defaultBot.name);
    } else {
      lastLensRef.current = target;
      room.clearUnread(target);
      room.setFocus(target);
    }
    if (target === view) return;
    // Fixed-frame layout: switching a lens is an ordinary re-render, not a
    // terminal clear — no screen jump.
    setScrollUp(0);
    setView(target);
  }, [view, room.bots, room.clearUnread, room.setFocus]);

  React.useEffect(() => {
    if (view === 'stage') return;
    if (!room.focusName || room.focusName === view) return;
    if (!room.bots.some((b) => b.name === room.focusName)) return;
    switchView(room.focusName);
  }, [view, room.focusName, room.bots, switchView]);

  const cycleView = React.useCallback((dir = 1) => {
    const list = [...room.roster.map((r) => r.name), 'stage'];
    if (!list.length) return;
    const idx = list.indexOf(view);
    const next = list[(idx + dir + list.length) % list.length];
    switchView(next);
  }, [view, room.roster, switchView]);

  const moveView = React.useCallback((dir) => {
    const profiles = room.roster.map((r) => r.name);
    if (!profiles.length) return false;

    if (view === 'stage') {
      if (dir === 'up' || dir === 'down' || dir === 'left') {
        const target = lastLensRef.current || profiles[profiles.length - 1] || profiles[0];
        if (!target) return false;
        switchView(target);
        return true;
      }
      if (dir === 'right') {
        switchView(profiles[0]);
        return true;
      }
      return false;
    }

    const idx = profiles.indexOf(view);
    if (idx < 0) return false;

    if (dir === 'up' || dir === 'down') {
      switchView('stage');
      return true;
    }
    if (dir === 'left') {
      const target = profiles[idx - 1];
      if (!target) return false;
      switchView(target);
      return true;
    }
    if (dir === 'right') {
      const target = profiles[idx + 1] || 'stage';
      switchView(target);
      return true;
    }
    return false;
  }, [view, room.roster, switchView]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { app.exit(); return; }

    if (room.approvals.length) {
      const approval = room.approvals[0];
      const choices = approval.choices && approval.choices.length
        ? approval.choices
        : ['once', 'deny'];
      const action = approvalAction(input, key, approvalSel, choices);
      if (action.kind === 'choose') {
        room.respond(action.choice);
        return;
      }
      if (action.kind === 'move') {
        setApprovalSel((i) => Math.max(0, Math.min(choices.length - 1, i + action.delta)));
        return;
      }
      return;
    }

    if (pickerOpen) {
      if (key.upArrow) {
        setPickerIndex((i) => (i - 1 + pickerRows.length) % pickerRows.length);
        return;
      }
      if (key.downArrow) {
        setPickerIndex((i) => (i + 1) % pickerRows.length);
        return;
      }
      if (key.escape) { setPickerOpen(false); setPickerMode(null); return; }
      if (key.return) {
        commitPicker(pickerRows[pickerIndex]);
        return;
      }
      if (key.space || input === ' ') {
        commitPicker(pickerRows[pickerIndex]);
        return;
      }
      return;
    }

    if (slashOpen) {
      const count = slashItems.length;
      if (key.upArrow && count) {
        setSlashIndex((i) => (i - 1 + count) % count);
        return;
      }
      if (key.downArrow && count) {
        setSlashIndex((i) => (i + 1) % count);
        return;
      }
      if (key.escape) { setSlashOpen(false); return; }
      if (key.return) {
        const item = slashItems[slashIndex];
        if (!item) return;
        if (item.isBack) {
          setComposerText('', 0);
          setSlashOpen(false);
          return;
        }
        if (item.text === '@mention') {
          openPicker('mention');
          return;
        }
        if (item.text === '@focus') {
          openPicker('focus');
          return;
        }
        return;
      }
      if (key.backspace || key.delete) {
        const next = key.backspace
          ? composer.slice(0, Math.max(0, composerCursor - 1)) + composer.slice(composerCursor)
          : composer.slice(0, composerCursor) + composer.slice(composerCursor + 1);
        setComposer(next);
        setComposerCursor(key.backspace ? Math.max(0, composerCursor - 1) : composerCursor);
        setSlashIndex(0);
        if (!next || !next.startsWith('@')) setSlashOpen(false);
        return;
      }
      if (input === ' ') {
        setSlashOpen(false);
        insertText(' ');
        return;
      }
      if (!input || key.ctrl || key.meta) return;
      const nls = input.search(/[\r\n]/);
      if (nls >= 0) {
        insertText(input.slice(0, nls));
        return;
      }
      const inserted = input;
      const nextText = composer.slice(0, composerCursor) + inserted + composer.slice(composerCursor);
      insertText(inserted);
      setSlashIndex(0);
      const nextQuery = nextText.split(/\s+/)[0] || '@';
      if (!AT_COMMANDS.some((item) => item.display.startsWith(nextQuery))) {
        setSlashOpen(false);
      }
      return;
    }

    if (key.pageUp) {
      scrollBy(4);
      return;
    }
    if (key.pageDown) {
      scrollBy(-4);
      return;
    }
    if (key.tab) { cycleView(key.shift ? -1 : 1); return; }
    if (key.escape) {
      if (view !== 'stage') { switchView('stage'); return; }
      app.exit();
      return;
    }

    const shiftArrow = /^\u001b\[1;2([ABCD])$/.exec(input);
    if (shiftArrow) {
      room.cycleFocus(shiftArrow[1] === 'A' || shiftArrow[1] === 'D' ? -1 : 1);
      return;
    }
    if (key.shift && (key.upArrow || key.leftArrow)) { room.cycleFocus(-1); return; }
    if (key.shift && (key.downArrow || key.rightArrow)) { room.cycleFocus(1); return; }
    if (composer && (key.leftArrow || key.rightArrow)) {
      setComposerCursor((c) => key.leftArrow ? Math.max(0, c - 1) : Math.min(composer.length, c + 1));
      return;
    }
    if (composer && (key.upArrow || key.downArrow)) {
      // A non-empty composer owns the arrows: vertical arrows must not switch tabs.
      return;
    }
    if (!composer && (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow)) {
      moveView(key.upArrow ? 'up' : key.downArrow ? 'down' : key.leftArrow ? 'left' : 'right');
      return;
    }
    if (input.startsWith('\u001b')) return;

    if (room.approvals.length && (input === 'a' || input === 'A')) { room.respond('once'); return; }
    if (room.approvals.length && (input === 'd' || input === 'D')) { room.respond('deny'); return; }
    if (key.return) { submit(); return; }
    if (key.backspace) { deleteBackward(); return; }
    if (key.delete) { deleteForward(); return; }
    if (!input || key.ctrl || key.meta) return;
    const nl = input.search(/[\r\n]/);
    if (nl >= 0) {
      const full = composer.slice(0, composerCursor) + input.slice(0, nl) + composer.slice(composerCursor);
      setComposerText('', 0);
      if (full.trim() === '@mention') {
        openPicker('mention');
        return;
      }
      if (full.trim() === '@focus') {
        openPicker('focus');
        return;
      }
      room.submit(full, view === 'stage' ? null : view);
      return;
    }

    if (!composer && input.startsWith('@')) {
      const q = input.split(/\s+/)[0] || '@';
      const hasSpace = /\s/.test(input);
      setComposerText(input, input.length);
      setSlashOpen(!hasSpace && AT_COMMANDS.some((item) => item.display.startsWith(q)));
      setSlashIndex(0);
      return;
    }

    insertText(input);
  });

  const bodyWidth = Math.min(96, Math.max(20, columns - 2));
  const bubbleWidth = Math.max(20, Math.min(90, bodyWidth - 6));
  const all = room.bubbles;
  const lens = view === 'stage'
    ? all
    : all.filter((b) =>
      b.speaker === view ||
      (b.role === 'user' && Array.isArray(b.targets) && b.targets.includes(view)) ||
      (b.role === 'bot' && b.speaker !== view && mentionsMember(view, b.text)));
  const lastResponse = view === 'stage'
    ? null
    : lens.filter((b) => b.speaker === view && b.text && b.text.trim()).slice(-1)[0];
  const lastLine = lastResponse
    ? fitText(String(lastResponse.text).replace(/\s+/g, ' ').trim(), Math.max(20, columns - 8))
    : '';

  const bots = room.bots;
  // Tabs come from the one-shot roster, so the whole crew is visible from the first
  // full frame; each tab un-dims as its profile connects.
  const tabs = room.roster.map((r) => ({
    name: r.name,
    icon: r.icon || '',
    primary: !!r.isDefault,
    connected: !!r.connected,
  }));
  const t = room.theme || buildTheme({});
  if (!room.online) {
    // The default profile is the only profile the first paint waits for; show the banner instead of a blank page.
    return h(BootFrame, {
      columns,
      t,
      notice: room.notice,
      focusedName: room.focusName || 'default profile',
      total: room.roster.length || 1,
      view: 'stage',
      rows,
    });
  }
  const primary = bots.find((b) => b.primary) || bots[0];
  const primaryName = primary ? primary.name : 'primary bot';
  const focused = bots.find((b) => b.name === room.focusName) || primary;
  const focusedName = focused ? focused.name : primaryName;
  const focusShort = String(focusedName).split(' · ')[0];
  const composerHint = view === 'stage'
    ? 'Type your message to the room here. Directional Key or Tab to switch'
    : `Type your message to ${focusShort} here. Directional Key or Tab to switch`;

  const statusAnchor = primary;
  const statusAnchorName = statusAnchor ? statusAnchor.name : focusedName;
  const statusBots = focused ? [focused] : [];
  const statusRows = statusBots.map((b) => {
    const queuedCount = (room.queues[b.name] || 0) + Math.max(0, (room.pending[b.name] || 0) - 1);
    const parts = statusParts(b.name, room.runtimes[b.name], room.statuses[b.name] || 'ready', t, room.liveMetrics[b.name], room.tick, columns, room.tools[b.name], room.unread[b.name] || 0, room.thinking[b.name], queuedCount);
    const anchor = b.name === statusAnchorName;
    return {
      key: b.name,
      focused: b.name === focusedName,
      icon: b.icon || '',
      ...parts,
      profile: anchor && b.primary ? `${parts.profile} (default)` : parts.profile,
    };
  });

  const composerRule = '─'.repeat(Math.max(20, columns - 2));
  const bubbleTail = (b) => {
    const parts = Array.isArray(b.parts) ? b.parts : [];
    const texts = parts.filter((part) => part.kind === 'text');
    return texts.length ? texts[texts.length - 1].text : b.text;
  };

  const renderBubble = (b, displayText) => {
    const user = b.speaker === 'You';
    const parts = Array.isArray(b.parts) && b.parts.length
      ? b.parts
      : [{ kind: 'text', text: displayText == null ? b.text : displayText }];
    const hasDiff = parts.some((part) => part.kind === 'diff');
    const lastTextIndex = parts.reduce((idx, part, i) => (part.kind === 'text' ? i : idx), -1);
    const dots = '.'.repeat(1 + (room.tick % 3));
    const bubbleText = displayText == null ? (b.text || '') : displayText;
    const asksPeer = !user && (b.asksPeer || /\B@(everyone|all)\b/i.test(bubbleText)
      || room.bots.some((peer) => peer.name !== b.speaker && mentionsMember(peer.name, bubbleText)));
    const align = user || asksPeer ? 'flex-start' : 'flex-end';

    const borderColor = user ? t.accent : (b.borderColor || t.border);
    const topRule = `┏${'━'.repeat(Math.max(0, bubbleWidth - 2))}┓`;
    const bottomRule = `┗${'━'.repeat(Math.max(0, bubbleWidth - 2))}┛`;

    return h(Box, {
      key: b.id,
      width: bodyWidth,
      flexShrink: 0,
      justifyContent: align,
      marginTop: 1,
    },
      h(Box, {
        width: bubbleWidth,
        flexShrink: 0,
        flexDirection: 'column',
      },
        h(Text, { color: borderColor }, topRule),
        h(Box, { flexDirection: 'column', paddingX: 1 },
          user ? null : h(Text, { color: t.label, bold: true, wrap: 'truncate-end' },
            `${b.icon ? `${b.icon}  ` : ''}${t.toolPrefix} ${b.speaker}`),
          parts.map((part, i) => {
            const speakerCwd = (room.runtimes[b.speaker] && room.runtimes[b.speaker].cwd) || '';
            if (part.kind === 'tool') {
              return renderToolPart(part, t, i, { cwd: speakerCwd, width: Math.max(20, bubbleWidth - 4) });
            }
            if (part.kind === 'diff') return renderDiffPart(part.text, t, i, '', speakerCwd);
            const rawText = displayText != null && i === lastTextIndex ? displayText : part.text;
            const text = trimTrailingSpaces(rawText);
            if (displayText != null && hasDiff && i !== lastTextIndex) return null;
            if (!text) {
              return hasDiff ? null : h(Text, {
                key: `part-${i}`,
                color: user ? t.label : t.text,
                wrap: 'wrap',
                dimColor: true,
              }, dots);
            }
            return h(Text, {
              key: `part-${i}`,
              color: user ? t.label : t.text,
              wrap: 'wrap',
              dimColor: !String(part.text || '').trim(),
            }, text);
          })),
        h(Text, { color: borderColor }, bottomRule)));
  };

  const completed = lens.filter((b) => b.done && (b.text || hasDiffPart(b)));
  const active = lens.filter((b) => !b.done);

  // Fixed chrome: one version row, one scroll-hint row, the maximum status-board
  // rows, three composer rows (rule/text/rule), and three bottom rows (STAGE,
  // double separator, profile tabs).
  // Keeping the status reserve fixed prevents the transcript viewport from
  // resizing when a lens shows fewer or more status rows.
  const panelRows = 1;
  const scrollHintRows = 1;
  const composerRows = 3;
  const maxStatusRows = 1;
  const tabRows = 3;
  const approvalRows = room.approvals.length ? Math.min(14, approvalCardRows(room.approvals[0], columns)) : 0;
  const viewportHeight = Math.max(4, rows - (panelRows + scrollHintRows + maxStatusRows + composerRows + tabRows + approvalRows));

  const activePerBubble = active.length
    ? Math.max(1, Math.min(8, Math.floor(viewportHeight / active.length) - 4))
    : 0;
  const streaming = active.map((b) =>
    renderBubble(b, fitTail(bubbleTail(b), activePerBubble, bubbleWidth)));
  const measuredContentHeight = contentMetrics.height || 0;
  const measuredViewportHeight = viewportMetrics.clientHeight || viewportHeight;
  const contentViewportHeight = viewportHeight;
  const maxScroll = Math.max(0, measuredContentHeight - measuredViewportHeight);
  scrollMaxRef.current = maxScroll;
  const scrollLine = Math.min(scrollUp, maxScroll);
  const contentOffsetY = maxScroll - scrollLine;
  const hiddenNewer = scrollLine;

  const statusBar = h(Box, { marginTop: 0, height: maxStatusRows, flexDirection: 'column', width: Math.max(20, columns - 2), flexShrink: 0 },
    ...statusRows.map((row) => h(Text, {
      key: row.key, wrap: 'truncate-end',
    },
      row.icon ? h(Text, { color: row.focused ? 'yellow' : row.color, bold: row.focused, dimColor: row.dim }, `${row.icon}  `) : null,
      h(Text, { color: row.focused ? 'yellow' : row.color, bold: row.focused, dimColor: row.dim }, row.profile),
      h(Text, { color: row.focused ? 'yellow' : row.color, dimColor: row.dim }, ' · '),
      h(Text, { color: row.focused ? 'yellow' : row.color, bold: row.focused, dimColor: row.dim }, row.model),
      h(Text, { color: row.color, dimColor: row.dim }, ` · ${row.contextLabel}`),
      row.bar ? h(Text, { color: row.barColor, dimColor: row.dim }, ` · [${row.bar}] ${row.pctText}`) : null,
      row.cacheHit ? h(Text, { color: row.color, dimColor: row.dim }, ` · ${row.cacheHit}`) : null,
      row.compressions ? h(Text, { color: row.color, dimColor: row.dim }, ` · ${row.compressions}`) : null,
      h(Text, { color: row.color, dimColor: row.dim }, ` · ${row.latency}`),
      h(Text, { color: row.color, dimColor: row.dim }, ` · ${row.tps}`),
      row.subagents ? h(Text, { color: row.color, dimColor: row.dim }, ` · ${row.subagents}`) : null,
      row.activity ? h(Text, { color: row.activityColor }, ` · ${row.activity}`) : null,
      row.thinkingLabel ? h(Text, { color: t.muted }, `  ${row.thinkingLabel}`) : null,
      row.toolLabel ? h(Text, { color: t.tool || t.accent }, `  ${row.toolLabel}`) : null,
      row.queuedLabel ? h(Text, { color: t.muted }, `  ${row.queuedLabel}`) : null)));

  return h(Box, { flexDirection: 'column', paddingX: 1, height: rows },
    h(Box, { flexDirection: 'column', flexShrink: 0 },
      h(StagePanelBar, { focusedName, total: room.roster.length, view, t, columns })),
    h(Box, { flexGrow: 0, flexShrink: 0, flexDirection: 'column', width: '100%', justifyContent: 'flex-start' },
      scrollLine > 0
        ? h(Text, { key: 'scroll-hint', color: t.muted, dimColor: true, wrap: 'truncate-end' },
          `↓ ${hiddenNewer} newer · PgDn`)
        : h(Box, { key: 'scroll-space', height: 1, flexShrink: 0 }),
      h(Box, {
        key: 'transcript-viewport',
        ref: viewportRef,
        height: contentViewportHeight,
        flexShrink: 0,
        flexDirection: 'column',
        width: '100%',
        overflowY: 'hidden',
        contentOffsetY,
        justifyContent: 'flex-start',
      },
        h(Box, { ref: contentRef, flexDirection: 'column', flexShrink: 0 },
          h(StageBanner, { columns, t }),
          ...completed.map((b) => renderBubble(b)),
          ...streaming))),
    room.approvals.length ? renderApprovalCard({
      approval: room.approvals[0],
      selected: approvalSel,
      t,
      columns,
    }) : null,
    slashOpen && slashItems.length ? h(Box, {
      alignSelf: 'flex-start',
      backgroundColor: t.completionBg,
      flexDirection: 'row',
      width: slashMenuWidth,
    },
      h(Box, { flexDirection: 'column', flexGrow: 1 },
        ...slashWindow.map((item, i) => {
          const idx = slashOffset + i;
          const active = idx === slashIndex;
          return h(Box, {
            key: item.display,
            backgroundColor: active ? t.completionCurrentBg : undefined,
            flexDirection: 'row',
            width: '100%',
          },
            h(Box, { flexShrink: 0, width: slashNameWidth },
              h(Text, {
                bold: active,
                color: active ? t.primary : t.text,
                wrap: 'truncate-end',
              }, ` ${item.display}`)),
            h(Box, { flexGrow: 1 },
              h(Text, {
                color: active ? t.accent : t.muted,
                wrap: 'truncate-end',
              }, item.meta)));
        })),
      slashHasScrollbar ? h(Box, {
        backgroundColor: t.completionBg,
        flexDirection: 'column',
        width: 1,
      },
        ...scrollbarLines(slashOffset, slashItems.length, slashWindow.length).map((ch, i) =>
          h(Text, { key: i, color: ch === '┃' ? t.primary : t.muted }, ch))) : null) : null,
    pickerOpen ? h(Box, {
      alignSelf: 'flex-start',
      backgroundColor: t.completionBg,
      flexDirection: 'row',
      width: pickerMenuWidth,
    },
      h(Box, { flexDirection: 'column', flexGrow: 1 },
        ...pickerItems.map((option, i) => {
          const idx = pickerOffset + i;
          const selected = idx === pickerIndex;
          if (option.isBack) {
            return h(Box, {
              key: option.profile,
              backgroundColor: selected ? t.completionCurrentBg : undefined,
              width: '100%',
            },
              h(Text, {
                color: selected ? t.primary : t.muted,
                bold: selected,
                wrap: 'truncate-end',
              }, `${selected ? '▸ ' : '  '}‹ Back`));
          }
          const current = option.name === room.focusName;
          const prefix = selected ? '▸ ' : current ? '• ' : '  ';
          return h(Box, {
            key: option.profile,
            backgroundColor: selected ? t.completionCurrentBg : undefined,
            width: '100%',
          },
            h(Text, {
              color: selected ? t.primary : current ? t.accent : t.text,
              bold: selected,
              wrap: 'truncate-end',
            }, `${prefix}${idx + 1}. ${option.name}`));
        })),
      pickerHasScrollbar ? h(Box, {
        backgroundColor: t.completionBg,
        flexDirection: 'column',
        width: 1,
      },
        ...scrollbarLines(pickerOffset, pickerRows.length, pickerItems.length).map((ch, i) =>
          h(Text, { key: i, color: ch === '┃' ? t.primary : t.muted }, ch))) : null) : null,
    room.notice ? h(Box, {}, h(Text, { color: t.muted, dimColor: true }, room.notice)) : null,
    h(StageRoomRow, { view, t, columns }),
    h(Box, { flexDirection: 'column', flexShrink: 0 },
      h(Text, { color: t.border, dimColor: true }, composerRule),
      h(Text, { wrap: 'truncate-end' },
        h(Text, { color: t.label }, `${t.promptSymbol} `),
        composer
          ? h(Text, { color: t.text }, composer.slice(0, composerCursor))
          : h(Text, {
            color: 'gray',
            italic: view !== 'stage' && !!lastLine,
            dimColor: view !== 'stage' && !!lastLine,
          }, view === 'stage' ? composerHint : (lastLine || composerHint)),
        composer
          ? h(Text, { color: t.primary, inverse: true }, composer[composerCursor] || ' ')
          : null,
        composer ? h(Text, { color: t.text }, composer.slice(composerCursor + 1)) : null),
      h(Text, { color: t.border, dimColor: true }, composerRule)),
    statusBar,
    h(Text, {
      key: 'tabs-rule',
      color: t.border,
      dimColor: true,
      wrap: 'truncate-end',
    }, '═'.repeat(Math.max(20, columns - 2))),
    h(StageTabs, { tabs, view, unread: room.unread, statuses: room.statuses, t, columns, tick: room.tick }));
}

function enableMouseTracking() {
  process.stdout.write('\x1b[?1000h\x1b[?1006h');
}

function disableMouseTracking() {
  process.stdout.write('\x1b[?1006l\x1b[?1000l');
}


function main() {
  if (!process.stdout.isTTY) {
    process.stderr.write('Hermes Stage needs a TTY; run it in a terminal, not a pipe.\n');
    process.exit(1);
  }
  // Clear the terminal so the banner starts on a fresh
  // blank page instead of immediately below the `hermes stage` command.
  process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
  // Visible during gateway bring-up: a cleared screen with no line looks hung.
  process.stdout.write('Hermes Stage: starting room…\n');
  // Return the cursor to the top: the fixed-height frame is painted from row 1,
  // so writing the pre-render line must not shift it one row down.
  process.stdout.write('\x1b[H');
  process.on('exit', disableMouseTracking);
  process.on('SIGINT', () => { disableMouseTracking(); process.exit(130); });
  enableMouseTracking();
  try {
    render(h(Stage), {
      alternateScreen: true,
      incrementalRendering: true,
    });
  } catch (e) {
    process.stderr.write(`Hermes Stage failed to render: ${e && e.message ? e.message : e}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
