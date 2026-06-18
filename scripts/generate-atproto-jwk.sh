#!/usr/bin/env bash
# Generate a fresh ES256 (P-256) private JWK for the cocore console's
# ATProto OAuth client. Prints a single-line JSON object on stdout.
#
# Usage:
#   ./scripts/generate-atproto-jwk.sh
#
# Pipe directly into Railway:
#   railway variables --service console \
#     --set "ATPROTO_PRIVATE_KEY_JWK=$(./scripts/generate-atproto-jwk.sh)"
#
# The console reads ATPROTO_PRIVATE_KEY_JWK at boot
# (see packages/console/src/integrations/auth/atproto.server.ts) and
# uses the key to sign DPoP tokens for the ATProto OAuth flow. The
# matching public JWK is auto-derived and published at
# /api/auth/atproto/metadata.json — you do NOT need to copy the public
# half anywhere.
#
# Treat the output as a SECRET. Never commit it. Never echo it back
# from a logged shell. Only set it as a secret env var on the host.

set -euo pipefail

command -v openssl >/dev/null 2>&1 || { echo "openssl not found" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 not found" >&2; exit 1; }

key_file="$(mktemp -t atproto-jwk.XXXXXX.pem)"
trap 'rm -f "$key_file"' EXIT

openssl ecparam -name prime256v1 -genkey -noout -out "$key_file"

python3 - "$key_file" <<'PYEOF'
import base64, json, re, subprocess, sys

key_path = sys.argv[1]
out = subprocess.check_output(
    ["openssl", "ec", "-in", key_path, "-text", "-noout"],
    stderr=subprocess.DEVNULL,
).decode()

def grab(label):
    m = re.search(rf"{label}:\s*\n((?:\s*[0-9a-f:]+\s*\n?)+)", out)
    if not m:
        sys.exit(f"openssl output missing {label}")
    return bytes.fromhex(m.group(1).replace(":", "").replace(" ", "").replace("\n", ""))

priv = grab("priv")[-32:]
pub = grab("pub")
if pub[0] != 0x04:
    sys.exit("expected uncompressed EC point (0x04 prefix)")
x, y = pub[1:33], pub[33:65]

b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()

print(json.dumps({
    "kty": "EC",
    "crv": "P-256",
    "x":   b64u(x),
    "y":   b64u(y),
    "d":   b64u(priv),
    "alg": "ES256",
    "use": "sig",
    "kid": "main",
}, separators=(",", ":")))
PYEOF
