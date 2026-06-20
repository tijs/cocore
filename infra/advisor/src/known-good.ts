// Known-good build set for the confidential tier (WS-COORDINATOR).
//
// darkbloom parity: the coordinator only grants the confidential tier to
// providers whose measured binary is a blessed release. There, a CI release
// job POSTs the release's hashes and the coordinator builds a `binaryHash ∈
// known-good` map enforced on every challenge. cocore's advisor is an
// *accelerator*, not the authority — a confidential requester re-verifies the
// provider's signed PDS attestation against its OWN known-good set at seal
// time — so this set only gates routing hints, never receipt validity.
//
// Source of the set, in order of preference:
//   1. `COCORE_KNOWN_GOOD_CDHASHES` — comma/space-separated lowercase hex.
//   2. (future) a releases feed the AppView serves, mirrored here.
// An EMPTY set means the advisor advertises NO provider as confidential-
// eligible — fail-closed, matching the verifier's "no known-good set → no
// build trusted" stance.

/** A point-in-time snapshot of the cdHashes the advisor will treat as a
 *  confidential-capable build. Lowercased on load. */
export class KnownGoodSet {
  private readonly cdHashes: Set<string>;

  constructor(cdHashes: Iterable<string> = []) {
    this.cdHashes = new Set([...cdHashes].map((h) => h.trim().toLowerCase()).filter(Boolean));
  }

  /** Build from the environment (`COCORE_KNOWN_GOOD_CDHASHES`). */
  static fromEnv(env: Record<string, string | undefined> = process.env): KnownGoodSet {
    const raw = env.COCORE_KNOWN_GOOD_CDHASHES ?? "";
    return new KnownGoodSet(raw.split(/[\s,]+/));
  }

  has(cdHash: string | undefined | null): boolean {
    if (!cdHash) return false;
    return this.cdHashes.has(cdHash.toLowerCase());
  }

  get size(): number {
    return this.cdHashes.size;
  }

  list(): string[] {
    return [...this.cdHashes];
  }
}
