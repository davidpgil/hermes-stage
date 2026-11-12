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
