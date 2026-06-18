//! Sorted-key canonical JSON serialization.
//!
//! Receipts and attestations carry a Secure-Enclave-bound signature over a
//! deterministic byte-serialization of the signed fields. Both the Rust
//! provider and the TypeScript AppView must produce *byte-identical* output;
//! a single sort-order or whitespace difference invalidates every receipt.
//!
//! Rules (matched in `packages/sdk/src/canonical.ts`):
//!   * UTF-8 output, no BOM.
//!   * Object keys sorted lexicographically by Unicode code point.
//!   * No insignificant whitespace anywhere.
//!   * Strings escaped per RFC 8259 with the smallest legal form: only
//!     `\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, and `\u00XX` for other
//!     control characters. Non-ASCII is emitted literally (UTF-8 bytes).
//!   * Numbers serialized as integers when whole; floats are rejected.
//!     We never sign over float values — every numeric field in the lexicon
//!     is integer.
//!   * `null` is allowed; absent fields are omitted (callers control this
//!     by choosing what to put in the `Map`).
//!   * Booleans: `true` / `false`.
//!   * Bytes (signatures, etc.) MUST be base64-encoded by the caller before
//!     being put into the map; this serializer treats them as strings.
//!
//! What this is NOT: it is not RFC 8785 JCS. JCS allows floating-point and
//! has more elaborate number rules. We deliberately use the strict subset
//! above so two implementations are easy to keep in lockstep.

use serde_json::{Map, Value};
use std::io::Write;

/// Errors produced when canonicalizing.
#[derive(Debug, thiserror::Error)]
pub enum CanonicalError {
    #[error("floating-point numbers are not allowed in signed records")]
    FloatNotAllowed,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Canonicalize a JSON value into the buffer.
pub fn write_canonical<W: Write>(w: &mut W, value: &Value) -> Result<(), CanonicalError> {
    match value {
        Value::Null => {
            w.write_all(b"null")?;
        }
        Value::Bool(true) => {
            w.write_all(b"true")?;
        }
        Value::Bool(false) => {
            w.write_all(b"false")?;
        }
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                write!(w, "{}", i)?;
            } else if let Some(u) = n.as_u64() {
                write!(w, "{}", u)?;
            } else {
                return Err(CanonicalError::FloatNotAllowed);
            }
        }
        Value::String(s) => write_string(w, s)?,
        Value::Array(items) => {
            w.write_all(b"[")?;
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    w.write_all(b",")?;
                }
                write_canonical(w, item)?;
            }
            w.write_all(b"]")?;
        }
        Value::Object(map) => write_object(w, map)?,
    }
    Ok(())
}

fn write_object<W: Write>(w: &mut W, map: &Map<String, Value>) -> Result<(), CanonicalError> {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    w.write_all(b"{")?;
    for (i, key) in keys.iter().enumerate() {
        if i > 0 {
            w.write_all(b",")?;
        }
        write_string(w, key)?;
        w.write_all(b":")?;
        write_canonical(w, &map[*key])?;
    }
    w.write_all(b"}")?;
    Ok(())
}

fn write_string<W: Write>(w: &mut W, s: &str) -> Result<(), CanonicalError> {
    w.write_all(b"\"")?;
    for c in s.chars() {
        match c {
            '"' => w.write_all(b"\\\"")?,
            '\\' => w.write_all(b"\\\\")?,
            '\u{08}' => w.write_all(b"\\b")?,
            '\u{0c}' => w.write_all(b"\\f")?,
            '\n' => w.write_all(b"\\n")?,
            '\r' => w.write_all(b"\\r")?,
            '\t' => w.write_all(b"\\t")?,
            c if (c as u32) < 0x20 => {
                write!(w, "\\u{:04x}", c as u32)?;
            }
            c => {
                let mut buf = [0u8; 4];
                let bytes = c.encode_utf8(&mut buf);
                w.write_all(bytes.as_bytes())?;
            }
        }
    }
    w.write_all(b"\"")?;
    Ok(())
}

/// Convenience: canonicalize to a `Vec<u8>`.
pub fn to_canonical_bytes(value: &Value) -> Result<Vec<u8>, CanonicalError> {
    let mut out = Vec::with_capacity(128);
    write_canonical(&mut out, value)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn canon(v: Value) -> String {
        String::from_utf8(to_canonical_bytes(&v).unwrap()).unwrap()
    }

    #[test]
    fn primitives() {
        assert_eq!(canon(json!(null)), "null");
        assert_eq!(canon(json!(true)), "true");
        assert_eq!(canon(json!(false)), "false");
        assert_eq!(canon(json!(0)), "0");
        assert_eq!(canon(json!(-1)), "-1");
        assert_eq!(canon(json!("")), "\"\"");
        assert_eq!(canon(json!("hi")), "\"hi\"");
    }

    #[test]
    fn keys_are_sorted() {
        let v = json!({"b": 1, "a": 2, "c": 3});
        assert_eq!(canon(v), r#"{"a":2,"b":1,"c":3}"#);
    }

    #[test]
    fn nested_keys_are_sorted() {
        let v = json!({"outer": {"z": 1, "a": 2}});
        assert_eq!(canon(v), r#"{"outer":{"a":2,"z":1}}"#);
    }

    #[test]
    fn arrays_preserve_order() {
        let v = json!([3, 1, 2]);
        assert_eq!(canon(v), "[3,1,2]");
    }

    #[test]
    fn no_whitespace() {
        let v = json!({"a": [1, 2, {"b": 3}]});
        assert_eq!(canon(v), r#"{"a":[1,2,{"b":3}]}"#);
    }

    #[test]
    fn string_escapes() {
        assert_eq!(canon(json!("\"")), r#""\"""#);
        assert_eq!(canon(json!("\\")), r#""\\""#);
        assert_eq!(canon(json!("\n")), r#""\n""#);
        assert_eq!(canon(json!("\t")), r#""\t""#);
        assert_eq!(canon(json!("\u{0001}")), "\"\\u0001\"");
    }

    #[test]
    fn unicode_passes_through() {
        let s = canon(json!("café"));
        assert_eq!(s.as_bytes(), b"\"caf\xc3\xa9\"");
    }

    #[test]
    fn floats_rejected() {
        let v: Value = serde_json::from_str("{\"x\": 1.5}").unwrap();
        let err = to_canonical_bytes(&v).unwrap_err();
        assert!(matches!(err, CanonicalError::FloatNotAllowed));
    }

    /// Golden bytes for a representative receipt body. The TS implementation
    /// MUST produce the same bytes for the same input.
    #[test]
    fn golden_receipt_shape() {
        let v = json!({
            "model": "llama-3.1-70b",
            "tokens": {"in": 32, "out": 128},
            "price": {"amount": 12, "currency": "USD"},
            "startedAt": "2026-05-07T12:00:00Z",
            "completedAt": "2026-05-07T12:00:03Z",
            "inputCommitment": "aa",
            "outputCommitment": "bb",
            "requester": "did:plc:requester"
        });
        let s = canon(v);
        assert_eq!(
            s,
            "{\"completedAt\":\"2026-05-07T12:00:03Z\",\
             \"inputCommitment\":\"aa\",\
             \"model\":\"llama-3.1-70b\",\
             \"outputCommitment\":\"bb\",\
             \"price\":{\"amount\":12,\"currency\":\"USD\"},\
             \"requester\":\"did:plc:requester\",\
             \"startedAt\":\"2026-05-07T12:00:00Z\",\
             \"tokens\":{\"in\":32,\"out\":128}}"
        );
    }
}
