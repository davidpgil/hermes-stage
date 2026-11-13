# Changelog

All notable changes to Hermes Stage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.61.0] - 2026-11-13

### Removed

- `@everyone` / `@all` broadcast addressing. Room messages now reach only awake
  profiles; cold profiles are not woken by a broadcast. Bot prompts no longer teach
  the broadcast form.

### Changed

- Bare `STAGE` messages address the currently awake profiles only.

## [0.60.0] - 2026-11-13

### Changed

- Approval dialog command text is capped to the rows available on screen; overflow is
  marked with `… N more lines` instead of silently disappearing. Its choices remain
  visible.
- The profile picker is height-budgeted (up to 12 rows) with a scrollbar, so it stays
  on screen and its options remain reachable. The picker and command menu close when
  an approval arrives, prioritizing the approval dialog.

### Verified

- 80×24 mock UI run: picker showed 12 rows with composer and tabs still visible; a
  long approval showed a truncation marker, all four choices, and the bottom chrome.

## [0.59.0] - 2026-11-13

### Added

- Idle status refresh: the focused bot's `session.info` is polled every 15 s
  (5–60 s via `HERMES_STAGE_STATUS_REFRESH_MS`) so the model/context row stays
  current without waiting for a turn. Streaming, queued, offline, and placeholder
  bots are skipped.

### Repository

- Removed the local-only test file from published Git history; history was rewritten
  and force-pushed. Tests remain local-only and are enforced by hooks.

### Verified

- 60 local tests pass.
- Mock gateway idle run recorded initial + two periodic `session.info` calls.

## [0.58.0] - 2026-11-13

### Fixed

- A reconnect attempt that failed before the socket opened rejected an internal
  promise with no listener and crashed the process. The promise now has a handler,
  and the attempt is retried by the backoff loop.

### Verified

- Real gateway restart: both bots reconnected and created fresh sessions.

## [0.57.0] - 2026-11-13

### Added

- Interrupted-turn persistence: a bubble still streaming when the room is saved is
  stored as an interrupted completed bubble and restores with a `· interrupted`
  marker instead of a spinner that can never finish.

## [0.56.0] - 2026-11-13

### Added

- Bounded profile-connection pool, default 4 (maximum 8), configurable via
  `HERMES_STAGE_CONNECT_PARALLEL`. Reduces cold-start wall time for a large roster.

## [0.55.0] - 2026-11-13

### Added

- Live occupancy-aware admission: Stage checks `/slots` before admitting a turn and
  defers while another client occupies every slot (2 s retry, 60 s cap, then submits
  with a notice).

## [0.54.0] - 2026-11-13

### Fixed

- Idempotent RPC reads (`session.info`, `client.capabilities`, `approval.pending`)
  retry once on transport errors and surface failures instead of swallowing them.
  Writes are never retried.

## [0.53.0] - 2026-11-13

### Fixed

- The status board no longer collapses when no bot resolves; it renders a
  placeholder row and falls back to the configured model.

## [0.52.0] - 2026-11-13

### Added

- Bounded reconnect after a gateway restart or socket drop: exponential backoff,
  fresh session creation, and room re-registration.

## [0.51.0] - 2026-11-13

### Added

- Capacity-aware turn admission and serial fallback so a room message never floods
  the model endpoint. Slot count is probed and cached; one slot is reserved for
  other clients.

## Earlier releases

Earlier versions predate this changelog; their changes are recorded in Git history.
