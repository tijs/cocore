"""P-256 ECDSA verification (mirror of packages/sdk/src/p256.ts).

Signatures are DER-encoded (Apple CryptoKit / the `p256` Rust crate wire format)
and verified with a SHA-256 prehash, over canonical bytes. Public keys are the
raw 64-byte X||Y point, base64 — the encoding the attestation publishes.
"""

from __future__ import annotations

import base64
from typing import Any, Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed

from .canonical import canonical_bytes


def verify_p256(public_key_b64: str, signature_der_b64: str, message: bytes) -> bool:
    """Verify a DER ECDSA-P256 signature over ``message`` (SHA-256 prehash)."""
    pub_raw = base64.b64decode(public_key_b64)
    if len(pub_raw) != 64:
        return False
    try:
        pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), b"\x04" + pub_raw)
        sig = base64.b64decode(signature_der_b64)
        pub.verify(sig, message, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError):
        return False


def verify_attestation_signature(attestation: Mapping[str, Any], public_key_b64: str) -> bool:
    """Verify an attestation's ``selfSignature`` against its own ``publicKey``.

    Authenticates every posture field (cdHash, getTaskAllow, encryptionPubKey,
    …). Strips ``selfSignature`` and ``$type``, canonicalizes the rest.
    """
    sig = attestation.get("selfSignature")
    if not sig:
        return False
    body = {k: v for k, v in attestation.items() if k not in ("selfSignature", "$type")}
    return verify_p256(public_key_b64, sig, canonical_bytes(body))


def verify_receipt_signature(receipt: Mapping[str, Any], attestation_public_key_b64: str) -> bool:
    """Verify a receipt's ``enclaveSignature`` against an attestation publicKey."""
    sig = receipt.get("enclaveSignature")
    if not sig:
        return False
    body = {k: v for k, v in receipt.items() if k not in ("enclaveSignature", "$type")}
    return verify_p256(attestation_public_key_b64, sig, canonical_bytes(body))
