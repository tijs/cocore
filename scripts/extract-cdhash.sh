#!/usr/bin/env bash
# WS-A: extract the code-signing identity of a built `cocore` binary and emit
# the JSON the confidential tier trusts.
#
# This is the OFFLINE, file-based equivalent of what the agent reports about
# ITSELF at runtime:
#   * cdHash  — provider/src/codesign.rs reads it live via csops(CS_OPS_CDHASH);
#               it equals `codesign -dvvv`'s `CDHash=` (20-byte CodeDirectory
#               hash, 40 lowercase hex chars). We read that same line here.
#   * posture — hardenedRuntime (CS_RUNTIME 0x10000) + libraryValidation
#               (CS_REQUIRE_LV 0x2000), parsed from the CodeDirectory `flags=`.
#   * metallibHash / engineLibHash — provider/src/engines/native_mlx.rs hashes
#               the .metallib and libCoCoreMLX.dylib FILES with plain SHA-256
#               (64 lowercase hex chars). We `shasum -a 256` the same files.
#
# Output (stdout, one JSON object):
#   {
#     "version": "0.9.17",
#     "cdHash": "1205ca11b1c3f706109656bcf4e2c12439d843b7",
#     "teamId": "4L45P7CP9M",
#     "metallibHash": "<sha256|null>",
#     "engineLibHash": "<sha256|null>",
#     "hardenedRuntime": true,
#     "libraryValidation": true
#   }
#
# The cdHash printed here is EXACTLY the string an operator pastes into
# COCORE_KNOWN_GOOD_CDHASHES (see scripts/register-known-good.sh). It changes
# every release — register it or the confidential tier downgrades.
#
# Usage:
#   ./scripts/extract-cdhash.sh <path-to-cocore-binary> [<app-bundle-dir>]
#
#   <path-to-cocore-binary>  the signed Mach-O (e.g. cocore.app/Contents/MacOS/cocore
#                            or dist/.../bin/cocore). MUST be code-signed.
#   <app-bundle-dir>         optional; the directory to search for the native
#                            engine's libCoCoreMLX.dylib + *.metallib. Defaults
#                            to the binary's own directory (where build-mac-app.sh
#                            colocates them). For a non-native build there are
#                            no such files and both hashes report null.

set -euo pipefail

bin="${1:-}"
bundle_dir="${2:-}"

die() { printf 'extract-cdhash: error: %s\n' "$*" >&2; exit 1; }

[[ -n "$bin" ]]   || die "usage: extract-cdhash.sh <path-to-cocore-binary> [<app-bundle>]"
[[ -e "$bin" ]]   || die "binary not found: $bin"
[[ "$(uname -s)" == "Darwin" ]] || die "needs macOS codesign (detected $(uname -s))"
command -v codesign >/dev/null 2>&1 || die "codesign not on PATH"
command -v shasum   >/dev/null 2>&1 || die "shasum not on PATH"

# Where to look for the native engine artifacts: explicit arg, else next to
# the binary (build-mac-app.sh colocates them in Contents/MacOS/).
if [[ -z "$bundle_dir" ]]; then
  bundle_dir="$(cd "$(dirname "$bin")" && pwd)"
fi

# --- code-signing identity (must be signed) --------------------------------
# Capture once; piping codesign into grep under `set -o pipefail` is fragile
# (early pipe close can SIGPIPE codesign). codesign -d writes to stderr.
desc="$(codesign -d -vvv "$bin" 2>&1 || true)"
case "$desc" in
  *"code object is not signed"*|*"not signed at all"*)
    die "binary is UNSIGNED: $bin — a known-good cdHash requires a signed (Developer ID, hardened) build." ;;
esac

cd_hash="$(printf '%s\n' "$desc" | sed -n 's/^CDHash=\([0-9a-fA-F]*\).*/\1/p' | head -1 | tr '[:upper:]' '[:lower:]')"
[[ -n "$cd_hash" ]] || die "no CDHash in codesign output — binary is not signed (or codesign produced no CodeDirectory). \nFull codesign -dvvv output:\n$desc"

team_id="$(printf '%s\n' "$desc" | sed -n 's/^TeamIdentifier=\(.*\)/\1/p' | head -1)"
# codesign prints "TeamIdentifier=not set" for ad-hoc / no-team signatures.
[[ "$team_id" == "not set" || -z "$team_id" ]] && team_id=""

# Posture flags from the CodeDirectory `flags=0xNNNN(...)` line. We parse the
# hex value and test the SAME bitmasks codesign.rs uses, so the symbolic
# (runtime)/(library-validation) names don't have to be present.
flags_hex="$(printf '%s\n' "$desc" | sed -n 's/.*flags=\(0x[0-9a-fA-F]*\).*/\1/p' | head -1)"
hardened="false"
libval="false"
if [[ -n "$flags_hex" ]]; then
  flags=$(( flags_hex ))
  # CS_RUNTIME 0x10000 (hardened runtime); CS_REQUIRE_LV 0x2000 (library
  # validation). Use `if` not `(( ... )) &&` — a false `(( ))` returns exit 1,
  # which would trip `set -e`.
  if (( (flags & 0x10000) != 0 )); then hardened="true"; fi
  if (( (flags & 0x2000)  != 0 )); then libval="true"; fi
fi

# --- version ---------------------------------------------------------------
# Prefer asking the binary; fall back to "unknown" if it won't run (e.g.
# cross-arch host). Strip any leading "cocore " prefix from `--version`.
version="$({ "$bin" --version 2>/dev/null || true; } | tr -d '\n' | sed -E 's/^[^0-9]*//' | awk '{print $1}')"
[[ -n "$version" ]] || version="unknown"

# --- native engine hashes (plain SHA-256 of the files) ---------------------
sha256_file() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; }

engine_lib="$bundle_dir/libCoCoreMLX.dylib"
engine_lib_hash=""
if [[ -f "$engine_lib" ]]; then
  engine_lib_hash="$(sha256_file "$engine_lib")"
fi

# First *.metallib under the bundle dir (matches native_mlx.rs / MLXEngine's
# locate order: a single colocated metallib).
metallib="$(find "$bundle_dir" -name '*.metallib' -print -quit 2>/dev/null || true)"
metallib_hash=""
if [[ -n "$metallib" && -f "$metallib" ]]; then
  metallib_hash="$(sha256_file "$metallib")"
fi

# --- emit JSON -------------------------------------------------------------
# A null (not "") for absent hashes — matches the lexicon's optional fields
# and native_mlx.rs returning Option<String>::None.
json_str_or_null() { if [[ -n "$1" ]]; then printf '"%s"' "$1"; else printf 'null'; fi; }

printf '{\n'
printf '  "version": "%s",\n'        "$version"
printf '  "cdHash": "%s",\n'         "$cd_hash"
printf '  "teamId": %s,\n'           "$(json_str_or_null "$team_id")"
printf '  "metallibHash": %s,\n'     "$(json_str_or_null "$metallib_hash")"
printf '  "engineLibHash": %s,\n'    "$(json_str_or_null "$engine_lib_hash")"
printf '  "hardenedRuntime": %s,\n'  "$hardened"
printf '  "libraryValidation": %s\n' "$libval"
printf '}\n'
