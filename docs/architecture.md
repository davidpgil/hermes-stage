# Architecture

Hermes Stage is a terminal client over Hermes' local canonical gateway. It does not
modify Hermes core; it opens Stage Room sessions for profiles and keeps one shared
transcript.

## Main components

- **Gateway connection** — one authenticated WebSocket connection per profile.
- **Shared transcript** — one ordered room log stored by the plugin.
- **Profile lenses** — tabs that render a filtered view of the same log.
- **Serial discussion** — addressed members take turns; peer mentions run additional
  rounds, capped at 3 rounds / 10 messages.
- **Capacity gates** — one admission gate per model endpoint. A gate admits
  `slots - reserved` turns at once, queues the rest, and degrades a room message to a
  single responder when only one slot is available. Live `/slots` occupancy is checked
  before admitting, so turns are deferred while another client holds the brain.
- **Lazy profile registry** — only the default profile connects at startup; other profiles
  wake on focus, mention, or a due cron job.
- **Cron watcher** — reads profile `cron/jobs.json`, wakes a profile for its next job
  window, and releases it after an idle hold. Non-LLM; the gateway still runs the job.
- **Automation side notes** — automation events are rendered as dim grey room notes, not
  normal bot turns. They do not trigger peer rounds or unread counts; hidden context rows
  remain skipped.
- **Idle status refresh** — the focused bot's `session.info` is polled every 15 s while
  the room is idle, so the model/context row stays current without waiting for a turn.
- **Screen-budgeted dialogs** — approval and profile-picker rows are deducted from the
  transcript viewport. Approval text truncates with a marker; the picker scrolls.
  An approval closes the picker so its choices stay visible.
- **Bounded reconnect** — a dropped socket retries with exponential backoff, creates a
  fresh session, and rejoins the room; a terminal bootstrap failure stops immediately.

## Event flow

The client handles turn events, tool events, approvals, and status changes from the
gateway. Idempotent reads retry once on transport failure and surface a notice; writes
and session creation are never retried. Tool calls are persisted as transcript parts.
Approval requests are shown as cards and answered by profile and gateway source.

## Approval settlement

`approval.settled` means the approval was settled; it is not a cancellation. Only
`approval.cancelled` and `request.cancel` produce a cancellation notice. A successful
session approval therefore keeps its actual choice and lets the tool complete.

## Rendering model

Stage uses Ink with a fixed transcript viewport and incremental repainting. Profile
tabs are not separate sessions; they are lens views over the shared room state.
The status board always renders one row: a connected bot when one resolves, otherwise a
degraded placeholder from the roster that shows the profile's configured model.

## Performance

- Streamed delta events are buffered and flushed at roughly 80 ms rather than
  updating the room log for every token.
- Completed bubbles are memoized, so a spinner tick or another profile's stream
  does not reconcile every completed transcript bubble.
- Room-state writes use compact JSON rather than pretty-printed JSON.
- Admission is capacity-aware: the endpoint's `/props` slot count sizes the gate, so
  queued turns are dispatched as slots free instead of flooding one brain.
- Room context limits and discussion caps are unchanged.

## Limitations

- The room is simulated by the plugin, not Hermes Desktop's hosted group-room engine.
- Persistence restores the transcript only; an in-flight turn restores as a completed
  bubble marked `· interrupted` rather than a spinner that can never finish.
- `message_agent` is deliberately not used in Stage Room sessions.

See also: [Development](development.md), [Security and disclosures](security.md).
