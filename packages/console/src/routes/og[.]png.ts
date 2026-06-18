import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";

import { renderRootOgPngEffect } from "@/og/render-root-og-png.server.ts";

const ONE_DAY = 60 * 60 * 24;

export const Route = createFileRoute("/og.png")({
  server: {
    handlers: {
      GET: async () => {
        const body = await Effect.runPromise(renderRootOgPngEffect);
        return new Response(body, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": `public, max-age=${ONE_DAY}, s-maxage=${ONE_DAY}`,
          },
        });
      },
    },
  },
});
