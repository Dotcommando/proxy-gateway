#!/usr/bin/env sh
set -eu

LAB_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
docker compose -f "$LAB_DIR/docker-compose.yml" down -v

if [ -f "$LAB_DIR/docker-compose.microservices.yml" ]; then
  docker compose -p proxy-gateway-micro-e2e -f "$LAB_DIR/docker-compose.microservices.yml" down -v
fi
