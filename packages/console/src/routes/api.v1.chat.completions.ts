// POST /api/v1/chat/completions
//
// OpenAI-compatible chat completions, authed by an API key
// (`Authorization: Bearer cocore-…`). See the canonical
// `/v1/chat/completions` mount for the full contract; both routes call
// the same handler in `@/lib/openai-routes.server.ts`, so there is one
// implementation and two base URLs that reach it.

import { createFileRoute } from "@tanstack/react-router";

import { handleChatCompletions } from "@/lib/openai-routes.server.ts";

export const Route = createFileRoute("/api/v1/chat/completions")({
  server: {
    handlers: {
      POST: ({ request }) => handleChatCompletions(request),
    },
  },
});
