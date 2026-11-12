# Development

This page covers repository layout, tests, release versions, and the pre-commit hook.

## Repository layout

```text
README.md             New-user guide
docs/                 Documentation
plugin.yaml           Plugin manifest and version
stage/entry.mjs       Stage client
stage/package.json    JavaScript package metadata
stage/tests/          Helper tests
scripts/              Installation, reset, and hook helpers
.githooks/pre-commit  Tracked sanitization/docs gate
```

## Tests

```sh
node --check stage/entry.mjs
npm --prefix stage test
hermes plugins validate .
git diff --check
```

The tests cover delta assembly, tool-part updates, approval key dispatch and answer
routing, skin-driven acknowledgements, and mention tokenization.

## Versioning

The release version must agree across:

- `plugin.yaml`
- `stage/package.json`
- `stage/package-lock.json`
- `stage/entry.mjs` (`STAGE_VERSION`)
- `README.md` (`Current release`)

The pre-commit hook checks these values.

## Git hook

Enable the tracked hook once per checkout:

```sh
scripts/install-hooks.sh
```

The hook enforces:

- no private paths, hostnames, credentials, or internal identifiers in staged content;
- version consistency across the release surface;
- a staged README update when code changes are staged;
- at least one staged documentation update when code changes are staged;
- required new-user README sections and documentation links;
- documentation coverage for `pass_ack`, blue mentions, and gray tool-call styling.

Do not use `--no-verify` to bypass a violation you introduced. Fix the flagged file
and stage the documentation update.

## Release checklist

1. Update code and tests.
2. Update README and docs.
3. Bump the version in all release surfaces.
4. Run the test battery.
5. Commit; the pre-commit hook must pass.
6. Push to GitHub.
