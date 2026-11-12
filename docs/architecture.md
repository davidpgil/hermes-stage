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

## Event flow

The client handles turn events, tool events, approvals, and status changes from the
gateway. Tool calls are persisted as transcript parts. Approval requests are shown as
cards and answered by profile and gateway source.

## Approval settlement

`approval.settled` means the approval was settled; it is not a cancellation. Only
`approval.cancelled` and `request.cancel` produce a cancellation notice. A successful
session approval therefore keeps its actual choice and lets the tool complete.

## Rendering model

Stage uses Ink with a fixed transcript viewport and incremental repainting. Profile
tabs are not separate sessions; they are lens views over the shared room state.

## Limitations

- The room is simulated by the plugin, not Hermes Desktop's hosted group-room engine.
- Persistence restores the transcript only.
- `message_agent` is deliberately not used in Stage Room sessions.

See also: [Development](development.md), [Security and disclosures](security.md).
