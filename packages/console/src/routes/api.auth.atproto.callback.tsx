import { createFileRoute, redirect } from "@tanstack/react-router";

import { oauthCallbackOutcomeEffect } from "@/integrations/auth/oauth-callback.server.ts";
import { runTraced } from "@/lib/o11y.server.ts";

export const Route = createFileRoute("/api/auth/atproto/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const outcome = await runTraced("auth.oauthCallback", oauthCallbackOutcomeEffect(request));
        if (outcome._tag === "redirect") {
          throw redirect({ href: outcome.href });
        }
        return outcome.response;
      },
    },
  },
});
