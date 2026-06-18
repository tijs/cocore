#!/usr/bin/env bash
# Reverse scripts/install-mac-provider.sh.
#
#   - Stops + unloads the LaunchAgent
#   - Removes the LaunchAgent plist
#   - Removes the installed binary at $COCORE_PREFIX/bin/cocore
#   - Optionally removes ~/.cocore (session + logs) when COCORE_PURGE=1
#
# Usage:
#   ./scripts/uninstall-mac-provider.sh
#   COCORE_PURGE=1 ./scripts/uninstall-mac-provider.sh    # also delete ~/.cocore

set -euo pipefail

readonly LABEL="dev.cocore.provider"
readonly MENUBAR_LABEL="dev.cocore.menubar"
COCORE_PREFIX="${COCORE_PREFIX:-$HOME/.local}"
COCORE_PURGE="${COCORE_PURGE:-0}"
readonly INSTALL_BIN="$COCORE_PREFIX/bin/cocore"
readonly STATE_DIR="$HOME/.cocore"
readonly LAUNCHAGENT_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
readonly MENUBAR_PLIST="$HOME/Library/LaunchAgents/$MENUBAR_LABEL.plist"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "this script targets macOS; detected $(uname -s)" >&2
  exit 1
fi

bold "==> stop LaunchAgent"
domain="gui/$(id -u)"
if launchctl print "$domain/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$domain/$LABEL" 2>/dev/null || true
  note "stopped $LABEL"
else
  note "not loaded"
fi

bold "==> remove LaunchAgent plist"
if [[ -f "$LAUNCHAGENT_PLIST" ]]; then
  rm -f "$LAUNCHAGENT_PLIST"
  note "removed $LAUNCHAGENT_PLIST"
else
  note "$LAUNCHAGENT_PLIST not found"
fi

# Menu-bar companion (installed by default since the menubar feature
# landed; older installs simply won't have it loaded).
bold "==> stop + remove menu-bar companion"
if launchctl print "$domain/$MENUBAR_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$domain/$MENUBAR_LABEL" 2>/dev/null || true
  note "stopped $MENUBAR_LABEL"
else
  note "not loaded"
fi
if [[ -f "$MENUBAR_PLIST" ]]; then
  rm -f "$MENUBAR_PLIST"
  note "removed $MENUBAR_PLIST"
else
  note "$MENUBAR_PLIST not found"
fi

bold "==> remove installed binary"
if [[ -f "$INSTALL_BIN" ]]; then
  rm -f "$INSTALL_BIN"
  note "removed $INSTALL_BIN"
else
  note "$INSTALL_BIN not found"
fi

if [[ "$COCORE_PURGE" == "1" ]]; then
  bold "==> purge ~/.cocore (COCORE_PURGE=1)"
  if [[ -d "$STATE_DIR" ]]; then
    rm -rf "$STATE_DIR"
    note "removed $STATE_DIR"
  else
    note "$STATE_DIR not found"
  fi
else
  note "leaving session + logs at $STATE_DIR (set COCORE_PURGE=1 to delete)"
fi

bold "==> done"
