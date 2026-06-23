#!/usr/bin/env bash
# WS-A: register a secure-release cdHash into the advisor's known-good set.
#
# THE HARD RULE: the cdHash changes on EVERY release (it commits to the exact
# signed bytes). The advisor only advertises a provider as confidential-capable
# when its measured cdHash is in COCORE_KNOWN_GOOD_CDHASHES
# (infra/advisor/src/known-good.ts). If you ship a secure/native release and do
# NOT append its new cdHash here, every confidential request silently downgrades
# to best-effort — no error, just a quiet loss of the confidential guarantee.
# Run this WITH every secure release.
#
# This helper is intentionally a DOCUMENTED MANUAL STEP for now: it does not
# touch Railway on its own (a bad COCORE_KNOWN_GOOD_CDHASHES value would
# de-bless the whole fleet). It computes the exact new env value and prints the
# precise commands the operator runs to apply it.
#
# Usage:
#   ./scripts/register-known-good.sh <cdhash-hex>
#   ./scripts/register-known-good.sh path/to/cdhash.json
#   ./scripts/register-known-good.sh < cdhash.json        # piped JSON
#
# Optional env:
#   COCORE_CURRENT_KNOWN_GOOD  the CURRENT value of COCORE_KNOWN_GOOD_CDHASHES
#                              (so the printed new value is current + the new
#                              hash, deduped). If unset, the snippet shows how
#                              to read it from Railway first.

set -euo pipefail

die() { printf 'register-known-good: error: %s\n' "$*" >&2; exit 1; }

arg="${1:-}"

# --- resolve the cdHash from: a hex arg, a cdhash.json path, or stdin -------
raw=""
if [[ -n "$arg" && -f "$arg" ]]; then
  raw="$(cat "$arg")"
elif [[ -n "$arg" ]]; then
  raw="$arg"
elif [[ ! -t 0 ]]; then
  raw="$(cat)"            # JSON piped on stdin
else
  die "usage: register-known-good.sh <cdhash-hex | cdhash.json>"
fi

# If it looks like JSON, pull .cdHash out of it (no jq dependency — grep/sed).
if printf '%s' "$raw" | grep -q '"cdHash"'; then
  cd_hash="$(printf '%s' "$raw" | sed -n 's/.*"cdHash"[[:space:]]*:[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' | head -1)"
else
  # Treat the whole input as the hex hash (strip whitespace).
  cd_hash="$(printf '%s' "$raw" | tr -d '[:space:]')"
fi

cd_hash="$(printf '%s' "$cd_hash" | tr '[:upper:]' '[:lower:]')"
[[ -n "$cd_hash" ]] || die "could not find a cdHash in the input"
# A cdHash is the 20-byte CodeDirectory hash → 40 lowercase hex chars.
case "$cd_hash" in
  *[!0-9a-f]*) die "cdHash has non-hex characters: $cd_hash" ;;
esac
[[ "${#cd_hash}" -eq 40 ]] \
  || die "cdHash is ${#cd_hash} hex chars; expected 40 (20-byte CodeDirectory hash). Got: $cd_hash"

# --- compute the new env value (current set + new hash, space-joined, deduped) ---
current="${COCORE_CURRENT_KNOWN_GOOD:-}"
new_value="$cd_hash"
already="no"
if [[ -n "$current" ]]; then
  # Split current on whitespace/commas, lowercase, dedupe, append the new one.
  declare -a seen=()
  add() {
    local h
    h="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    [[ -z "$h" ]] && return 0
    for e in ${seen[@]+"${seen[@]}"}; do [[ "$e" == "$h" ]] && return 0; done
    seen+=("$h")
  }
  # shellcheck disable=SC2086
  for tok in $(printf '%s' "$current" | tr ',' ' '); do add "$tok"; done
  for e in ${seen[@]+"${seen[@]}"}; do [[ "$e" == "$cd_hash" ]] && already="yes"; done
  add "$cd_hash"
  new_value="${seen[*]}"   # space-joined; known-good.ts splits on /[\s,]+/
fi

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

bold "==> known-good registration for secure release"
note "new cdHash:        $cd_hash"
if [[ "$already" == "yes" ]]; then
  note "status:            ALREADY present in COCORE_CURRENT_KNOWN_GOOD (no-op)"
fi
printf '\n'

if [[ -z "$current" ]]; then
  bold "1) Read the CURRENT advisor value first (so you APPEND, never replace):"
  cat <<'EOS'
   # Via the Railway CLI (project co/core, service advisor):
   railway variables --service advisor | grep COCORE_KNOWN_GOOD_CDHASHES
   # then re-run this script with that value so it appends + dedupes:
   COCORE_CURRENT_KNOWN_GOOD="<that value>" ./scripts/register-known-good.sh <cdhash-or-json>
EOS
  printf '\n'
  bold "2) Set the appended value (advisor reads COCORE_KNOWN_GOOD_CDHASHES):"
  note   "If the var is currently EMPTY, the full value is just the new hash:"
  printf '\n'
  printf '   railway variables --service advisor --set "COCORE_KNOWN_GOOD_CDHASHES=%s"\n\n' "$cd_hash"
else
  bold "1) Set the appended value (current set + this release, space-separated):"
  printf '\n'
  printf '   railway variables --service advisor --set "COCORE_KNOWN_GOOD_CDHASHES=%s"\n\n' "$new_value"
fi

bold "3) Confirm the advisor picked it up after redeploy:"
cat <<'EOS'
   railway variables --service advisor | grep COCORE_KNOWN_GOOD_CDHASHES
   # The advisor logs its known-good set size on boot (KnownGoodSet.fromEnv).
   # size 0 == NOTHING is confidential-eligible (fail-closed).
EOS
printf '\n'
note "Reminder: the advisor is an ACCELERATOR, not the authority. A confidential"
note "requester re-verifies the provider's signed attestation against its OWN"
note "known-good set at seal time — so publish this cdHash to requesters too"
note "(cdhash.json release asset). See docs/secure-release.md."
