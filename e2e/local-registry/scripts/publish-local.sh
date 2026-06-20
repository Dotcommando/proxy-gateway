#!/usr/bin/env sh
set -eu

LAB_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PROJECT_DIR="${1:-$(CDPATH= cd -- "$LAB_DIR/.." && pwd)}"
NPMRC_PATH="$PROJECT_DIR/.npmrc.local-registry"

cat > "$NPMRC_PATH" <<'NPMRC'
@echospecter:registry=http://localhost:4873/
//localhost:4873/:_authToken=local-dev-token
NPMRC

(
  cd "$PROJECT_DIR"
  NPM_CONFIG_USERCONFIG="$NPMRC_PATH" npm publish --registry http://localhost:4873 --access public --tag local
)
