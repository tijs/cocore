"""Sorted-key canonical JSON serialization.

MUST produce byte-identical output to provider/src/canonical.rs and
packages/sdk/src/canonical.ts — the provider signs the canonical bytes with its
Secure Enclave key and this module re-canonicalizes to verify. Any divergence
breaks every signature.

Rules (matched across all three implementations): UTF-8, object keys sorted
lexicographically, no insignificant whitespace, minimal string escapes, integers
only (floats raise), booleans true/false, null allowed, bytes are base64 strings
before they reach this layer.
"""

from __future__ import annotations

from typing import Any


class CanonicalError(ValueError):
    pass


def canonicalize(value: Any) -> str:
    parts: list[str] = []
    _emit(parts, value)
    return "".join(parts)


def canonical_bytes(value: Any) -> bytes:
    return canonicalize(value).encode("utf-8")


def _emit(out: list[str], v: Any) -> None:
    if v is None:
        out.append("null")
    elif v is True:
        out.append("true")
    elif v is False:
        out.append("false")
    elif isinstance(v, int):  # note: bool handled above (bool is a subclass)
        out.append(str(v))
    elif isinstance(v, float):
        raise CanonicalError("floating-point numbers are not allowed in signed records")
    elif isinstance(v, str):
        _emit_string(out, v)
    elif isinstance(v, (list, tuple)):
        out.append("[")
        for i, item in enumerate(v):
            if i > 0:
                out.append(",")
            _emit(out, item)
        out.append("]")
    elif isinstance(v, dict):
        out.append("{")
        for i, key in enumerate(sorted(v.keys())):
            if i > 0:
                out.append(",")
            _emit_string(out, key)
            out.append(":")
            _emit(out, v[key])
        out.append("}")
    else:
        raise CanonicalError(f"unsupported value type: {type(v).__name__}")


_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _emit_string(out: list[str], s: str) -> None:
    out.append('"')
    for ch in s:
        esc = _ESCAPES.get(ch)
        if esc is not None:
            out.append(esc)
        elif ord(ch) < 0x20:
            out.append("\\u" + format(ord(ch), "04x"))
        else:
            out.append(ch)
    out.append('"')
