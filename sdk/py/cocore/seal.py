"""NaCl crypto_box sealing (mirror of sealToProvider/openFromProvider).

Wire format: 24-byte random nonce prefix || crypto_box(plaintext). A confidential
requester seals to the key returned by ``verify_provider_for_seal`` (the
enclave-bound ephemeral key, or the selfSignature-authenticated
encryptionPubKey) using a FRESH per-request ephemeral sender key for forward
secrecy.
"""

from __future__ import annotations

import base64

from nacl.public import Box, PrivateKey, PublicKey
from nacl.utils import random as nacl_random


def seal_to_provider(plaintext: bytes, recipient_pub_b64: str) -> tuple[bytes, str]:
    """Seal ``plaintext`` to a recipient with a fresh ephemeral sender key.

    Returns ``(framed_ciphertext, ephemeral_sender_pub_b64)`` — the sender pub is
    what the provider needs to open it (``requester_pub_key`` on the wire).
    """
    ephemeral = PrivateKey.generate()
    recipient = PublicKey(base64.b64decode(recipient_pub_b64))
    nonce = nacl_random(Box.NONCE_SIZE)
    box = Box(ephemeral, recipient)
    body = box.encrypt(plaintext, nonce).ciphertext
    framed = nonce + body
    return framed, base64.b64encode(bytes(ephemeral.public_key)).decode("ascii")


def open_from_provider(framed: bytes, sender_pub_b64: str, my_secret: PrivateKey) -> bytes:
    """Open a ciphertext framed as nonce || body from ``sender_pub_b64``."""
    nonce, body = framed[: Box.NONCE_SIZE], framed[Box.NONCE_SIZE :]
    box = Box(my_secret, PublicKey(base64.b64decode(sender_pub_b64)))
    return box.decrypt(body, nonce)
