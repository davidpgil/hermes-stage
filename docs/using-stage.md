# Using Stage

Hermes Stage is one shared room with multiple profiles. Profile tabs are display
lenses over the same transcript, not separate private chats.

## Room model

- `STAGE` shows the unfiltered room.
- Each profile tab filters the same log to that profile’s lens.
- A bare message in `STAGE` goes to every member.
- A bare message in a profile lens goes only to the focused member.
- A bot reply containing `@name` is public and can pull that member into the next
  discussion round.

Peer discussion is capped at 3 rounds / 10 messages. Unknown or ambiguous
`@name` addresses fail visibly and send nothing.

## Controls

- **Enter** sends a message.
- **Tab / Shift+Tab** cycles profile lenses.
- **Esc** returns to `STAGE`.
- **Shift+Arrow** changes the focused profile.
- **`@focus`** opens the profile picker.
- **PgUp / PgDn** and the mouse wheel scroll the transcript.
- With an empty composer, **Up / Down** toggles between the profile row and `STAGE`;
  **Left / Right** moves through the profile row.

## Mentions and alignment

Mentions are highlighted as blue text tokens only: `@name`, `@everyone`, and `@all`.
There is no background pill or bold treatment.

Bot bubbles that address a peer are left-aligned so room-directed messages read
differently from ordinary replies. A normal bot reply is right-aligned.

## Silent acknowledgements

When a bot chooses not to speak — an exact `(pass)` reply, or an empty reply with no
tool or diff — Stage keeps the turn and shows a short non-verbal acknowledgement.
The phrase comes from the profile skin:

```yaml
branding:
  pass_ack: "*nods*"
```

The plugin falls back to `*nods*` when the field is absent. This is a client-side
acknowledgement, not an LLM-generated reply.

## Capacity fallback

Stage detects how many turns the model endpoint can serve at once, and the status row
shows `cap <admitted>/<slots>` plus `serial` when only one turn is admitted.

- **Serial mode (one slot):** a room message or `@everyone` is answered by one responder;
  the focused member is preferred, then the default profile. Other members observe and a
  notice says so, and automatic peer rounds stop after one round.
- **Parallel mode:** up to the gate limit members answer at once.
- **Busy brain:** if another client occupies every slot, Stage defers (2 s retry, 60 s cap)
  instead of piling onto the queue.
- **Status row:** the focused model/context row refreshes every 15 s while idle.
- **Dialogs:** approval and profile-picker menus fit the available screen rows.
  Approval command text truncates with a `… N more lines` marker; the profile picker
  scrolls. Opening an approval closes the picker so its choices stay on screen.
- **Probe failure:** Stage assumes one slot and stays serial rather than flooding the brain.

Queued turns appear as `⏸ N queued` on the status row and are dispatched as slots free.

## Reconnect

A dropped gateway connection is not fatal. Stage retries with backoff, re-creates the
profile's session, and returns the profile to the room. The status row shows
`connecting…` during attempts and `offline` only after the retry budget is exhausted.
`HERMES_STAGE_RECONNECT_MAX` (default 8) sets that budget.

## Status board

The status row never disappears. If no profile is connected yet, Stage renders the first
roster entry as a degraded placeholder (`not-ready`) and shows that profile's configured
model, so the room still names the brain it will use. Runtime model data replaces the
configured value once a session reports it. If runtime data is unavailable, Stage shows a
notice instead of silently dropping the failure.

## Tool calls and approvals

Tool calls are persisted in the transcript, not only in the status bar. A tool row
shows the tool name, context, duration, result summary, and ✓/✗ state; inline diffs
render below it.

Tool-call headers and summaries use a fixed gray (`#8A8F98`).

An approval card shows the command, description, profile/tool label, and choices
(`once`, `session`, `always`, `deny`). Use number keys, Up/Down plus Enter, or Esc to
deny. Pending approvals are replayed on connect. Timeout or cancellation closes the
card and marks the associated tool row as timed out.

See also: [Configuration](configuration.md), [Architecture](architecture.md).
