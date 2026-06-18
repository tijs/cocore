// POST /api/v1/private/chat/completions
//
// Friends-only sibling of `/api/v1/chat/completions`: same OpenAI wire
// format, but routing is constrained to providers the authenticated
// DID has friended (dev.cocore.account.friend records). See the
// canonical `/v1/private/chat/completions` mount for the full contract;
// both routes call the same handler in
// `@/lib/openai-routes.server.ts`.

import { createFileRoute } from "@tanstack/react-router";

import { handlePrivateChatCompletions } from "@/lib/openai-routes.server.ts";

export const Route = createFileRoute("/api/v1/private/chat/completions")({
  server: {
    handlers: {
      POST: ({ request }) => handlePrivateChatCompletions(request),
    },
  },
});
