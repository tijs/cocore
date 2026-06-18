import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";

import { atprotoMetadataJsonEffect } from "@/integrations/auth/atproto-metadata.server.ts";

export const Route = createFileRoute("/api/auth/atproto/metadata.json")({
  server: {
    handlers: {
      GET: () => Effect.runSync(atprotoMetadataJsonEffect),
    },
  },
});
