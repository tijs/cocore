# Swift companion binary for Apple Managed Device Attestation

Status: contract specification (binary not yet built)
Date: 2026-05-13

## What this is

A short, separately-distributed Swift / Objective-C binary
(`cocore-mda-attest`) that drives Apple's attestation framework and
emits a PEM-formatted certificate chain on stdout. The Rust agent
shells out to it at boot and includes the chain in the
`dev.cocore.compute.attestation` record it publishes to its PDS.
The AppView's verifier walks the chain to Apple's embedded
Enterprise Attestation Root CA and, on success, promotes any
receipt strong-refing the attestation to `trustLevel:
hardware-attested`.

## Why this is a separate binary

Apple's attestation APIs (`DCAppAttestService`, the ACME
`device-attest-01` path used by Managed Device Attestation) are
only callable from a code-signed app that carries the right
entitlement and is enrolled in either the Apple Developer Program
(App Attest) or an MDM enrollment (MDA). The Rust agent itself is
distributed as an unsigned static binary and cannot satisfy that
constraint. A small Swift companion is the cheapest way to keep
the agent unrestricted while still enabling hardware-attested
posture for operators who have the right setup.

## Runtime contract

The Rust agent ([`provider/src/mda_loader.rs`](../provider/src/mda_loader.rs))
acquires the cert chain via one of two paths, in order:

1. **`COCORE_MDA_CERT_CHAIN_PATH`** — path to a PEM file on disk.
   Operator-managed flow: an MDM tool, a one-shot `security
   cms` invocation, or a manual export drops the chain at this
   path. The Rust agent reads it verbatim at every attestation
   refresh.

2. **`COCORE_MDA_ATTEST_BINARY`** — path to the Swift companion
   executable. The Rust agent invokes it with **no arguments**,
   pipes its stdout, and parses any `-----BEGIN CERTIFICATE-----`
   blocks it contains.

The binary must:

| Aspect | Requirement |
|---|---|
| Invocation | `path/to/cocore-mda-attest` with no args |
| stdin | Closed (the Rust side passes `Stdio::null()`) |
| stdout | One or more PEM-formatted `CERTIFICATE` blocks, leaf first, signed up to Apple's Enterprise Attestation Root CA (or App Attest root, when that path lands) |
| stderr | Anything — captured but never logged. Errors should also be reflected in the exit code. The Rust side deliberately avoids logging stderr because Apple's framework can emit device-identifying material there (UDID, serial number) and we don't want that ending up in the agent's tracing log |
| Exit code | 0 on success; any non-zero is treated as "no chain available" and the agent falls back to a self-attested posture |
| Wall-clock budget | Must return within 10 seconds. The Rust side enforces this with a hard timeout + SIGKILL |

The binary should be re-callable: the Rust agent invokes it once
per attestation refresh (every ~23 hours by default; see
`packages/exchange/src/attestation.ts` for the refresh cadence
the AppView's verifier enforces). It should NOT keep a long-lived
process or cache state — each call must produce a fresh chain
that the AppView's freshness check will accept.

## Failure modes the Rust side handles for you

- **Missing binary**: tracing warns, agent boots with empty chain.
- **Non-zero exit**: tracing warns with the status, agent boots
  with empty chain.
- **stdout is not UTF-8**: tracing warns, agent boots with empty
  chain.
- **stdout has no CERTIFICATE blocks**: tracing warns "no
  CERTIFICATE blocks", agent boots with empty chain.
- **Hung process (>10s)**: tracing warns, process is SIGKILLed,
  agent boots with empty chain.

The agent will never refuse to boot because of an MDA failure.
The empty-chain fallback path is identical to the path a stock
unentitled build takes today — receipts are still signed by the
Secure Enclave P-256 identity, and the AppView reports them as
`trustLevel: self-attested`.

## Suggested Swift implementation sketch

```swift
import DeviceCheck
import Foundation

@main
struct CocoreMdaAttest {
    static func main() async {
        guard DCAppAttestService.shared.isSupported else {
            FileHandle.standardError.write("App Attest not supported on this device\n".data(using: .utf8)!)
            exit(2)
        }
        do {
            // 1. Generate / reuse a key.
            let keyId = try await DCAppAttestService.shared.generateKey()
            // 2. Compute a clientDataHash (your choice — Apple's
            //    DA spec lets you bind any 32 bytes of context).
            let clientDataHash = Data(SHA256.hash(data: Data("cocore-mda-attest".utf8)))
            // 3. Get the attestation.
            let attestation = try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash)
            // 4. attestation is a CBOR blob; extract the
            //    x5c chain (Apple's verifier doc shows the
            //    structure) and emit as PEM.
            let chain = try CborAttestation(attestation).x5cChain
            for cert in chain {
                print("-----BEGIN CERTIFICATE-----")
                print(cert.base64EncodedString(options: .lineLength64Characters))
                print("-----END CERTIFICATE-----")
            }
            exit(0)
        } catch {
            FileHandle.standardError.write("attest failed: \(error)\n".data(using: .utf8)!)
            exit(3)
        }
    }
}
```

(`CborAttestation` is a stand-in for whatever CBOR helper the
final implementation uses — Apple's framework returns the
attestation in CBOR-COSE-Key shape and the x5c chain is a top-
level field. The d-inference reference at
`coordinator/internal/attestation/mda.go` shows the equivalent
parse on the verification side.)

## Operator setup checklist (when the binary lands)

1. Enroll in the Apple Developer Program.
2. Build `cocore-mda-attest` with `xcrun -sdk macosx swiftc`,
   sign with `codesign --entitlements cocore-mda-attest.entitlements`,
   notarize.
3. Drop the signed binary at `/usr/local/bin/cocore-mda-attest`.
4. Set `COCORE_MDA_ATTEST_BINARY=/usr/local/bin/cocore-mda-attest`
   in the agent's launch environment.
5. Restart `cocore agent serve`. The next attestation publish
   will carry the chain.
6. Verify with `curl https://appview.cocore.dev/xrpc/dev.cocore.appview.verifyAttestation?uri=at://...`
   and confirm `trustLevel: "hardware-attested"`.

## Why the path is path-vs-binary, not path-OR-binary

If both env vars are set, the file path wins. This lets operators
pin a chain across binary upgrades or pre-stage a chain for
testing without paying the DeviceCheck round-trip on every boot.
The Swift binary path is the default for production deployments
where the chain rotates on its own cadence.

## References

- Apple, "Managed Device Attestation":
  <https://developer.apple.com/documentation/devicemanagement/managed_device_attestation>
- Apple, "Validate apps that connect to your server" (App
  Attest, the simpler-to-enroll alternative):
  <https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity>
- d-inference verifier reference (Go):
  `Layr-Labs/d-inference` → `coordinator/internal/attestation/mda.go`
- cocore Rust verifier (already shipped):
  [`provider/src/mda.rs`](../provider/src/mda.rs)
- cocore Rust loader (this PR):
  [`provider/src/mda_loader.rs`](../provider/src/mda_loader.rs)
- cocore AppView trustLevel promotion (already shipped):
  [`packages/appview/src/api/server.ts`](../packages/appview/src/api/server.ts)
  around the `verifyAttestation` handler.
