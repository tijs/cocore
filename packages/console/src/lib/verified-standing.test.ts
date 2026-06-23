// Pure tests for the trust-floor logic that gates the verified path. The
// network/crypto half (fetch attestation + run the SDK verifier) is exercised
// by the SDK's own verifier tests; here we pin the floor semantics: a
// hardware-attested floor accepts EITHER verified tier, confidential is strict.

import { describe, expect, it } from "vitest";

import { meetsFloor, parseTrustFloor } from "./verified-standing.server.ts";

describe("parseTrustFloor", () => {
  it("maps the accepted aliases", () => {
    expect(parseTrustFloor("hardware-attested")).toBe("hardware-attested");
    expect(parseTrustFloor("hardware")).toBe("hardware-attested");
    expect(parseTrustFloor("confidential")).toBe("attested-confidential");
    expect(parseTrustFloor("attested-confidential")).toBe("attested-confidential");
    expect(parseTrustFloor(" Confidential ")).toBe("attested-confidential");
  });

  it("rejects unknown / non-string values (caller 400s instead of downgrading)", () => {
    expect(parseTrustFloor("best-effort")).toBeNull();
    expect(parseTrustFloor("")).toBeNull();
    expect(parseTrustFloor(undefined)).toBeNull();
    expect(parseTrustFloor(42)).toBeNull();
  });
});

describe("meetsFloor", () => {
  it("hardware-attested floor accepts either verified tier, not best-effort", () => {
    expect(meetsFloor("hardware-attested", "hardware-attested")).toBe(true);
    expect(meetsFloor("attested-confidential", "hardware-attested")).toBe(true);
    expect(meetsFloor("best-effort", "hardware-attested")).toBe(false);
  });

  it("confidential floor is strict — only attested-confidential passes", () => {
    expect(meetsFloor("attested-confidential", "attested-confidential")).toBe(true);
    expect(meetsFloor("hardware-attested", "attested-confidential")).toBe(false);
    expect(meetsFloor("best-effort", "attested-confidential")).toBe(false);
  });
});
