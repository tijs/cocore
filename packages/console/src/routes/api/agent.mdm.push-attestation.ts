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
        // UDID — when a real push (refresh) is wanted. The guided wizard
        // sends neither (initial attestation runs from the enrollment
        // profile), so a missing target is NOT an error: pushAttestation
        // ACKs and the device attests on install. enrollmentId is kept as
        // a fallback target for older callers.
        const target = isValidUdid(body.udid)
          ? body.udid
          : typeof body.enrollmentId === "string" && body.enrollmentId.length > 0
            ? body.enrollmentId
            : null;

        const result = await pushAttestationCommand(body.serial, target);
        const status = result.status === "error" ? 502 : 200;
        return mdmJson(result, status);
      },
    },
  },
});
