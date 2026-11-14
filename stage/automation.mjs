export const AUTOMATION_KINDS = new Set([
  'process_complete',
  'async_delegation_complete',
  'internal_notification',
  'auto_continue',
  'diagnostic',
  'hidden',
  'model_switch',
]);

export function automationKind(payload) {
  if (!payload) return '';
  return String(payload.display_kind || '');
}

export function isAutomationTurn(payload) {
  if (!payload) return false;
  const kind = automationKind(payload);
  if (kind && AUTOMATION_KINDS.has(kind)) return true;
  if (payload.notification_category) return true;
  const text = String(payload.text || payload.display_text || '');
  if (!text) return false;
  return /^\[IMPORTANT:|Background process \S+ completed|^\[ASYNC DELEGATION|^\[System:/.test(text);
}

export function automationText(payload) {
  if (!payload) return '';
  return String(payload.display_text ?? payload.text ?? '');
}

// A cron job's admitted output arrives as an internal_notification whose text
// starts with a fixed transport header:
//   [Cronjob "<name>" output — scheduled job, not the user. Review it, ...]
// That payload carries real content (a brief/report), not machine chatter, so it
// must render as readable text rather than as a dim side note.
const CRON_HEADER = /^\[Cronjob "([^"]+)" output\b[^\]]*\]\s*/;

export function cronJobName(payload) {
  if (!payload) return null;
  const match = CRON_HEADER.exec(automationText(payload));
  return match ? match[1] : null;
}

export function isCronReport(payload) {
  return cronJobName(payload) !== null;
}

// The report body with the transport header stripped for display.
export function cronReportText(payload) {
  return automationText(payload).replace(CRON_HEADER, '');
}

export function makeAutomationBubble(bot, payload, id, text = automationText(payload), { machine = true, tag = null } = {}) {
  return {
    id,
    speaker: bot.name,
    color: bot.color,
    borderColor: bot.borderColor,
    text,
    done: false,
    at: Date.now(),
    role: 'bot',
    icon: bot.icon,
    auto: true,
    machine,
    tag,
    parts: [{ kind: 'text', text }],
    asksPeer: false,
  };
}

// Cron reports stay classified as automation (never an expected bot turn) but
// drop the machine styling: full-color text plus a dim tag naming the job.
export function makeReportBubble(bot, payload, id) {
  const job = cronJobName(payload);
  return makeAutomationBubble(bot, payload, id, cronReportText(payload), {
    machine: false,
    tag: job ? `⚙ cron · ${job}` : '⚙ scheduled',
  });
}
