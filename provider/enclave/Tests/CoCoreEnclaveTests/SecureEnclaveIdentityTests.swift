// Run only on a real Mac with a Secure Enclave; the @MainActor +
// SecureEnclave.isAvailable guard short-circuits on CI runners that
// don't have one. CI builds run `swift build -c release` to confirm
// the package still compiles; the actual key creation is exercised
// in manual smoke tests on a paired machine.

import XCTest
import CryptoKit
@testable import CoCoreEnclave

final class SecureEnclaveIdentityTests: XCTestCase {
    func testLoadOrCreate_roundTrips() throws {
        try XCTSkipUnless(SecureEnclave.isAvailable, "no Secure Enclave on this host")
        let id = try SecureEnclaveIdentity.loadOrCreate()
        let pub = id.publicKeyRaw64()
        XCTAssertEqual(pub.count, 64)
        let sig = try id.sign(Data("cocore-test".utf8))
        XCTAssertGreaterThan(sig.count, 0)
        // Verify with CryptoKit using the public key.
        let pkRaw = Data([0x04]) + pub
        // (CryptoKit's P256 init expects compressed or uncompressed —
        // we've stripped the 0x04 in publicKeyRaw64, restore it here.)
        let pk = try P256.Signing.PublicKey(x963Representation: pkRaw)
        let derSig = try P256.Signing.ECDSASignature(derRepresentation: sig)
        XCTAssertTrue(pk.isValidSignature(derSig, for: Data("cocore-test".utf8)))
    }
}
