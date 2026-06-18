# cocore enclave

A small Swift package that wraps the macOS Secure Enclave with the
exact C-ABI the cocore Rust agent expects in
`provider/src/secure_enclave.rs` (under
`cfg(all(target_os = "macos", feature = "secure_enclave"))`).

The package builds two ways:

1. **Swift static library** — consumed by `provider-shell/` as a
   `.package(path:)` dependency. Used during `swift build` of the
   menu bar app.
2. **C-ABI static archive** — produced by `swift build -c release` as
   `libCoCoreEnclave.a`. The Rust agent's build script (M5) picks it
   up from `target/release/` and links it via `cargo:rustc-link-lib`.

## Surface

```c
int  cocore_enclave_create_or_load(void **out_handle);
int  cocore_enclave_public_key(void *handle, unsigned char *out, size_t len);
int  cocore_enclave_sign(void *handle,
                         const unsigned char *data, size_t data_len,
                         unsigned char *out_sig, size_t *out_sig_len);
void cocore_enclave_release(void *handle);
```

All functions return `0` on success and a negative integer on failure.
Public keys are 64-byte raw P-256 (X || Y, no `0x04` prefix).
Signatures are DER-encoded ECDSA.

## Persistence

We store the Secure Enclave key's `dataRepresentation` (a non-portable
opaque blob, *not* the private key bytes) in the user's keychain under
service `cocore.provider.enclave`, account `default`. On the next
process launch we reconstruct the SE key from this blob with no user
prompt. Loss of the keychain item — or moving the binary to a
different Mac — invalidates the identity; the agent re-registers.

## Build

```bash
swift build -c release
ls .build/release/libCoCoreEnclave.a
```

## Test

`swift test` will run the integration check on a real Secure Enclave
host (M-series Mac with SIP and Hardened Runtime). On other hosts it
skips with `XCTSkip`.
