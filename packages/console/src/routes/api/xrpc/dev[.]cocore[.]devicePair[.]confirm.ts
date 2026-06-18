import { createFileRoute } from "@tanstack/react-router";
import { devicePairConfirmResponse } from "@/lib/console-xrpc-http.server.ts";

export const Route = createFileRoute("/api/xrpc/dev.cocore.devicePair.confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => devicePairConfirmResponse(request),
    },
  },
});
