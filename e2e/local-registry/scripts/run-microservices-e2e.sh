#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
LAB_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(CDPATH= cd -- "$LAB_DIR/../.." && pwd)"
COMPOSE_FILE="$LAB_DIR/docker-compose.microservices.yml"
COMPOSE_PROJECT="proxy-gateway-micro-e2e"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down -v || true
  exit "$status"
}

trap cleanup EXIT INT TERM

"$SCRIPT_DIR/reset-registry.sh"
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d verdaccio
"$SCRIPT_DIR/publish-local-gateway.sh" "$PROJECT_DIR"
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d micro-provider micro-gateway
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e"
