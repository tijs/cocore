#!/usr/bin/env bash
# Start AppView + bridge (infra/services) then the console; tear down services when the console stops.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Optional: same env file Vite loads for the console (COCORE_APPVIEW_URL, etc.)
if [[ -f packages/console/.env ]]; then
  set -a
  # shellcheck source=/dev/null
  source "packages/console/.env"
  set +a
fi

# OAuth redirect URIs need a stable public base URL. Default for local dev when
# packages/console/.env omits CONSOLE_PUBLIC_URL (common — only AppView URL is set).
export CONSOLE_PUBLIC_URL="${CONSOLE_PUBLIC_URL:-http://localhost:3000}"

echo "Starting cocore services (AppView on :8081, bridge on :8080)…"
pnpm dev:services &
SERVICES_PID=$!

echo "Starting advisor (matchmaker on :8082)…"
pnpm --filter @cocore/advisor start &
ADVISOR_PID=$!

cleanup() {
  if kill -0 "$ADVISOR_PID" 2>/dev/null; then
    echo "Stopping advisor (pid $ADVISOR_PID)…"
    kill "$ADVISOR_PID" 2>/dev/null || true
    wait "$ADVISOR_PID" 2>/dev/null || true
  fi
  if kill -0 "$SERVICES_PID" 2>/dev/null; then
    echo "Stopping cocore services (pid $SERVICES_PID)…"
    kill "$SERVICES_PID" 2>/dev/null || true
    wait "$SERVICES_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Fail fast if the services process dies (e.g. better-sqlite3 ABI mismatch).
for _ in $(seq 1 25); do
  if ! kill -0 "$SERVICES_PID" 2>/dev/null; then
    echo "cocore services exited immediately — fix errors above (try: pnpm rebuild better-sqlite3)." >&2
    exit 1
  fi
  sleep 0.1
done

# Wait until AppView (:8081) and bridge (:8080) respond (or services died).
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVICES_PID" 2>/dev/null; then
    echo "cocore services stopped while starting." >&2
    exit 1
  fi
  if curl -sf "http://127.0.0.1:8081/xrpc/dev.cocore.appview.listProviders" >/dev/null \
    && curl -sf "http://127.0.0.1:8080/healthz" >/dev/null \
    && curl -sf "http://127.0.0.1:8082/healthz" >/dev/null; then
    break
  fi
  sleep 0.2
done

if [[ "${COCORE_SKIP_SEED:-}" != "1" ]]; then
  echo "Publishing dev seed data (provider + jobs + signed receipts) via bridge…"
  node --experimental-strip-types infra/bootstrap-dev.ts
else
  echo "Skipping dev seed (COCORE_SKIP_SEED=1)"
fi

echo "Starting console on :3000…"
cd packages/console
aube run dev
