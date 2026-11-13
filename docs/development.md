# Development

This page covers repository layout, tests, release versions, and the pre-commit hook.

## Repository layout

```text
README.md              New-user guide
docs/                  Documentation
plugin.yaml            Plugin manifest and version
stage/entry.mjs        Stage client
stage/capacity.mjs     Capacity probe and admission gates
stage/reconnect.mjs    Bounded reconnect policy
stage/status.mjs       Status-board source resolution
stage/rpc-retry.mjs    Retry policy for idempotent RPC reads
stage/package.json     JavaScript package metadata
scripts/               Installation, reset, and hook helpers
.githooks/pre-commit   Tracked sanitization/docs gate
.githooks/pre-push     Refuses pushing tests to GitHub
```

Local test files live in `stage/tests/`. They are intentionally untracked and are
never published: the pre-commit hook refuses staged test files, the pre-push hook
refuses any ref whose tree contains them, and `.gitignore` keeps them out.

## Tests

```sh
node --check stage/entry.mjs
npm --prefix stage test
hermes plugins validate .
git diff --check
```

The tests cover delta assembly, tool-part updates, approval key dispatch and answer
routing, skin-driven acknowledgements, mention tokenization, and capacity admission
(probe parsing, gate limits, FIFO queueing, and serial/parallel degradation), plus the
reconnect policy (backoff, attempt budget, terminal-error classification), the status
resolver (focused/primary/placeholder and configured-model fallback), and the RPC retry
policy (retryable vs semantic errors, attempt budget). The suite is local-only and is not
part of the published repository.

## Versioning

The release version must agree across:

- `plugin.yaml`
- `stage/package.json`
- `stage/package-lock.json`
- `stage/entry.mjs` (`STAGE_VERSION`)
- `README.md` (`Current release`)

The pre-commit hook checks these values.

## Git hooks

Enable the tracked hooks once per checkout:

```sh
scripts/install-hooks.sh
```

The hooks enforce:

- no private paths, hostnames, credentials, or internal identifiers in staged content;
- tests are local-only: the pre-commit hook refuses staged test files and the
  pre-push hook refuses any ref whose tree contains them;
- version consistency across the release surface;
- a staged README update when code changes are staged;
- at least one staged documentation update when code changes are staged;
- required new-user README sections and documentation links;
- documentation coverage for `pass_ack`, blue mentions, and gray tool-call styling.

Do not use `--no-verify` to bypass a violation you introduced. Fix the flagged file
and stage the documentation update.

## Hermes catalog release

The catalog release is part of the release workflow:

```sh
scripts/hermes-catalog-pr.sh --check
scripts/hermes-catalog-pr.sh
```

- `--check` verifies that `NousResearch/hermes-agent` already pins the current
  plugin version and commit SHA.
- Without flags, the helper syncs the fork, updates
  `plugin-catalog/hermes-stage.yaml`, and opens or returns the catalog PR.
- `--dry-run` prints the planned branch and PR without changing GitHub.

The helper is idempotent: if the catalog already pins the release, it exits 0; if an
open PR for that release exists, it returns that PR URL instead of creating a duplicate.

The pre-commit hook requires this helper to exist and be documented here.

## Release checklist

1. Update code and tests.
2. Update README and docs.
3. Bump the version in all release surfaces.
4. Run the test battery.
5. Commit; the pre-commit hook must pass.
6. Push the plugin release to GitHub.
7. Run `scripts/hermes-catalog-pr.sh` and link the resulting Hermes catalog PR.
