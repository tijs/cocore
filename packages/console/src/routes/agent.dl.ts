// `GET /agent/dl[?tag=v0.6.0]` — streams the macOS arm64 release
// tarball (`cocore-mac-arm64.tar.gz`) back to a curl-bootstrap
// installer. With `?tag=` pinned to a specific release; without,
// the latest release is used. Auth is server-side via `GITHUB_TOKEN`
// so the cocore repo stays private.
//
// v0.5.x supported `&variant=stub|inference` to pick between two
// tarballs. v0.6.0 collapsed those into one. The `variant` query
// param is still accepted (ignored) for backward-compat with old
// installers cached in users' shells / docs / blog posts.

import { createFileRoute } from "@tanstack/react-router";

import { ReleaseProxyError, streamAsset } from "@/lib/github-releases.server.ts";

export const Route = createFileRoute("/agent/dl")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tag = url.searchParams.get("tag");
        // variant param ignored in v0.6.0+; see file header.
        try {
          return await streamAsset(tag);
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
