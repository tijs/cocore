#!/usr/bin/env bash
# Run the cocore provider agent against the local dev stack.
#
# Prereqs:
#   * `mise dev` (or services + advisor + console) running
#   * `make mac-install` (or a release binary on PATH)
#   * `cocore agent pair --console http://localhost:3000` completed once
#
# Usage:
#   ./scripts/dev-provider.sh              # stub engine (fast, no GPU model)
#   COCORE_INFERENCE_MODELS=mlx-community/Qwen2.5-3B-Instruct-4bit ./scripts/dev-provider.sh
#
# First time with a real model, bootstrap the Python venv:
#   ./scripts/bootstrap-python-venv.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COCORE_CONSOLE="${COCORE_CONSOLE:-http://localhost:3000}"
export COCORE_ADVISOR="${COCORE_ADVISOR:-ws://localhost:8082/v1/agent}"
export COCORE_LOG="${COCORE_LOG:-info}"

BIN="${COCORE_BIN:-$HOME/.local/bin/cocore}"
if [[ ! -x "$BIN" ]]; then
  BIN="$ROOT/provider/target/release/cocore"
fi
if [[ ! -x "$BIN" ]]; then
  echo "cocore binary not found. Run: make mac-install" >&2
  exit 1
fi

if [[ ! -f "$HOME/.cocore/session.json" ]]; then
  echo "Not paired yet. In another terminal, with the console running:" >&2
  echo "  $BIN agent pair --console $COCORE_CONSOLE" >&2
  exit 1
fi

if [[ -n "${COCORE_INFERENCE_MODELS:-}" ]] && [[ ! -x "${COCORE_PYTHON_VENV:-$HOME/.cocore/python}/bin/python" ]]; then
  echo "COCORE_INFERENCE_MODELS is set but the Python venv is missing." >&2
  echo "Run: ./scripts/bootstrap-python-venv.sh" >&2
  exit 1
fi

echo "provider agent → console $COCORE_CONSOLE · advisor $COCORE_ADVISOR"
if [[ -n "${COCORE_INFERENCE_MODELS:-}" ]]; then
  echo "models: $COCORE_INFERENCE_MODELS"
else
  echo "models: (stub only — set COCORE_INFERENCE_MODELS for real inference)"
fi

exec "$BIN" agent serve --advisor "$COCORE_ADVISOR"
