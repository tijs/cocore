import { Effect } from "effect";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { oauthCallbackOutcomeEffect } from "@/integrations/auth/oauth-callback.server.ts";

export const Route = createFileRoute("/api/auth/atproto/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const outcome = await Effect.runPromise(oauthCallbackOutcomeEffect(request));
        if (outcome._tag === "redirect") {
          throw redirect({ href: outcome.href });
        }
        return outcome.response;
      },
    },
  },
});
