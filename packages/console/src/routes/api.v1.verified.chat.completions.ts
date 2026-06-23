// POST /api/v1/verified/chat/completions
//
// Verified-only sibling of `/api/v1/chat/completions`: same OpenAI wire
// format, but routing is constrained to providers whose attestation is
// cryptographically verified to meet a trust floor (min_trust body field:
// "hardware-attested" default, or "confidential"). See the canonical
// `/v1/verified/chat/completions` mount for the full contract; both routes
// call the same handler in `@/lib/openai-routes.server.ts`.

import { createFileRoute } from "@tanstack/react-router";

import { handleVerifiedChatCompletions } from "@/lib/openai-routes.server.ts";

export const Route = createFileRoute("/api/v1/verified/chat/completions")({
  server: {
    handlers: {
      POST: ({ request }) => handleVerifiedChatCompletions(request),
    },
  },
});
