import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";

import { atprotoJwksJsonEffect } from "@/integrations/auth/atproto-metadata.server.ts";

export const Route = createFileRoute("/api/auth/atproto/jwks.json")({
  server: {
    handlers: {
      GET: () => Effect.runSync(atprotoJwksJsonEffect),
    },
  },
});
