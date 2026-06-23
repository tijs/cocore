// POST /api/agent/mdm/push-attestation
//
// Coordinator step 2 of guided MDM enrollment. Body: {serial,
// enrollmentId}. Enqueues the ACME attestation profile (ClientIdentifier
// + Subject CN = serial) to NanoMDM via /v1/enqueue + /v1/push, using
// COCORE_NANOMDM_URL + COCORE_NANOMDM_API_KEY. Returns the command
// status.
//
// Auth: the agent's bearer API key — same surface as the other
// /api/agent/* routes.
//
// NanoMDM wiring is ops-gated: when the env isn't set the enqueue is
// stubbed (status "queued", stubbed:true) so the flow is exercisable in
// a backendless dev ring. See src/lib/mdm-coordinator.server.ts.

import { createFileRoute } from "@tanstack/react-router";

import {
  authenticateAgent,
  isValidSerial,
  isValidUdid,
  mdmJson,
  pushAttestationCommand,
} from "@/lib/mdm-coordinator.server.ts";

export const Route = createFileRoute("/api/agent/mdm/push-attestation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authenticateAgent(request);
        if (!auth.ok) return auth.response;

        let body: { serial?: unknown; enrollmentId?: unknown; udid?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return mdmJson({ error: "body must be JSON" }, 400);
        }
        if (!isValidSerial(body.serial)) {
          return mdmJson({ error: "serial required (8–24 alphanumeric chars)" }, 400);
        }

        // The NanoMDM enqueue target is the device's enrollment id — its
        // UDID — when a real push (refresh) is wanted. Only a genuine device
        // UDID is a valid NanoMDM enqueue target. The guided wizard sends
        // `enrollmentId` (a pairing artifact, NOT the device's UDID); pushing
        // to it FK-violates NanoMDM's enrollment_queue (enqueue 500). So we no
        // longer treat enrollmentId as a target — a missing UDID means initial
        // attestation runs from the enrollment profile (ACME device-attest-01
        // on install), which is exactly the wizard's case.
        const target = isValidUdid(body.udid) ? body.udid : null;

        const result = await pushAttestationCommand(body.serial, target);

        // The push is ADVISORY. The attestation chain is produced by the
        // device-attest-01 at profile-install and read back via
        // /attestation-chain (which the wizard polls with its own timeout). A
        // NanoMDM enqueue/push failure therefore must NOT dead-end the wizard
        // with a 502 — surface the reason in the body and let the poll decide
        // readiness. Auth/validation problems above are still hard errors.
        return mdmJson(result, 200);
      },
    },
  },
});
