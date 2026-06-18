// Sorted-key canonical JSON serialization.
//
// This MUST produce byte-identical output to provider/src/canonical.rs.
// The provider signs `to_canonical_bytes(record)` with its Secure Enclave;
// the AppView verifies that signature by re-canonicalizing here and
// recomputing. Any divergence breaks every receipt.
//
// Rules (matched in canonical.rs):
//   * UTF-8 output, no BOM.
//   * Object keys sorted lexicographically (UTF-16 code unit order, which
//     matches Rust's String <-> String comparison for the BMP and is
//     identical for ASCII keys — every key in our lexicons is ASCII).
//   * No insignificant whitespace.
//   * Strings escaped with the smallest legal form: \", \\, \b, \f, \n,
//     \r, \t, and \u00XX (lowercase hex) for control characters.
//   * Numbers: integers only. Floats throw. Lexicon-defined numeric
//     fields are integer; we never sign over a float.
//   * Booleans: true / false.
//   * null is allowed.
//   * Bytes (signatures etc.) are base64-encoded by callers BEFORE
//     entering this serializer; this layer treats them as strings.

export class CanonicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalError";
  }
}

export function canonicalize(value: unknown): string {
  const parts: string[] = [];
  emit(parts, value);
  return parts.join("");
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

function emit(out: string[], v: unknown): void {
  if (v === null) {
    out.push("null");
    return;
  }
  if (v === true) {
    out.push("true");
    return;
  }
  if (v === false) {
    out.push("false");
    return;
  }
  if (typeof v === "number") {
    if (!Number.isInteger(v)) {
      throw new CanonicalError("floating-point numbers are not allowed in signed records");
    }
    out.push(String(v));
    return;
  }
  if (typeof v === "bigint") {
    out.push(v.toString());
    return;
  }
  if (typeof v === "string") {
    emitString(out, v);
    return;
  }
  if (Array.isArray(v)) {
    out.push("[");
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(",");
      emit(out, v[i]);
    }
    out.push("]");
    return;
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    out.push("{");
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) out.push(",");
      emitString(out, keys[i]!);
      out.push(":");
      emit(out, obj[keys[i]!]);
    }
    out.push("}");
    return;
  }
  throw new CanonicalError(`unsupported value type: ${typeof v}`);
}

function emitString(out: string[], s: string): void {
  out.push('"');
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"') out.push('\\"');
    else if (ch === "\\") out.push("\\\\");
    else if (ch === "\b") out.push("\\b");
    else if (ch === "\f") out.push("\\f");
    else if (ch === "\n") out.push("\\n");
    else if (ch === "\r") out.push("\\r");
    else if (ch === "\t") out.push("\\t");
    else if (cp < 0x20) out.push("\\u" + cp.toString(16).padStart(4, "0"));
    else out.push(ch);
  }
  out.push('"');
}
