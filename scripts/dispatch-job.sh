#!/usr/bin/env bash
# Dispatch one inference job through the advisor and stream the
# response chunks back. End-to-end smoke for Phase 2.5:
# requester (this script) → advisor /jobs → provider WSS → back.
#
# Usage:
#   scripts/dispatch-job.sh "your prompt here"
#   ADVISOR=https://advisor.cocore.dev scripts/dispatch-job.sh "prompt"
#
# Pipeline:
#   1. GET /providers, pick the freshest attested provider, grab its
#      X25519 `encryptionPubKey`.
#   2. Generate an ephemeral X25519 keypair for the requester.
#   3. Seal the prompt with NaCl crypto_box (XSalsa20-Poly1305 + 24B
#      nonce prefix) — matches provider/src/crypto.rs's wire format.
#   4. POST /jobs and stream the SSE response, decrypting each chunk
#      back to plaintext.
#
# Requires: bash, curl, python3 with `pynacl` (pip install pynacl).

set -euo pipefail

PROMPT="${1:?usage: $0 <prompt>}"
ADVISOR="${ADVISOR:-https://advisor.cocore.dev}"
REQUESTER_DID="${REQUESTER_DID:-did:plc:smoke-requester}"

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

phase() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

phase "discover provider"
provider_json=$(curl -fsS "$ADVISOR/providers" | python3 "$SCRIPT_DIR/_dispatch_pick.py")
provider_did=$(printf '%s' "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['did'])")
provider_pub=$(printf '%s' "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['encryptionPubKey'])")
echo "  provider: $provider_did"
echo "  pubkey:   ${provider_pub:0:16}…"

phase "seal prompt"
session_id=$(python3 -c "import uuid; print(uuid.uuid4())")
sealed=$(PROVIDER_PUB="$provider_pub" PROMPT="$PROMPT" python3 "$SCRIPT_DIR/_dispatch_seal.py")
req_pub=$(printf '%s' "$sealed" | python3 -c "import json,sys; print(json.load(sys.stdin)['requesterPubKey'])")
ct_array=$(printf '%s' "$sealed" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['ciphertext']))")
req_priv_b64=$(printf '%s' "$sealed" | python3 -c "import json,sys; print(json.load(sys.stdin)['requesterPriv'])")
echo "  session:  $session_id"
echo "  req pub:  ${req_pub:0:16}…"

phase "POST /jobs and stream"
body=$(REQ_PUB="$req_pub" REQUESTER_DID="$REQUESTER_DID" SESSION_ID="$session_id" \
       PROVIDER_DID="$provider_did" CT_ARRAY="$ct_array" \
       python3 "$SCRIPT_DIR/_dispatch_body.py")

curl -fsS --no-buffer \
  -H "content-type: application/json" \
  -H "accept: text/event-stream" \
  -d "$body" \
  "$ADVISOR/jobs" \
  | REQ_PRIV="$req_priv_b64" PROVIDER_PUB="$provider_pub" python3 "$SCRIPT_DIR/_dispatch_decode.py"
