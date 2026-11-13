# Changelog

All notable changes to Hermes Stage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.65.0] - 2026-11-13

### Added

- Automation deliveries mark the profile unread at completion, so its tab shows the blue
  `●` indicator when the profile is not the current lens.
- Leaving `STAGE` returns to the last selected profile lens. A cold selected lens keeps
  its own name in the panel header and composer instead of falling back to the default.

### Verified

- Automation mock: a delivered automation note produced a blue `●` on the tab.
- Navigation mock: view Bot 01, leave to STAGE, then Tab returned to the Bot 01 lens with
  `focus Bot 01`.
- 66 local tests pass.

## [0.64.2] - 2026-11-13

### Fixed

- Mention parsing now accepts trailing punctuation: `@Shir,` routes to Shir only
  instead of falling back to a room broadcast. The lookahead permits any non-handle
  character after the name.

### Verified

- Mock: `@bot-01, hello` created a second connection and the room state recorded
  `targets: ['Bot 01']` only.
- 66 local tests pass.

## [0.64.1] - 2026-11-13

### Fixed

- Sleeping profiles now use an explicit neutral gray instead of the theme's `t.muted`
  (which was orange). The `○` marker was removed; cold tabs/menu rows are gray and dim.
- A focused sleeping profile's status row is gray and non-bold rather than yellow.

### Verified

- Mock terminal output: cold tabs render with `\x1b[2m\x1b[90m` and no `○`; 66 tests pass.

## [0.64.0] - 2026-11-13

### Changed

- Tabbing across profile lenses and selecting a profile from the picker now only move
  focus; they no longer wake a cold profile.
- `@focus <name>` and mentions are the explicit wake actions; a due cron job can also
  wake a profile.
- Sleeping profiles render dim/grey in tabs, the profile picker, and the status board.

### Verified

- 15-profile mock: startup 1 connection; Tab left it at 1; picker selection left it at 1;
  explicit `@focus bot-01` raised it to 2.
- 66 local tests pass.

## [0.63.0] - 2026-11-13

### Added

- Automation events are now rendered as dim grey side notes in the room instead of being
  filtered out. This covers cron/internal notifications, process completions, and similar
  automation kinds.
- `stage/automation.mjs` classifies automation payloads and builds the dim-note bubble.

### Changed

- Automation notes are not treated as normal bot turns; they do not trigger peer rounds
  or increment unread counts.
- Hidden context-compaction rows remain skipped.

### Verified

- A mock gateway sent an `internal_notification` automation message while Stage was open:
  the room showed `Cron report delivered` and the report text as dim grey lines with ANSI
  dim/colour styling.
- 65 local tests pass.

## [0.62.0] - 2026-11-13

### Added

- Lazy profile registry: only the default profile connects at startup. Other profiles
  wake on focus, mention, or a due cron job; a message to a cold profile waits until it
  is ready.
- Non-LLM cron watcher (`stage/cron-watch.mjs`): reads each profile's `cron/jobs.json`,
  wakes the profile shortly before its next due job, holds it for five minutes, and
  releases it while idle. It never calls a model or runs the cron job.

### Changed

- Removed the eager startup fan-out that bootstrapped every profile at once.
- Removed the unused connection-pool helper.

### Verified

- 15-profile mock: one connection at startup; a second profile woke only after
  `@focus`; another due cron job woke a profile without focus.
- 62 local tests pass.

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
