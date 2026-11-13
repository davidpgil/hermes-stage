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

## Capacity and admission control

Stage probes each profile's model endpoint (`/props` and `/slots`) and admits at most
`slots - reserved` turns per endpoint at once. The probe result is cached for 30 seconds.
If the probe fails, Stage assumes one slot and stays serial.

```sh
HERMES_STAGE_RESERVED_SLOTS=1 hermes stage
```

`HERMES_STAGE_RESERVED_SLOTS` keeps slots free for stock Hermes or other clients sharing
the same brain; it defaults to 1. A gate never drops below one slot, so the room always
makes progress.

When the most constrained endpoint admits only one turn, the room runs in **serial**
mode: a room message or `@everyone` gets one responder (the focused member, or the default
profile), other members observe, and automatic peer rounds stop after one round. With two
or more admitted slots the room runs in **parallel** mode up to the gate limit.

## Reconnect

If the gateway restarts or a profile socket drops, Stage reconnects with exponential
backoff (1 s, 2 s, 4 s, … capped at 30 s) for up to `HERMES_STAGE_RECONNECT_MAX` attempts
(default 8). Terminal bootstrap failures stop immediately. Reconnect opens a fresh
session and re-registers the profile in the room.

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
