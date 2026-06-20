#!/usr/bin/env sh
set -eu

LAB_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
docker compose -f "$LAB_DIR/docker-compose.yml" down -v
