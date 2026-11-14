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
- **Lazy profile registry** — only the default profile connects at startup. Tabbing or
  selecting a profile in the menu changes the view/focus but does not wake it; an explicit
  `@focus` command or a mention wakes it. A due cron job also wakes it.
- **Dim sleeping profiles** — cold profiles render grey/dim in the tabs, profile picker,
  and status board rather than as active or error states.
- **Cron watcher** — reads profile `cron/jobs.json`, wakes a profile for its next job
  window, and releases it after an idle hold. Non-LLM; the gateway still runs the job.
- **Automation side notes, cron reports as content** — automation events are rendered as
  dim grey room notes, not normal bot turns, except cron job output: the `[Cronjob …]`
  transport header is stripped and replaced by a dim `⚙ cron · <name>` tag while the
  report body keeps normal text color. Automation does not trigger peer rounds; at
  completion it marks the profile unread so its tab shows the blue indicator. Hidden
  context rows remain skipped.
- **Public profile speech feed** — reads each non-default profile’s `state.db` for final
  assistant speech and cron notifications. Cron notification rows are rendered as readable
  content tagged `⚙ cron · <name>`, not as gray machine notes. Tool calls, failed turns,
  private user prompts, assistant `(pass)` rows, and Stage Room session duplicates are
  excluded. Feed cursors are
  versioned; legacy unversioned cursors are reset and re-seeded instead of trusted. The feed
  is plugin-local and does not alter gateway routing.
- **Explicit mentions wake a cold profile** — a bot reply containing `@Name` wakes
  that cold profile so it can take the next turn. Tab, picker, and shift-arrow focus
  still only change focus.
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
- The transcript is windowed: only the tail of the room that fits the viewport
  (plus the current scroll offset, capped at eight screens) is laid out. Ink
  rebuilds the rendered tree per frame, so an unwindowed 265-bubble room was
  re-laid out in full on every animated tick.
- The animation tick is gated on real work — a live turn, a tool/thinking entry,
  or a bubble that is still arriving. A non-terminal status string alone (e.g.
  `connecting…`) no longer keeps the 400 ms tick alive; that case uses 1 s, and
  an idle room uses none.
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
