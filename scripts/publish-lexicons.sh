#!/usr/bin/env bash
# Publish cocore's lexicon schemas as `com.atproto.lexicon.schema` records
# under the cocore.dev identity, making `dev.cocore.*` NSIDs RESOLVABLE per
# the AT Protocol lexicon-resolution spec (lexicon.garden et al.).
#
# Authority: `cocore.dev` is the handle for did:plc:5quuhkmwe2q4k3azfsgg7kdz
# (confirmed: _atproto.cocore.dev TXT → that DID). NSID authority domains
# resolve via DNS — add these TXT records (one per dev.cocore.<ns>.* tree):
#
#   _lexicon.compute.cocore.dev   TXT  did=did:plc:5quuhkmwe2q4k3azfsgg7kdz
#   _lexicon.account.cocore.dev   TXT  did=did:plc:5quuhkmwe2q4k3azfsgg7kdz
#
# Each lexicon file becomes a record at
#   at://<DID>/com.atproto.lexicon.schema/<nsid>
# whose value is the lexicon document plus `$type:
# com.atproto.lexicon.schema`. putRecord is idempotent on rkey, so re-running
# updates in place.
#
# Usage:
#   COCORE_LEXICON_APP_PASSWORD='xxxx-xxxx-xxxx-xxxx' scripts/publish-lexicons.sh
#
# Env:
#   COCORE_LEXICON_APP_PASSWORD  (required) app password for the cocore.dev account
#   COCORE_LEXICON_IDENTIFIER    (default cocore.dev)
#   COCORE_LEXICON_PDS           (default https://jellybaby.us-east.host.bsky.network)
#   COCORE_LEXICON_DRY_RUN       (set to 1 to validate + print, not publish)
set -euo pipefail

IDENTIFIER="${COCORE_LEXICON_IDENTIFIER:-cocore.dev}"
PDS="${COCORE_LEXICON_PDS:-https://jellybaby.us-east.host.bsky.network}"
REPO_DID="did:plc:5quuhkmwe2q4k3azfsgg7kdz"
COLLECTION="com.atproto.lexicon.schema"
VALIDATE_URL="https://lexicon.garden/xrpc/com.atproto.lexicon.validate"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEX_DIR="$ROOT/lexicons"
DRY="${COCORE_LEXICON_DRY_RUN:-0}"

if [[ "$DRY" != "1" && -z "${COCORE_LEXICON_APP_PASSWORD:-}" ]]; then
  echo "error: set COCORE_LEXICON_APP_PASSWORD (or COCORE_LEXICON_DRY_RUN=1)" >&2
  exit 1
fi

# 1. Authenticate (skip in dry run).
ACCESS=""
if [[ "$DRY" != "1" ]]; then
  echo "==> createSession as $IDENTIFIER on $PDS"
  SESSION="$(curl -fsS -X POST "$PDS/xrpc/com.atproto.server.createSession" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,os; print(json.dumps({"identifier":os.environ["COCORE_LEXICON_IDENTIFIER"] if os.environ.get("COCORE_LEXICON_IDENTIFIER") else "cocore.dev","password":os.environ["COCORE_LEXICON_APP_PASSWORD"]}))')")"
  ACCESS="$(echo "$SESSION" | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessJwt"])')"
  DID="$(echo "$SESSION" | python3 -c 'import sys,json; print(json.load(sys.stdin)["did"])')"
  if [[ "$DID" != "$REPO_DID" ]]; then
    echo "error: $IDENTIFIER resolved to $DID, expected $REPO_DID (wrong account?)" >&2
    exit 1
  fi
  echo "    authenticated as $DID"
fi

ok=0; fail=0
for f in $(find "$LEX_DIR" -name '*.json' | sort); do
  nsid="$(python3 -c 'import sys,json; print(json.load(open(sys.argv[1]))["id"])' "$f")"

  # Validate against lexicon.garden before publishing — never push an invalid schema.
  vresp="$(curl -fsS -X POST "$VALIDATE_URL" -H "Content-Type: application/json" \
    -d "$(python3 -c 'import sys,json; print(json.dumps({"schema":json.load(open(sys.argv[1]))}))' "$f")" 2>/dev/null || echo '{}')"
  if ! echo "$vresp" | grep -q '"valid":true'; then
    echo "✗ $nsid — INVALID, skipping: $(echo "$vresp" | head -c 200)"
    fail=$((fail+1)); continue
  fi

  if [[ "$DRY" == "1" ]]; then
    echo "✓ $nsid — valid (dry-run, not published)"
    ok=$((ok+1)); continue
  fi

  # Record = lexicon doc + $type, published at rkey = NSID.
  record="$(python3 -c 'import sys,json; d=json.load(open(sys.argv[1])); d["$type"]="com.atproto.lexicon.schema"; print(json.dumps(d))' "$f")"
  body="$(python3 -c 'import sys,json; print(json.dumps({"repo":sys.argv[1],"collection":sys.argv[2],"rkey":sys.argv[3],"record":json.loads(sys.argv[4])}))' "$REPO_DID" "$COLLECTION" "$nsid" "$record")"
  resp="$(curl -fsS -X POST "$PDS/xrpc/com.atproto.repo.putRecord" \
    -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" \
    -d "$body" 2>&1 || true)"
  if echo "$resp" | grep -q '"uri"'; then
    echo "✓ $nsid → $(echo "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin)["uri"])')"
    ok=$((ok+1))
  else
    echo "✗ $nsid — putRecord failed: $(echo "$resp" | head -c 200)"
    fail=$((fail+1))
  fi
done

echo ""
echo "==> $ok published/validated, $fail failed"
[[ "$fail" -eq 0 ]]
