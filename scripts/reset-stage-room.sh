#!/usr/bin/env bash
# Clear Hermes Stage's locally persisted room transcript.
# Usage: ./scripts/reset-stage-room.sh
set -euo pipefail

HOMEDIR="${HERMES_STAGE_HOME:-${HERMES_HOME:-$HOME/.hermes}}"
STATE="${HERMES_STAGE_ROOM_STATE:-$HOMEDIR/state/hermes-stage-room.json}"

if [ -e "$STATE" ]; then
  echo "Cleared Stage room state: $STATE"
else
  echo "No Stage room state at $STATE"
fi
rm -f "$STATE" "$STATE.tmp"
