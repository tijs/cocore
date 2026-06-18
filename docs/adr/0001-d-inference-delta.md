# ADR-0001: Delta against d-inference (Darkbloom)

Status: accepted
Date: 2026-05-07

## Context

cocore intentionally rebuilds d-inference's security and crypto model with
the canonical-record role replaced by AT Protocol records. We've been
working from d-inference's high-level design but had not done a tight,
file-by-file review of its provider implementation. This ADR captures
that review and pins which divergences are deliberate vs. accidental, so
future contributors don't have to re-derive the answer.

Source under review:
- `Layr-Labs/d-inference` provider/, coordinator/internal/attestation/,
  enclave/. Read on disk at `/tmp/d-inference/` during the review.

## Verdicts at a glance

| Area | d-inference | cocore | Status |
| ---- | ---- | ---- | ---- |
| `PT_DENY_ATTACH` call (constant 31, fail-closed) | `provider/src/security.rs:31-54` | `provider/src/security.rs:31-50` | identical |
| `RLIMIT_CORE = (0, 0)` | `provider/src/security.rs:62-84` | `provider/src/security.rs:55-65` | identical |
| SIP check via `csrutil status`, fatal on absence of "enabled" / presence of "disabled" | `provider/src/security.rs:141-169` | `provider/src/security.rs:98-118` | identical |
| X25519 + NaCl SalsaBox, 24-byte nonce prefix, base64 wire keys | `provider/src/crypto.rs:50-57` | `provider/src/crypto.rs:68-79` | identical, byte-for-byte interoperable |
| Streaming SHA-256 binary self-hash | `provider/src/security.rs:393-403` | `provider/src/attestation.rs:71` | identical |
| Receipt / attestation canonicalisation | Swift `JSONEncoder.sortedKeys` + Go `BTreeMap`-based canonical | Rust sorted-key canonical (`provider/src/canonical.rs`) + TS parity (`packages/sdk/src/p256.ts`) | identical *behaviour*, distinct *implementations* (see "False alarm" below) |
| Python pre-init isolation (`PYTHONNOUSERSITE`, `PYTHONDONTWRITEBYTECODE` set **before** Python loads) | yes | **missing** | divergence — addressed in this commit |
| Challenge wire includes coordinator-supplied timestamp (signed by provider as proof of receipt) | `protocol.rs` AttestationChallenge has `nonce, timestamp` | `protocol.rs` AttestationChallenge had `nonce` only | divergence — addressed in this commit |
| Hypervisor detection (CPUID 0x40000000, hypervisor presence bit) reported in attestation | `provider/src/hypervisor.rs` | **missing** | divergence — addressed in this commit |
| Provider answers challenges with a real signature in a periodic loop | yes | stub in `advisor.rs` | divergence — partially addressed (handler wired; the periodic *send* still belongs to the federated advisor service) |
| Apple MDA cert chain parsing (Enterprise Attestation Root CA + OID 1.2.840.113635.100.8.{9,10,11,13}.\*) | `coordinator/internal/attestation/mda.go:27-142` | placeholder field on attestation, no parsing | gap — left for M2 hardware-attestation milestone |
| In-process PyO3 + `sys.path` lockdown + import-hook blocking of `socket`/`subprocess`/`ctypes`/`multiprocessing` | `provider/src/inference.rs:148-249` | `inference` cargo feature is unwired | gap — left for M2 inference milestone |
| Coordinator-side scoring `(1 − load) · decode_tps · trust_multiplier · reputation · warm_model_bonus · health_factor` | coordinator | not implemented; advisor service is federated and out of cocore's authoritative scope | deliberate — advisors are stateless w.r.t. receipts, scoring is an operator concern |
| On-chain wallet field in registration | `protocol.rs:46-48` | absent | deliberate — payouts route through `dev.cocore.compute.settlement` records and `PaymentAdapter`, not chain-by-default |
| Hardened local HTTP proxy (axum) for the backend | `provider/src/proxy.rs` | absent | deliberate — cocore providers run inference in-process; there is no backend to proxy |

## False alarm: attestation field declaration order

A first pass of the review flagged the cocore `AttestationRecord` Rust
struct as risky because its fields are declared in semantic order
(`publicKey, encryptionPubKey, chipName, …`) rather than alphabetical
(`authenticatedRootEnabled, attestedAt, binaryHash, …`). The concern was
that `serde_json::to_string` emits in declaration order and a verifier
would see non-sorted JSON.

This is **not a problem**, because:

- cocore's `attestation::build` (provider/src/attestation.rs) constructs
  an unsigned `serde_json::Value::Object` (a `Map`) and canonicalises
  it via `canonical::to_canonical_bytes` *before* signing. The signed
  bytes are sorted-key regardless of struct declaration order.
- Both verifiers — TS via `packages/sdk/src/p256.ts:verifyReceiptSignature`
  and d-inference's Go via `BTreeMap`-based canonical — re-sort keys at
  verification time. Wire order is informational only.
- The cross-language test in `packages/sdk/src/p256.test.ts` ("cross-language
  fixture: TS verifies a signature produced by Rust") empirically
  proves this works.

The struct declaration stays in semantic order for human readability.
This decision is documented at the top of `attestation.rs`.

## What we changed in this commit

1. `provider/src/security.rs`: added `isolate_python_preinit()` that
   sets `PYTHONNOUSERSITE=1` and `PYTHONDONTWRITEBYTECODE=1` *before*
   `scrub_environment()`. This is harmless when the `inference` feature
   is off and prevents a user `sitecustomize.py` from running once the
   feature flips on. Reorders `apply_all` so isolation is sequenced
   correctly:

   1. `deny_debugger`
   2. `disable_core_dumps`
   3. **`isolate_python_preinit`** ← new
   4. `scrub_environment`
   5. `require_sip_enabled` (macOS)

2. `provider/src/protocol.rs`: extended `AttestationChallenge` to carry
   `timestamp: DateTime<Utc>`. The provider's response signs over
   canonical `{nonce, timestamp, sipEnabled}` so the coordinator can
   prove the response is fresh w.r.t. its own clock, not just the
   provider's.

3. `provider/src/hypervisor.rs` (new): CPUID-based detection. On x86_64
   we read EAX=1 leaf bit 31 (the Hypervisor Present bit) and EAX
   =0x40000000 leaf for vendor identification. On AArch64 we
   conservatively return `unknown`. Reported in the attestation builder.

4. `provider/src/advisor.rs`: real challenge handler. When a frame
   parses as `AdvisorMessage::AttestationChallenge`, the agent builds
   the canonical payload, signs it with the SE-bound (or software-
   fallback) identity, and writes back `AdvisorMessage::AttestationResponse`.
   The *initiation* of challenges remains the federated advisor's job
   — cocore providers reactively prove freshness, they do not poll
   themselves.

## What we deliberately left for later

- **MDA cert chain parsing.** d-inference's `mda.go` is the
  authoritative reference implementation; we will mirror it in
  `provider/src/mda.rs` when M2 lights up Apple Managed Device
  Attestation. The lexicon already carries the cert chain bytes; only
  verification is missing.
- **PyO3 + `sys.path` lockdown + import-hook blocking.** Lives behind
  the `inference` cargo feature. The d-inference implementation in
  `inference.rs:148-249` will be ported with attribution when we wire
  the engine.
- **Status signature carrying every measurable hash** (binary, active
  model, Python runtime). cocore reports `binaryHash` today; the rest
  arrive with the inference engine.

## Decision drivers

We hew closely to d-inference on every primitive that affects the
cryptographic chain (PT_DENY_ATTACH, X25519, P-256 ECDSA, SHA-256
canonicalisation, sorted-key JSON). Where d-inference's design assumes
a centralised coordinator (scoring, billing, hardened proxy, on-chain
wallet), cocore deliberately does not, because the receipts-as-records
design relocates that authority to the AT Protocol layer. Those gaps
are not bugs.

## References

- d-inference `provider/src/security.rs` (the bootstrap + hardening
  ceremony)
- d-inference `coordinator/internal/attestation/attestation.go` (the
  Go-side canonical input + signature verification)
- d-inference `enclave/Sources/EigenInferenceEnclave/` (the Swift
  Secure Enclave bridge)
- This repo: `provider/src/security.rs`, `provider/src/canonical.rs`,
  `provider/src/attestation.rs`, `packages/sdk/src/p256.ts`,
  `packages/sdk/src/canonical.ts`
