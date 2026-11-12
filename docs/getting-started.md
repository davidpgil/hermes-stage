# Getting Started

This page covers the shortest path from a clean checkout to a running room.

## Requirements

- Hermes Agent **v0.23.1+** with a local gateway runtime exposing the `tui` session source.
- **Node 22+** on `PATH`.
- The Stage dependencies installed once with npm.

## Install from a local checkout

```sh
cd ~/.hermes/plugins/hermes-stage/stage
npm install --no-audit --no-fund
cd ~/.hermes/plugins/hermes-stage
hermes plugins enable hermes-stage
```

## Install from the catalog

```sh
hermes plugins install hermes-stage
cd ~/.hermes/plugins/hermes-stage/stage
npm install --no-audit --no-fund
hermes plugins enable hermes-stage
```

## First run

```sh
hermes stage
```

The default profile connects first and establishes the room. The other profiles
join from `profiles.list`; the roster is not hardcoded.

To restrict or order the roster:

```sh
HERMES_STAGE_PROFILES=default,profile-a,profile-b hermes stage
```

Use `HERMES_STAGE_PROFILES=all` for the full roster.

## Clean demo state

```sh
scripts/reset-stage-room.sh
```

This removes the local room transcript so the next run starts fresh.

See also: [Using Stage](using-stage.md), [Configuration](configuration.md).
