// `GET /agent/binary-hashes[?tag=v0.7.6]` — serves the `SHA256SUMS`
// asset for a release (latest if no tag) as text/plain.
//
// This is the verification half of the provider's attestation
// `binaryHash`: an attestation reports the SHA-256 of the running cocore
// binary, and this endpoint publishes the known-good hashes of the exact
// shipped binaries (the Developer-ID-signed app-embedded one and the
// raw tarball one). A verifier fetches this, finds the `cocore` lines,
// and confirms a provider is running a published build rather than an
// unknown binary. Auth to the (private) release repo is server-side via
// GITHUB_TOKEN, same as /agent/app.

import { createFileRoute } from "@tanstack/react-router";

import { ReleaseProxyError, streamAsset } from "@/lib/github-releases.server.ts";

export const Route = createFileRoute("/agent/binary-hashes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const tag = new URL(request.url).searchParams.get("tag");
        try {
          const upstream = await streamAsset(tag, "SHA256SUMS");
          // streamAsset infers a binary content-type from the filename;
          // SHA256SUMS is plain text, so re-wrap with the right headers
          // while preserving the resolved-tag signal.
          return new Response(upstream.body, {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "public, max-age=300",
              "x-cocore-release": upstream.headers.get("x-cocore-release") ?? "",
            },
          });
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
