// Unit coverage for the Secure Mode MDM coordinator's pure paths —
// per-device profile generation, fail-closed config, and the
// push-attestation tolerance that lets the shipped wizard advance.
// These never touch the SQLite chain store (that's exercised separately),
// so they run without the better-sqlite3 native binding.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  attestationIsBundled,
  buildEnrollmentProfile,
  isValidSerial,
  isValidUdid,
  pushAttestationCommand,
  secureMdmConfig,
} from "./mdm-coordinator.server.ts";

const SCEP_KEYS = [
  "COCORE_MDM_SCEP_URL",
  "COCORE_MDM_SCEP_NAME",
  "COCORE_MDM_SCEP_CHALLENGE",
  "COCORE_MDM_SERVER_URL",
  "COCORE_MDM_CHECKIN_URL",
  "COCORE_MDM_TOPIC",
  "COCORE_MDM_ROOT_CA_PEM",
  "COCORE_MDM_INTERMEDIATE_CA_PEM",
  "COCORE_MDM_ACME_URL",
];

const SERIAL = "H2WHW38LQ6NV";
const UDID = "00008103-001869192E20801E"; // not a valid UDID_RE form on its own
const REAL_UDID = "A1B2C3D4-1111-2222-3333-444455556666";

function clearEnv(): void {
  for (const k of SCEP_KEYS) delete process.env[k];
  delete process.env["COCORE_NANOMDM_URL"];
  delete process.env["COCORE_NANOMDM_API_KEY"];
}

function configureFull(): void {
  process.env["COCORE_MDM_SCEP_URL"] = "https://ca.example.test:43462/scep/cocore-scep";
  process.env["COCORE_MDM_SCEP_CHALLENGE"] = "s3cr3t&<challenge>";
  process.env["COCORE_MDM_SERVER_URL"] = "https://mdm.example.test/mdm";
  process.env["COCORE_MDM_TOPIC"] = "com.apple.mgmt.External.abc";
  process.env["COCORE_MDM_ROOT_CA_PEM"] =
    "-----BEGIN CERTIFICATE-----\nQUJDREVG\n-----END CERTIFICATE-----";
  process.env["COCORE_MDM_ACME_URL"] = "https://ca.example.test:43462/acme/cocore-attest/directory";
}

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of [...SCEP_KEYS, "COCORE_NANOMDM_URL", "COCORE_NANOMDM_API_KEY"])
    saved[k] = process.env[k];
  clearEnv();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("validation", () => {
  it("accepts real Apple serials and UUID-form UDIDs, rejects garbage", () => {
    expect(isValidSerial(SERIAL)).toBe(true);
    expect(isValidSerial("no-dashes-allowed")).toBe(false);
    expect(isValidUdid(REAL_UDID)).toBe(true);
    expect(isValidUdid(UDID)).toBe(false); // hyphenated but wrong group sizes
  });
});

describe("secureMdmConfig — fail-closed", () => {
  it("reports every missing required key when unconfigured", () => {
    const r = secureMdmConfig();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("COCORE_MDM_SCEP_URL");
      expect(r.missing).toContain("COCORE_MDM_SCEP_CHALLENGE");
      expect(r.missing).toContain("COCORE_MDM_SERVER_URL");
      expect(r.missing).toContain("COCORE_MDM_TOPIC");
      expect(r.missing).toContain("COCORE_MDM_ROOT_CA_PEM");
    }
  });

  it("resolves once the required keys are present", () => {
    configureFull();
    const r = secureMdmConfig();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.scepName).toBe("cocore-scep"); // default
      expect(r.config.checkInUrl).toBe(r.config.mdmServerUrl); // defaults to server URL
      expect(r.config.rootCaB64).toBe("QUJDREVG"); // PEM armor stripped
    }
  });
});

describe("buildEnrollmentProfile", () => {
  it("returns null when the backend isn't configured (route → 503)", () => {
    expect(buildEnrollmentProfile(SERIAL, REAL_UDID)).toBeNull();
  });

  it("emits a SCEP identity + MDM + bundled ACME profile (no empty PKCS12)", () => {
    configureFull();
    const built = buildEnrollmentProfile(SERIAL, REAL_UDID);
    expect(built).not.toBeNull();
    const p = built!.profile;

    // SCEP device identity — not the old empty-PKCS12 stub.
    expect(p).toContain("com.apple.security.scep");
    expect(p).not.toContain("com.apple.security.pkcs12");
    expect(p).toContain("https://ca.example.test:43462/scep/cocore-scep");
    // SCEP challenge is XML-escaped, not raw.
    expect(p).toContain("s3cr3t&amp;&lt;challenge&gt;");
    expect(p).not.toContain("s3cr3t&<challenge>");

    // MDM payload, least-privilege + signed check-ins.
    expect(p).toContain("com.apple.mdm");
    expect(p).toContain("<key>AccessRights</key><integer>3</integer>");
    expect(p).toContain("<key>SignMessage</key><true/>");
    expect(p).toContain("https://mdm.example.test/mdm");
    expect(p).toContain("com.apple.mgmt.External.abc");

    // Root trust anchor embedded.
    expect(p).toContain("com.apple.security.root");
    expect(p).toContain("QUJDREVG");

    // Bundled per-serial ACME attestation (CN + ClientIdentifier = serial).
    expect(p).toContain("com.apple.security.acme");
    expect(p).toContain("<key>Attest</key><true/>");
    expect(p).toContain(`<key>ClientIdentifier</key><string>${SERIAL}</string>`);

    // The MDM payload binds to the SCEP identity by UUID.
    const idUuid =
      /com\.apple\.security\.scep[\s\S]*?<key>PayloadUUID<\/key><string>([0-9A-F-]+)<\/string>/.exec(
        p,
      )?.[1];
    expect(idUuid).toBeTruthy();
    expect(p).toContain(`<key>IdentityCertificateUUID</key><string>${idUuid}</string>`);

    expect(built!.signed).toBe(false);
    expect(built!.enrollmentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("omits the ACME payload when attestation isn't bundled", () => {
    configureFull();
    delete process.env["COCORE_MDM_ACME_URL"];
    expect(attestationIsBundled()).toBe(false);
    const p = buildEnrollmentProfile(SERIAL, REAL_UDID)!.profile;
    expect(p).toContain("com.apple.security.scep");
    expect(p).not.toContain("com.apple.security.acme");
  });
});

describe("pushAttestationCommand — tolerance (no 400 for the shipped wizard)", () => {
  it("ACKs with no MDM target and bundled attestation", async () => {
    configureFull();
    const r = await pushAttestationCommand(SERIAL, null);
    expect(r.queued).toBe(true);
    expect(r.status).toBe("bundled");
  });

  it("ACKs (acknowledged) with no target and no bundling", async () => {
    const r = await pushAttestationCommand(SERIAL, null);
    expect(r.queued).toBe(true);
    expect(r.status).toBe("acknowledged");
  });

  it("stubs the enqueue when a target is given but NanoMDM is unconfigured", async () => {
    const r = await pushAttestationCommand(SERIAL, REAL_UDID);
    expect(r.queued).toBe(true);
    expect(r.stubbed).toBe(true);
    expect(r.status).toBe("queued");
  });
});
