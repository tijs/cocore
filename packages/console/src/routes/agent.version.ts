// `GET /agent/version` — returns the latest cocore release tag as
// plain text (e.g. `v0.2.0\n`). Backed by GitHub's `releases/latest`
// endpoint via a server-side `GITHUB_TOKEN` so the cocore repo can
// stay private while the install bootstrap stays anonymous.

import { createFileRoute } from "@tanstack/react-router";

import { latestTag, ReleaseProxyError } from "@/lib/github-releases.server.ts";

export const Route = createFileRoute("/agent/version")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const tag = await latestTag();
          return new Response(`${tag}\n`, {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        } catch (e) {
          if (e instanceof ReleaseProxyError) {
            return new Response(`${e.userMessage}\n`, {
              status: e.status,
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
          }
          throw e;
        }
      },
    },
  },
});
