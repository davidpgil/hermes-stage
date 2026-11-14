/**
 * Room-state persistence.
 *
 * Completed bubbles are stored as-is. A bubble that was still streaming when the room
 * was saved (or when the process died) is stored with ``interrupted: true`` so restoring
 * it renders a completed bubble with an "interrupted" marker instead of a spinner that
 * can never finish.
 */

export const MAX_STATE_MESSAGES = 400;

function validBubble(b) {
  return b && typeof b === 'object'
    && typeof b.id === 'string'
    && typeof b.speaker === 'string'
    && typeof b.text === 'string';
}

export function serializeRoomBubbles(bubbles, limit = MAX_STATE_MESSAGES) {
  return (Array.isArray(bubbles) ? bubbles : [])
    .filter(validBubble)
    .map((b) => ({ ...b, done: true, interrupted: Boolean(b.interrupted || b.done === false) }))
    .slice(-limit);
}

export function restoreRoomBubbles(list, limit = MAX_STATE_MESSAGES) {
  return (Array.isArray(list) ? list : [])
    .filter(validBubble)
    .map((b) => ({ ...b, done: true, interrupted: b.interrupted === true }))
    .slice(-limit);
}
