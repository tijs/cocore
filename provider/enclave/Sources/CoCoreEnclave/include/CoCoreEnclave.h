// CoCoreEnclave: C-ABI surface that the cocore-provider Rust agent
// links against to access the Secure Enclave. The Rust side declares
// these in provider/src/secure_enclave.rs under
// `cfg(all(target_os = "macos", feature = "secure_enclave"))`.
//
// All functions return 0 on success and a negative integer on
// failure. A single process should call cocore_enclave_create_or_load
// at most once; the returned handle is opaque and must be freed with
// cocore_enclave_release.

#ifndef COCORE_ENCLAVE_H
#define COCORE_ENCLAVE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Load the existing Secure Enclave identity for this user, or
/// create one if none exists. The handle is non-portable: it will
/// only work on the Mac it was created on.
int cocore_enclave_create_or_load(void **out_handle);

/// Copy the raw P-256 public key (uncompressed, 64 bytes: X || Y)
/// into the caller's buffer. `len` must be at least 64.
int cocore_enclave_public_key(void *handle, unsigned char *out, size_t len);

/// Produce an ECDSA-P256 signature over `data`. The signature is
/// DER-encoded and written into `out_sig`; on entry, `*out_sig_len`
/// is the buffer capacity, on exit, the actual length.
int cocore_enclave_sign(
    void *handle,
    const unsigned char *data,
    size_t data_len,
    unsigned char *out_sig,
    size_t *out_sig_len
);

/// Release the handle. Safe to call with NULL.
void cocore_enclave_release(void *handle);

#ifdef __cplusplus
}
#endif

#endif // COCORE_ENCLAVE_H
