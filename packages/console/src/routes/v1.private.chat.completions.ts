// POST /v1/private/chat/completions
//
// Friends-only sibling of `/v1/chat/completions`. Same OpenAI wire
// format — point a client at
// `base_url="https://cocore.dev/v1/private"` and it Just Works
// — but the request is constrained to providers the authenticated DID
// has explicitly friended (dev.cocore.account.friend records on the
// DID's PDS). Crypto is identical end-to-end; the difference is which
// strangers' Macs are in the candidate pool.
//
// Errors specific to this endpoint:
//   * 503 (no_friends_available) — no friends, or none connected
//   * 404 (no_friends_for_model) — connected friends don't serve it
//
// Add friends at `/friends` in the console. The handler is shared with
// the legacy `/api/v1/private/chat/completions` mount.

import { createFileRoute } from "@tanstack/react-router";

import { handlePrivateChatCompletions } from "@/lib/openai-routes.server.ts";

export const Route = createFileRoute("/v1/private/chat/completions")({
  server: {
    handlers: {
      POST: ({ request }) => handlePrivateChatCompletions(request),
    },
  },
});
