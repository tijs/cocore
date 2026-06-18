"""Seal a prompt with NaCl crypto_box to a provider's X25519 pubkey
and print { requesterPubKey, ciphertext (number[]), requesterPriv }
as JSON on stdout. Reads PROVIDER_PUB (base64) and PROMPT from env."""

import base64
import json
import os
import sys

try:
    from nacl.public import Box, PrivateKey, PublicKey
except ImportError:
    sys.exit("pynacl not installed — `pip install pynacl` and retry")

provider_pub = base64.b64decode(os.environ["PROVIDER_PUB"])
prompt = os.environ["PROMPT"].encode("utf-8")

priv = PrivateKey.generate()
box = Box(priv, PublicKey(provider_pub))
sealed = box.encrypt(prompt)  # nonce(24) || ciphertext+tag

print(json.dumps({
    "requesterPubKey": base64.b64encode(bytes(priv.public_key)).decode(),
    "ciphertext": list(sealed),
    "requesterPriv": base64.b64encode(bytes(priv)).decode(),
}))
