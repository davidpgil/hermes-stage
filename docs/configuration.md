# Configuration

Stage reads the roster from Hermes profiles and uses profile skins for presentation.
No profile names are hardcoded.

## Roster filtering

```sh
HERMES_STAGE_PROFILES=default,profile-a,profile-b hermes stage
```

- The default profile is always included and placed first.
- `HERMES_STAGE_PROFILES=all` selects the full roster.
- Without the variable, every communicable profile is included.

## Profile skins

A profile's skin lives under that profile:

```text
~/.hermes/profiles/<profile>/skins/<profile>.yaml
```

The default profile uses the Hermes home's skin directory because its home is the
Hermes home itself.

Relevant presentation fields:

```yaml
branding:
  agent_name: "Display Name"
  icon: "icon"
  pass_ack: "*nods*"
colors:
  bubble_border: "#2c6cf2"
```

`branding.pass_ack` is used when the profile chooses not to speak. If it is absent,
Stage uses the generic fallback `*nods*`.

## Persistence

The completed room transcript is stored at:

```text
$HERMES_HOME/state/hermes-stage-room.json
```

Override the location:

```sh
HERMES_STAGE_ROOM_STATE=/path/to/room.json hermes stage
```

Persistence restores the transcript, not gateway sessions, approvals, queues, or
unread state.

## Theme and colors

Stage builds its palette from the active profile skin and terminal theme. Tool-call
headers and summaries intentionally use the fixed gray `#8A8F98`; mention tokens use
blue `#4DA6FF`.

See also: [Using Stage](using-stage.md), [Development](development.md).
