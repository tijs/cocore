// POST /v1/verified/chat/completions
//
// Verified-only sibling of `/v1/chat/completions`. Same OpenAI wire format —
// point a client at `base_url="https://cocore.dev/v1/verified"` and it Just
// Works — but routing is constrained to providers whose attestation is
// CRYPTOGRAPHICALLY VERIFIED to meet a trust floor, recomputed from the actual
// Apple-rooted attestation rather than the provider's self-asserted label.
//
// Optional body field:
//   * min_trust: "hardware-attested" (default — any verified machine)
//                "confidential"      (strict attested-confidential tier)
//
// Errors specific to this endpoint:
//   * 503 (no_verified_providers) — none meet the floor for the model
//   * 400 (invalid_min_trust)     — unrecognized min_trust value
//
// The handler is shared with the legacy `/api/v1/verified/chat/completions`
// mount. See verified-standing.server.ts for the proof-backed allow-set.

import { createFileRoute } from "@tanstack/react-router";

import { handleVerifiedChatCompletions } from "@/lib/openai-routes.server.ts";

export const Route = createFileRoute("/v1/verified/chat/completions")({
  server: {
    handlers: {
      POST: ({ request }) => handleVerifiedChatCompletions(request),
    },
  },
});
