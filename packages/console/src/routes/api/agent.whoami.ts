// GET /api/agent/whoami
//
// Bearer-key authed identity ping. The provider agent's `cocore agent
// doctor` and `cocore agent update` commands hit this to verify their
// API key still resolves to a DID. A 401 here is the canonical
// "your install needs `cocore agent pair` to mint a fresh key"
// signal — and is the same auth surface the proxy createRecord
// uses, so a passing whoami implies subsequent publishes will not
// fail on auth.
//
// Deliberately tiny payload — no PDS lookups, no advisor probe — so
// the agent can call this on every doctor run without rate-limiting
// concerns. The richer cross-system diagnosis lives at
// /api/agent/health.

import { createFileRoute } from "@tanstack/react-router";

import { resolveBearerKey } from "@/lib/api-keys.server.ts";

function readBearer(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/agent/whoami")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bearer = readBearer(request);
        if (!bearer) return jsonError(401, "missing Authorization: Bearer header");
        const resolved = resolveBearerKey(bearer);
        if (!resolved) return jsonError(401, "invalid API key");
        return new Response(
          JSON.stringify({
            did: resolved.did,
            keyId: resolved.id,
            keyName: resolved.name,
            valid: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
