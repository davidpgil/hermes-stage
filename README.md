# Hermes Stage

Hermes Stage is a terminal-based, multi-profile bot room for Hermes Agent. Running
`hermes stage` opens one shared transcript: the `STAGE` view shows the full room,
while each profile tab is a lens over the same conversation.

Messages are public room messages. Address one profile with `@name`; there is no
broadcast address.

## What it gives you

- One shared room instead of separate private chats.
- Profile tabs that act as display lenses over the same transcript.
- Tool calls, diffs, and approval cards visible in the transcript.
- A focused status board for each profile.
- Capacity-aware turn admission (slot count plus live occupancy) so a room never floods the model endpoint.
- Bounded reconnect after a gateway restart, so an open room recovers itself.
- A status board that stays visible before profiles connect, showing the configured model.
- Failures are surfaced as notices instead of silently swallowed.
- Profiles load lazily: only the default profile connects at startup. Tabbing or picking a
  profile in the menu only changes focus; an explicit `@focus` or a mention wakes it.
- Sleeping profiles render dim/grey in tabs, menus, and the status board.
- Public profile speech from non-default profiles — final assistant text and cron
  notification text — is mirrored into the room; tool calls, failed turns, and private
  user prompts are skipped.
- Automation events (cron/internal notifications and process completions) appear as dim grey
  side notes and mark the profile unread with a blue indicator.
- Interrupted turns persist with a marker instead of being lost on a crash.
- The model/context row refreshes while idle instead of only after a turn.
- Dialogs fit the screen: long approval text truncates with a marker, and the profile
  picker scrolls while keeping its options reachable.
- A configurable roster of Hermes profiles.

## Requirements

- Hermes Agent **v0.23.1+** with a local gateway runtime exposing the `tui` session source.
- **Node 22+** on `PATH`.
- The Stage dependencies `ink`, `react`, and `string-width` installed once with npm.

## Install

From a local checkout:

```sh
cd ~/.hermes/plugins/hermes-stage/stage
npm install --no-audit --no-fund
cd ~/.hermes/plugins/hermes-stage
hermes plugins enable hermes-stage
```

From the catalog:

```sh
hermes plugins install hermes-stage
cd ~/.hermes/plugins/hermes-stage/stage
npm install --no-audit --no-fund
hermes plugins enable hermes-stage
```

## Quick start

```sh
hermes stage
```

The default profile is always first. Other communicable profiles are included
from `profiles.list`; no profile names are hardcoded.

To limit or order the roster:

```sh
HERMES_STAGE_PROFILES=default,profile-a,profile-b hermes stage
```

Use `HERMES_STAGE_PROFILES=all` for the full roster.

## Using the room

- Type a message and press **Enter**.
- A bare message in `STAGE` goes to every awake member. A bare message in a profile lens
  goes only to that focused member.
- `@name` routes one message to that member without changing focus.
- There is no broadcast address; cold profiles do not receive room messages.
- **Tab / Shift+Tab** cycles profile lenses.
- **Esc** returns to the `STAGE` room.
- **Shift+Arrow** changes the focused profile.
- **`@focus`** opens the profile picker.
- **PgUp / PgDn** and the mouse wheel scroll the transcript.

Approval cards use number keys, Up/Down plus Enter, or Esc to deny. Existing
`a` / `d` shortcuts remain available.

## Performance

Stage coalesces streamed deltas at roughly 80 ms, memoizes completed transcript
bubbles, and writes compact room-state JSON. Spinner ticks and stream updates
therefore do not force every completed bubble to reconcile again.

## Documentation

- [Documentation home](docs/index.md)
- [Getting started](docs/getting-started.md)
- [Using Stage](docs/using-stage.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Security and disclosures](docs/security.md)
- [Changelog](CHANGELOG.md) — release history.

## Version

Current release: **0.66.0**

## License

MIT. See [LICENSE](LICENSE).
