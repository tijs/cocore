# Track B — hardware-attested (Apple MDA) tier: runbook

Goal: each provider Mac produces an **Apple-signed certificate chain** (rooted in
the Apple Enterprise Attestation Root CA that `provider/src/mda.rs` and
`packages/sdk/src/mda.ts` / `sdk/py/cocore/mda.py` already embed) that attests the
device's identity + security posture and is bound to cocore's signing key. The
verifier already consumes this; Track B builds the **infrastructure that produces
the chain** + the **agent companion** that fetches it, then flips eligible
providers to `trustLevel: hardware-attested`.

## Chosen stack (decided 2026-06-20)

- **MDM:** self-hosted **NanoMDM** (parity with darkbloom; hands us the raw chain).
- **ACME attestation server:** **Smallstep `step-ca`** (documented Apple
  `device-attest-01` support).
- **Hosting:** Railway, alongside the existing `console` / `services` / `advisor`.
- **Enrollment:** profile-based (user installs a `.mobileconfig`) — rides on an
  **APNs MDM push certificate**, NOT Apple Business Manager. (Finish ABM in
  parallel only to unlock supervised/ADE later.)

## The flow (target)

1. Provider installs cocore → installer opens a `.mobileconfig` from the
   coordinator's `/enroll` (MDM enrollment payload + `com.apple.security.acme`
   attestation payload, `Attest=true HardwareBound=true`, pointing at step-ca).
2. The Mac enrolls in NanoMDM (user-approves the profile).
3. Via the ACME payload, the SEP generates a hardware-bound key and runs
   `device-attest-01` against step-ca; the device produces an **Apple attestation**
   (the `x5c` chain rooted in the Enterprise Attestation Root, carrying the device
   serial/UDID/OS/SIP/secure-boot OIDs + a freshness code).
4. step-ca (and/or the coordinator) captures that Apple chain and hands it back to
   the cocore agent, which embeds it in its `dev.cocore.compute.attestation` PDS
   record. `mda.rs` verifies root + binding; the provider flips to hardware-attested.

## Ordered to-do

### 0. Critical path — ✅ DONE (2026-06-20, via the FREE path — $0)
- [x] **APNs MDM push certificate** obtained via **`mdmcert.download`** (free
      community vendor) + the Apple Push Certificates Portal (`identity.apple.com`).
      Material lives OUTSIDE the repo in `~/cocore-mdm/` (push.key, push.p12,
      apns_push.pem). Renew annually with the SAME Apple ID + SAME push.key.
  - **GOTCHA THAT COST US HOURS:** the portal wants the **base64-encoded** plist
    (the `*.plist.b64` mdmcert emits), NOT the decoded raw `.plist`. Uploading the
    raw XML plist gives a generic "Invalid Certificate Signing Request" for
    everyone, on any Apple ID — it looks like a vendor/account problem but is
    purely an encoding mistake. Decrypt chain: hex-decode `.p7` → `openssl cms
    -decrypt` → that yields `.plist.b64`, and THAT base64 file is what you upload.
  - Confirms the free self-hosted path is viable: no Mosyle / no per-device cost.
- [ ] Confirm the Developer Program membership is **GRAZE SOCIAL PBC** (org), not
      Individual (`developer.apple.com/account` → Membership).

### 1. Infra on Railway (once the push cert is in hand)
- [ ] Deploy **NanoMDM** (public HTTPS, push cert from step 0, a Postgres store).
- [ ] Deploy **step-ca** with the ACME provisioner + Apple `device-attest-01`
      enabled; trust anchor = Apple Enterprise Attestation Root (same bytes we
      embed).
- [ ] DNS + TLS for both hostnames.

### 2. cocore-side build (me — staged to the infra)
- [ ] Coordinator **`/enroll`** → serves the signed `.mobileconfig` (MDM +
      ACME-attestation payload). *Testable structurally now (plutil + codesign).* 
- [ ] Coordinator **attestation receive / store-by-serial / hand-back** to the
      agent. *Testable now with synthetic chains from the cross_lang_fixture
      generator.*
- [ ] **`cocore-mda-attest` companion** (`docs/mda-companion-binary.md`): drives
      the attestation, captures the `x5c`, verifies with `mda::verify_chain`,
      emits the PEM chain the agent embeds. *Needs a real enrolled device to
      validate.*
- [ ] One-click enroll in the installer.

### 3. The binding decision (resolve empirically on the test device)
`mda.rs` currently binds **leaf-key == cocore SE signing key**. The standard ACME
`HardwareBound` flow attests a *new* ACME key, not our existing signing key, so we
need one of:
- **(a)** generate cocore's SE signing key through the attested ACME flow (the
  attested key *is* the signing key → existing binding works), or
- **(b)** bind via the **freshness-code OID** = `sha256(nonce)` where the
  coordinator's nonce commits to `sha256(SE pubkey)` (darkbloom's approach; needs a
  small `mda.rs` change — the freshness-code is already extracted).

Decide once we see what a real device returns (the D-test). (b) is less invasive
and matches darkbloom; (a) reuses today's check. **A wrong choice silently caps the
tier at best-effort with no error, so this is verified end-to-end on the first
enrolled Mac.**

### 4. Test device (you)
- [ ] One spare Apple-silicon Mac I can drive (physical or SSH) to enroll →
      attest → verify the chain + binding end-to-end.

## What I need handed over
1. The APNs push cert (`.pem` + key) **or** admin/SSH to the NanoMDM host.
2. The NanoMDM + step-ca endpoint URLs once up.
3. Railway deploy access for the `/enroll` + attestation endpoints
   (`RAILWAY_API_TOKEN`).
4. The test Mac.

## Note on the exact Apple mechanism
The precise `device-attest-01` payload + how the freshness nonce binds the key can
shift across macOS versions; I'll confirm the exact wire details against Apple's
current MDM Protocol Reference + step-ca's Apple-MDA docs + the darkbloom reference
when building, and validate on the test device. None of that changes the
prerequisites above.
