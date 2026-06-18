#!/usr/bin/env bash
# Notarize + staple the Developer-ID-signed cocore.app.
#
# Prereqs:
#   * cocore.app already built + Developer-ID-signed with hardened
#     runtime (scripts/build-mac-app.sh does this when a Developer ID
#     identity is present).
#   * A notarytool keychain profile, created once with:
#       xcrun notarytool store-credentials "cocore-notary" \
#         --apple-id <you@email> --team-id 4L45P7CP9M --password <app-specific-pw>
#     (or the App Store Connect API-key form: --key/--key-id/--issuer)
#
# Usage:
#   COCORE_NOTARY_PROFILE=cocore-notary ./scripts/notarize-mac-app.sh
#   ./scripts/notarize-mac-app.sh cocore-notary [path/to/cocore.app]

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-${COCORE_NOTARY_PROFILE:-}}"
APP="${2:-$REPO_ROOT/provider-shell/build/cocore.app}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\033[31m  error:\033[0m %s\n' "$*" >&2; exit 1; }

[[ -n "$PROFILE" ]] || die "no notarytool profile. Pass one or set COCORE_NOTARY_PROFILE (see header)."
[[ -d "$APP" ]] || die "app not found at $APP (run scripts/build-mac-app.sh first)"

bold "==> preflight: confirm Developer ID signature + hardened runtime"
codesign --verify --strict --verbose=2 "$APP" 2>&1 | sed 's/^/  /' || die "app is not validly signed"
# Capture once into a variable rather than piping codesign into grep:
# `codesign -dvv | grep -q` is fragile under `set -o pipefail` (grep -q
# closes the pipe early; depending on buffering codesign can exit on
# SIGPIPE, failing the pipeline even when the pattern matched).
DESC="$(codesign -dvv "$APP" 2>&1 || true)"
case "$DESC" in
  *"flags="*"runtime"*) ;;
  *) printf '%s\n' "$DESC" | sed 's/^/  /'; die "app is not hardened-runtime signed; rebuild with a Developer ID identity" ;;
esac
case "$DESC" in
  *"Authority=Developer ID Application"*) ;;
  *) die "app is ad-hoc signed, not Developer ID; rebuild with COCORE_SIGN_ID set" ;;
esac

bold "==> zip for submission"
ZIP="$(dirname "$APP")/$(basename "$APP" .app).zip"
rm -f "$ZIP"
/usr/bin/ditto -c -k --keepParent "$APP" "$ZIP"
note "zip: $ZIP"

bold "==> notarytool submit (waits for Apple)"
xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait \
  || die "notarization failed — inspect with: xcrun notarytool log <submission-id> --keychain-profile $PROFILE"

bold "==> staple"
xcrun stapler staple "$APP" || die "stapling failed"

bold "==> verify (should read: accepted, source=Notarized Developer ID)"
spctl -a -vvv -t exec "$APP" 2>&1 | sed 's/^/  /' || true
codesign --test-requirement="=notarized" --verify "$APP" 2>/dev/null \
  && note "notarized ✓" || note "(spctl output above is authoritative)"

bold "==> done"
note "stapled app: $APP"
note "re-zip for distribution if you zipped before stapling: ditto -c -k --keepParent '$APP' '$ZIP'"
