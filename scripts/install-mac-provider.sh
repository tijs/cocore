#!/usr/bin/env bash
# Install cocore on macOS.
#
# Sets up a Mac (Mini or otherwise) as a cocore provider:
#   1. Verifies macOS environment + tooling
#   2. Builds the cocore release binary
#   3. Installs the binary to $COCORE_PREFIX/bin/cocore
#   4. Pairs the machine with an ATProto identity via the cocore console
#   5. Installs a launchd LaunchAgent that runs the agent at user login
#
# Usage:
#   ./scripts/install-mac-provider.sh                 # interactive
#   COCORE_CONSOLE=http://localhost:3000 ./scripts/install-mac-provider.sh
#
# Env knobs (all optional):
#   COCORE_CONSOLE        URL of the cocore console (default: https://console.cocore.dev)
#   COCORE_ADVISOR        wss URL of the advisor   (default: wss://advisor.cocore.dev/v1/agent)
#   COCORE_PREFIX         install prefix           (default: $HOME/.local)
#   COCORE_LOG            log filter               (default: info)
#   COCORE_INSTALL_RUST   1 to auto-install rustup if missing (default: 0)
#   COCORE_SKIP_PAIR      1 to skip the device-pair step      (default: 0)
#   COCORE_SKIP_SERVICE   1 to skip the LaunchAgent install   (default: 0)
#
# This script is idempotent: re-running upgrades the binary and the
# LaunchAgent without re-pairing the machine.

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly LABEL="dev.cocore.provider"
readonly DEFAULT_CONSOLE="https://console.cocore.dev"
readonly DEFAULT_ADVISOR="wss://advisor.cocore.dev/v1/agent"

COCORE_CONSOLE="${COCORE_CONSOLE:-$DEFAULT_CONSOLE}"
COCORE_ADVISOR="${COCORE_ADVISOR:-$DEFAULT_ADVISOR}"
COCORE_PREFIX="${COCORE_PREFIX:-$HOME/.local}"
COCORE_LOG="${COCORE_LOG:-info}"
COCORE_INSTALL_RUST="${COCORE_INSTALL_RUST:-0}"
COCORE_SKIP_PAIR="${COCORE_SKIP_PAIR:-0}"
COCORE_SKIP_SERVICE="${COCORE_SKIP_SERVICE:-0}"
# Empty by default. The from-source installer is for developers,
# who can opt into real inference by exporting these before running:
#   COCORE_INFERENCE_MODELS=mlx-community/Qwen2.5-0.5B-Instruct-4bit \
#   COCORE_PYTHON_VENV=$HOME/.cocore/python \
#     ./scripts/install-mac-provider.sh
# Or just point them at scripts/bootstrap-python-venv.sh first.
# `COCORE_INFERENCE_MODELS` is comma-separated; the legacy singular
# `COCORE_INFERENCE_MODEL` is honored as a fallback.
COCORE_INFERENCE_MODELS="${COCORE_INFERENCE_MODELS:-${COCORE_INFERENCE_MODEL:-}}"
COCORE_PYTHON_VENV="${COCORE_PYTHON_VENV:-}"

readonly INSTALL_BIN_DIR="$COCORE_PREFIX/bin"
readonly INSTALL_BIN="$INSTALL_BIN_DIR/cocore"
readonly STATE_DIR="$HOME/.cocore"
readonly LOG_DIR="$STATE_DIR/logs"
readonly LAUNCHAGENT_DIR="$HOME/Library/LaunchAgents"
readonly LAUNCHAGENT_PLIST="$LAUNCHAGENT_DIR/$LABEL.plist"
readonly PLIST_TEMPLATE="$REPO_ROOT/scripts/dev.cocore.provider.plist.template"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  warn:\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31m  error:\033[0m %s\n' "$*" >&2; }

die() {
  err "$*"
  exit 1
}

# Print a clearly-formatted "missing dependency" block and exit 1.
# Usage: missing_dep <name> <one-line description> <fix line> [<fix line>...]
missing_dep() {
  local name="$1"; shift
  local desc="$1"; shift
  printf '\n' >&2
  printf '\033[31m==> missing required dependency: %s\033[0m\n' "$name" >&2
  printf '    %s\n' "$desc" >&2
  printf '\n' >&2
  printf '    To fix:\n' >&2
  local line
  for line in "$@"; do
    printf '      %s\n' "$line" >&2
  done
  printf '\n' >&2
  exit 1
}

phase() {
  printf '\n'
  bold "==> $*"
}

# --- preflight ---------------------------------------------------------

preflight() {
  phase "preflight"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "this installer targets macOS; detected $(uname -s)"
  fi
  local arch
  arch="$(uname -m)"
  case "$arch" in
    arm64)  note "arch: arm64 (Apple Silicon)" ;;
    x86_64) warn "arch: x86_64 — Secure Enclave attestation requires Apple Silicon; will run as self-attested" ;;
    *)      die "unsupported arch: $arch" ;;
  esac

  if ! xcode-select -p >/dev/null 2>&1; then
    missing_dep "Xcode Command Line Tools" \
      "needed to compile the cocore Rust binary." \
      "xcode-select --install" \
      "" \
      "Then re-run this installer."
  fi
  note "xcode-select: $(xcode-select -p)"

  if [[ ! -f "$REPO_ROOT/provider/Cargo.toml" ]]; then
    missing_dep "cocore checkout" \
      "this installer must be run from a clone of the cocore repo (provider/Cargo.toml not found at $REPO_ROOT)." \
      "git clone https://github.com/DGaffney/cocore.git && cd cocore" \
      "" \
      "If you only have the prebuilt tarball, run install.sh from inside it instead."
  fi
  note "repo:  $REPO_ROOT"
  note "console: $COCORE_CONSOLE"
  note "advisor: $COCORE_ADVISOR"
  note "prefix:  $COCORE_PREFIX"
}

# --- rust toolchain ----------------------------------------------------

ensure_rust() {
  phase "rust toolchain"
  # If a previous run installed rustup but the user's shell hasn't sourced
  # ~/.cargo/env yet, pick it up automatically before declaring cargo missing.
  if ! command -v cargo >/dev/null 2>&1 && [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi
  if command -v cargo >/dev/null 2>&1; then
    note "cargo: $(cargo --version)"
    return
  fi
  if [[ "$COCORE_INSTALL_RUST" == "1" ]]; then
    note "installing rustup (https://sh.rustup.rs)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
    command -v cargo >/dev/null 2>&1 || die "rustup install completed but 'cargo' is still not on PATH; check ~/.cargo/env"
    note "cargo: $(cargo --version)"
    return
  fi
  missing_dep "Rust toolchain (cargo)" \
    "needed to build the cocore release binary from source." \
    "Option 1 — let this installer fetch rustup for you:" \
    "    COCORE_INSTALL_RUST=1 make mac-install" \
    "" \
    "Option 2 — install Rust yourself and re-run:" \
    "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" \
    "    source \"\$HOME/.cargo/env\"" \
    "    make mac-install" \
    "" \
    "Option 3 — skip building from source by using the prebuilt tarball" \
    "(see docs/install-mac.md \"Path B\")."
}

# --- build -------------------------------------------------------------

build_provider() {
  phase "build cocore (release)"
  (cd "$REPO_ROOT/provider" && cargo build --release --locked)
  local built="$REPO_ROOT/provider/target/release/cocore"
  [[ -x "$built" ]] || die "expected release binary at $built"
  note "built: $built"
}

# --- install -----------------------------------------------------------

install_binary() {
  phase "install binary"
  mkdir -p "$INSTALL_BIN_DIR" "$STATE_DIR" "$LOG_DIR"
  chmod 700 "$STATE_DIR"
  install -m 755 "$REPO_ROOT/provider/target/release/cocore" "$INSTALL_BIN"
  note "installed: $INSTALL_BIN"
  case ":$PATH:" in
    *":$INSTALL_BIN_DIR:"*) ;;
    *) warn "$INSTALL_BIN_DIR is not on PATH. Add to your shell profile: export PATH=\"$INSTALL_BIN_DIR:\$PATH\"" ;;
  esac
}

# --- pair --------------------------------------------------------------

pair_machine() {
  # If stdin isn't a TTY we can't run the interactive pair prompt;
  # auto-skip so the install completes and the user runs `cocore
  # agent pair` themselves once they have a real terminal.
  if [[ ! -t 0 && "$COCORE_SKIP_PAIR" != "1" ]]; then
    warn "stdin is not a TTY (curl | sh?); auto-setting COCORE_SKIP_PAIR=1; run 'cocore agent pair' manually after this completes."
    COCORE_SKIP_PAIR=1
  fi
  if [[ "$COCORE_SKIP_PAIR" == "1" ]]; then
    phase "pair (skipped, COCORE_SKIP_PAIR=1)"
    return
  fi
  phase "pair with ATProto identity"
  if [[ -f "$STATE_DIR/session.json" ]]; then
    note "existing session at $STATE_DIR/session.json — running 'whoami'"
    "$INSTALL_BIN" agent whoami || true
    note "to re-pair, delete $STATE_DIR/session.json and re-run this installer"
    return
  fi
  note "starting device-pair flow against $COCORE_CONSOLE"
  COCORE_CONSOLE="$COCORE_CONSOLE" "$INSTALL_BIN" agent pair --console "$COCORE_CONSOLE"
}

# --- launchd -----------------------------------------------------------

install_service() {
  if [[ "$COCORE_SKIP_SERVICE" == "1" ]]; then
    phase "LaunchAgent (skipped, COCORE_SKIP_SERVICE=1)"
    return
  fi
  phase "install LaunchAgent"
  [[ -f "$PLIST_TEMPLATE" ]] || die "plist template not found at $PLIST_TEMPLATE"
  mkdir -p "$LAUNCHAGENT_DIR"

  # Substitute install-time values into the template.
  sed \
    -e "s|@@LABEL@@|$LABEL|g" \
    -e "s|@@BIN@@|$INSTALL_BIN|g" \
    -e "s|@@CONSOLE@@|$COCORE_CONSOLE|g" \
    -e "s|@@ADVISOR@@|$COCORE_ADVISOR|g" \
    -e "s|@@LOG@@|$COCORE_LOG|g" \
    -e "s|@@LOG_DIR@@|$LOG_DIR|g" \
    -e "s|@@HOME@@|$HOME|g" \
    -e "s|@@INFERENCE_MODELS@@|$COCORE_INFERENCE_MODELS|g" \
    -e "s|@@PYTHON_VENV@@|$COCORE_PYTHON_VENV|g" \
    "$PLIST_TEMPLATE" > "$LAUNCHAGENT_PLIST.tmp"
  mv "$LAUNCHAGENT_PLIST.tmp" "$LAUNCHAGENT_PLIST"
  chmod 644 "$LAUNCHAGENT_PLIST"
  note "wrote $LAUNCHAGENT_PLIST"

  # Reload (bootout if previously loaded; bootstrap fresh).
  local domain="gui/$(id -u)"
  if launchctl print "$domain/$LABEL" >/dev/null 2>&1; then
    note "previous LaunchAgent loaded; replacing"
    launchctl bootout "$domain/$LABEL" 2>/dev/null || true
  fi
  # `launchctl disable` writes a persistent per-user denylist that
  # outlives `bootout`. If a previous uninstall (or operator-side
  # debugging) left the label disabled, the next `bootstrap` fails
  # with "Bootstrap failed: 5: Input/output error". Enable
  # preemptively — it's a no-op when the label isn't on the list.
  launchctl enable "$domain/$LABEL" 2>/dev/null || true
  # bootout sometimes returns before the domain is fully ready for the
  # next bootstrap (also surfaces as I/O error 5). Retry once after a
  # short sleep; fail loudly if it still doesn't take.
  if ! launchctl bootstrap "$domain" "$LAUNCHAGENT_PLIST"; then
    warn "launchctl bootstrap failed; retrying in 2s (likely transient bootout race)"
    sleep 2
    launchctl bootstrap "$domain" "$LAUNCHAGENT_PLIST" \
      || die "launchctl bootstrap $domain failed twice; LaunchAgent NOT loaded. Check: launchctl print $domain/$LABEL"
  fi
  launchctl kickstart -k "$domain/$LABEL" || true
  note "launchctl status:"
  launchctl print "$domain/$LABEL" 2>/dev/null | grep -E '^\s+(state|last exit code|pid)' || true
}

# --- summary -----------------------------------------------------------

summary() {
  phase "done"
  note "Binary:       $INSTALL_BIN"
  note "Session:      $STATE_DIR/session.json"
  note "Logs:         $LOG_DIR/{stdout,stderr}.log"
  note "LaunchAgent:  $LAUNCHAGENT_PLIST"
  printf '\n'
  note "Useful commands:"
  note "  $INSTALL_BIN agent whoami                       # show paired identity"
  note "  tail -f $LOG_DIR/stderr.log               # follow agent logs"
  note "  launchctl print gui/$(id -u)/$LABEL       # service state"
  note "  $REPO_ROOT/scripts/uninstall-mac-provider.sh   # remove"
}

main() {
  preflight
  ensure_rust
  build_provider
  install_binary
  pair_machine
  install_service
  summary
}

main "$@"
