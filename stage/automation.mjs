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

export function makeAutomationBubble(bot, payload, id, text = automationText(payload)) {
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
    machine: true,
    parts: [{ kind: 'text', text }],
    asksPeer: false,
  };
}
