Hermes Stage is a self-contained terminal-based multi-profile TUI launched over the canonical gateway WebSocket. It maintains one ordered shared transcript: the STAGE room is the unfiltered room, while each profile tab is a display lens over that same log rather than a separate chat. Messages are addressed publicly with @name or @everyone; addressed members receive a bounded whole-room context, bot replies can notify peers.

# Hermes Stage

`hermes stage` launches a multi-profile terminal room over Hermes' local gateway. It does
not modify Hermes core, and the stock `hermes --tui` continues to work normally.

Current version: **0.50.39**.

## Requirements

- Hermes Agent **v0.23.1+** with a local gateway runtime that exposes the `tui` session source.
  Tested on Hermes v0.23.1.
- **Node 22+** on PATH. Tested on Node 26.
- Stage's JS dependencies (`ink`, `react`, `string-width`) are installed once with npm.

## Install

From a local plugin checkout:

```sh
cd ~/.hermes/plugins/hermes-stage/stage
npm install --no-audit --no-fund
cd ~/.hermes/plugins/hermes-stage
hermes plugins enable hermes-stage
```

From a catalog install:

```sh
hermes plugins install hermes-stage
cd ~/.hermes/plugins/hermes-stage/stage
npm install --no-audit --no-fund
hermes plugins enable hermes-stage
```

## Run

```sh
hermes stage
```

The roster is read from `profiles.list`. Every communicable profile is included by
default, and no profile names are hardcoded.

To limit or order the roster:

```sh
HERMES_STAGE_PROFILES=default,profile-a,profile-b hermes stage
```

The default profile is always included and is placed first. `HERMES_STAGE_PROFILES=all`
also selects the full roster.

## Rendering

Stage runs in the terminal's alternate screen and uses Ink's incremental renderer.
After the initial frame, only changed lines are repainted, so the profile row and
transcript do not require a full-screen clear on every update.

It uses only public npm dependencies (`ink`, `react`, and `string-width`); no private
Hermes npm package is required.

Mentions are highlighted as blue text tokens only (`@name`, `@everyone`, `@all`);
there is no background pill or bold treatment. Bot bubbles that address a peer are
left-aligned so room-directed messages read differently from ordinary replies.

## Skin hook: silent-turn acknowledgement

When a bot chooses not to speak (`(pass)`, or an empty reply with no tool/diff),
Stage keeps the turn and shows a short non-verbal acknowledgement. The phrase comes
from the profile's skin, not the plugin:

```yaml
branding:
  pass_ack: "*nods*"
```

The plugin falls back to `*nods*` when the field is absent. This is a client-side
acknowledgement, not an LLM-generated reply.

## Using the room

- **`STAGE`** is the unfiltered room. Every profile tab is a **lens** over the same
  shared transcript, not a private chat.
- Type a message and press **Enter**.
- A bare message in `STAGE` goes to every member. A bare message in a profile lens goes
  only to that focused member.
- `@name` routes one message to that member without changing focus.
- `@everyone` / `@all` addresses every member.
- **Tab / Shift+Tab** cycles profile lenses.
- **Esc** returns to the `STAGE` room.
- **Shift+Arrow** changes the focused profile.
- **`@focus`** opens the profile picker and changes the focused profile.
- With an empty composer, **Up/Down** moves between the profile row and `STAGE`;
  **Left/Right** moves through the profile row.
- **PgUp/PgDn** and the mouse wheel scroll the transcript.

A bot reply containing `@name` is public and can pull that member into the next round.
Peer discussion is capped at 3 rounds / 10 messages. Unknown or ambiguous `@name`
addresses fail visibly and send nothing.

## Persistence and reset

Stage stores its completed room transcript locally at:

`$HERMES_HOME/state/hermes-stage-room.json`

Override the path with `HERMES_STAGE_ROOM_STATE`. On restart, the completed transcript
is restored before the first full frame; active streaming turns are not persisted.

For a clean demo:

```sh
scripts/reset-stage-room.sh
```

## Tool trail and approvals

Bot tool calls are persisted in the transcript, not just the status bar. A call
appears as a tool row with its name, context, duration, result summary, and
✓/✗ state; inline diffs still render below it.

A tool that needs approval opens a prompt card with the gateway’s command,
description, profile/tool label, and choices (`once`, `session`, `always`,
`deny`). Use number keys, Up/Down plus Enter, or Esc to deny. Existing `a`/`d`
shortcuts remain. Pending approvals are replayed on connect, and timeout/
cancellation closes the card and marks the associated tool row as timed out.

## Disclosures

- Launches Hermes' own `gateway_bootstrap.py` helper from the local Hermes install and starts a local Node process.
- Opens loopback WebSockets to local Hermes gateways. No third-party network calls.
- Reads no credentials.
- Writes the local room transcript to the path above. No other user files are read.
- Uses only public npm dependencies (`ink`, `react`, `string-width`); no private Hermes npm package.
- No self-updating code.

## Known limitations

- The room is simulated by the plugin: one ordered room log plus per-member Stage Room
  sessions, not Hermes Desktop's hosted group-room engine.
- Profile tabs are display lenses over the shared room log, not separate private chats.
- Persistence restores the transcript, not each profile's gateway session, approvals,
  queue, or unread state.
- Approval UI is implemented, but a pending approval is required to exercise it end to end.
- `message_agent` is deliberately not used in Stage Room sessions; address members with
  `@name`.
- Node is an external runtime dependency.
