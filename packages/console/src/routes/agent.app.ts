// `GET /agent/app[?tag=v0.7.1]` — streams the notarized macOS menu-bar
// app (`cocore.app.zip`) back to the browser as a download. This is the
// recommended install for most users: download, unzip, drag cocore.app
// to /Applications, open it, and the in-app Welcome window walks through
// sign-in → choose a model → start serving. The app bundles the cocore
// CLI, so no `curl … | sh` is needed.
//
// Auth to the (private) release repo is server-side via GITHUB_TOKEN,
// same as /agent/dl. With `?tag=` pinned; without, the latest release.

import { createFileRoute } from "@tanstack/react-router";

import { ReleaseProxyError, streamAsset } from "@/lib/github-releases.server.ts";

export const Route = createFileRoute("/agent/app")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const tag = new URL(request.url).searchParams.get("tag");
        try {
          return await streamAsset(tag, "cocore.app.zip");
        } catch (e) {
          if (e instanceof ReleaseProxyError) {
            return new Response(JSON.stringify({ error: e.userMessage }), {
              status: e.status,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }
          throw e;
        }
      },
    },
  },
});
