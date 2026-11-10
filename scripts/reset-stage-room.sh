#!/usr/bin/env bash
# Clear Hermes Stage's locally persisted room transcript.
# Usage: ./scripts/reset-stage-room.sh
set -euo pipefail

STATE="${HERMES_STAGE_ROOM_STATE:-${HERMES_HOME:-$HOME/.hermes}/state/hermes-stage-room.json}"

if [ -e "$STATE" ]; then
  rm -f "$STATE" "$STATE.tmp"
  echo "Cleared Stage room state: $STATE"
else
  echo "No Stage room state at $STATE"
fi
