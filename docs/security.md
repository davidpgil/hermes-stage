# Security and Disclosures

Hermes Stage is a local terminal client. It does not modify Hermes core and does not
open third-party network connections.

## Disclosure summary

- Launches Hermes' own local `gateway_bootstrap.py` helper and a local Node process.
- Opens loopback WebSocket connections to local Hermes gateways.
- Does not read credentials.
- Writes the room transcript to `$HERMES_HOME/state/hermes-stage-room.json`, or to the
  path set by `HERMES_STAGE_ROOM_STATE`.
- Uses only public npm dependencies (`ink`, `react`, `string-width`); no private Hermes
  npm package is required.
- Contains no self-updating code.

## Trust boundaries

Profile skins are configuration, not code. `branding.pass_ack` is a display string
and is rendered as text; it is not evaluated.

Approval cards display gateway-provided commands and choices. The client routes the
selected choice back to the gateway; it does not execute the command itself.

See also: [Architecture](architecture.md), [Development](development.md).
