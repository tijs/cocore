import { createFileRoute } from "@tanstack/react-router";
import { devicePairPollResponse } from "@/lib/console-xrpc-http.server.ts";

export const Route = createFileRoute("/api/xrpc/dev.cocore.devicePair.poll")({
  server: {
    handlers: {
      GET: async ({ request }) => devicePairPollResponse(new URL(request.url).search),
    },
  },
});
