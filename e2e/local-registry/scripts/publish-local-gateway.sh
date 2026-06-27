#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DEFAULT_GATEWAY_REPO="$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)"
GATEWAY_REPO="${GATEWAY_REPO:-${1:-$DEFAULT_GATEWAY_REPO}}"

"$SCRIPT_DIR/publish-local.sh" "$GATEWAY_REPO"
