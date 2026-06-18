// `GET /agent/policy` — the agent/app update policy. Public (no auth);
// it's just version metadata.
//
//   { "latest": "v0.7.1", "minSupported": "0.0.0", "notice": null }
//
// - latest:       the newest release tag (from the GitHub-releases proxy).
// - minSupported: clients older than this MUST update before they can
//                 keep serving — the remote "force update" lever. Set via
//                 the COCORE_MIN_AGENT_VERSION env on the console; bump it
//                 when you need to deprecate older agents. Defaults to
//                 0.0.0 (no floor).
// - notice:       optional non-blocking message the app/CLI surfaces as a
//                 banner (e.g. a deprecation heads-up). COCORE_AGENT_NOTICE.
//
// Clients normalize a leading "v" and compare semver-ish.

import { createFileRoute } from "@tanstack/react-router";

import { latestTag } from "@/lib/github-releases.server.ts";

export const Route = createFileRoute("/agent/policy")({
  server: {
    handlers: {
      GET: async () => {
        let latest = "";
        try {
          latest = await latestTag();
        } catch {
          // Release lookup down → still return a usable policy (no latest,
          // so clients won't think they're behind), with the floor intact.
        }
        const minSupported = process.env["COCORE_MIN_AGENT_VERSION"] ?? "0.0.0";
        const notice = process.env["COCORE_AGENT_NOTICE"] || null;
        return new Response(JSON.stringify({ latest, minSupported, notice }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
