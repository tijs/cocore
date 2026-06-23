// POST /api/agent/mdm/enroll-profile
//
// Coordinator step 1 of guided MDM enrollment (Apple Managed Device
// Attestation, the "Secure Mode" upgrade). Body: {serial, udid}.
//
// Mints a per-device enrollment .mobileconfig templated to that serial:
// root + intermediate trust payloads, a device-identity payload, and an
// MDM payload with AccessRights=3 and SignMessage=true. Returns the
// (signed-or-unsigned) profile as application/x-apple-aspen-config so a
// Mac installs it directly.
//
// Auth: the agent's bearer API key — same surface as /api/agent/whoami,
// /api/agent/status, /api/agent/bug-report.
//
// CA signing + real per-device identity minting are ops-gated; see the
// TODO(ops) seams and REQUIRED ENV doc in
// src/lib/mdm-coordinator.server.ts. Today this returns a templated,
// structurally-complete profile (unsigned) when signing isn't wired.

import { createFileRoute } from "@tanstack/react-router";

import {
  authenticateAgent,
  buildEnrollmentProfile,
  isValidSerial,
  isValidUdid,
  mdmJson,
  secureMdmConfig,
} from "@/lib/mdm-coordinator.server.ts";

export const Route = createFileRoute("/api/agent/mdm/enroll-profile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authenticateAgent(request);
        if (!auth.ok) return auth.response;

        let body: { serial?: unknown; udid?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return mdmJson({ error: "body must be JSON" }, 400);
        }
        if (!isValidSerial(body.serial)) {
          return mdmJson({ error: "serial required (8–24 alphanumeric chars)" }, 400);
        }
        if (!isValidUdid(body.udid)) {
          return mdmJson({ error: "udid required (40-hex or UUID form)" }, 400);
        }

        const built = buildEnrollmentProfile(body.serial, body.udid);
        if (!built) {
          // Fail-closed: the Secure Mode (SCEP/MDM) backend isn't wired.
          // Report exactly which env keys are missing so an operator can
          // fix it, and so the wizard shows "not available yet" instead
          // of dead-ending the user in a broken profile install.
          const cfg = secureMdmConfig();
          return mdmJson(
            {
              error: "Secure Mode backend not configured",
              missing: cfg.ok ? [] : cfg.missing,
            },
            503,
          );
        }
        const { profile, signed, enrollmentId } = built;

        // Return a JSON envelope: the provider wizard reads `profile`
        // (base64) + `enrollmentId` from the body (and threads the
        // enrollmentId into push-attestation). The base64 keeps the
        // .mobileconfig bytes intact across JSON.
        return mdmJson({
          profile: Buffer.from(profile, "utf8").toString("base64"),
          enrollmentId,
          signed,
        });
      },
    },
  },
});
