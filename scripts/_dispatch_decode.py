"""Read SSE on stdin and decrypt each `chunk` event with REQ_PRIV +
PROVIDER_PUB (both base64). Prints decrypted plaintext per chunk."""

import base64
import json
import os
import sys

from nacl.public import Box, PrivateKey, PublicKey

priv = PrivateKey(base64.b64decode(os.environ["REQ_PRIV"]))
peer = PublicKey(base64.b64decode(os.environ["PROVIDER_PUB"]))
box = Box(priv, peer)

current_event = None
for raw in sys.stdin:
    line = raw.rstrip("\n")
    if line.startswith("event: "):
        current_event = line[len("event: "):]
    elif line.startswith("data: "):
        data = json.loads(line[len("data: "):])
        if current_event == "open":
            print(f"[advisor] dispatched to {data['providerDid']} (session {data['sessionId']})")
        elif current_event == "chunk":
            ct = data["ciphertext"]
            ct = bytes(ct) if isinstance(ct, list) else base64.b64decode(ct)
            seq = data["seq"]
            try:
                pt = box.decrypt(ct)
                print(f"[chunk seq={seq}]")
                print(pt.decode("utf-8", errors="replace").rstrip())
            except Exception as e:
                print(f"[chunk seq={seq}] decrypt failed: {e}", file=sys.stderr)
        elif current_event == "complete":
            receipt = data["receiptUri"] or "(none)"
            print(
                f"[complete] tokensIn={data['tokensIn']} "
                f"tokensOut={data['tokensOut']} receipt={receipt}"
            )
        elif current_event == "error":
            print(f"[error] {data['reason']}", file=sys.stderr)
            sys.exit(1)
    elif line == "":
        current_event = None
