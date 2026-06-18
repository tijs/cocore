import type { OAuthSession } from "@atcute/oauth-node-client";
import { isDid } from "@atcute/lexicons/syntax";
import { Effect } from "effect";

import { restoreAtprotoSessionEffect } from "@/integrations/auth/atproto.server.ts";
import {
  resolveAppSessionToken,
  revokeAppSession,
} from "@/integrations/auth/app-session-store.server.ts";
import { readAuthSessionToken } from "@/integrations/auth/cookie-parse.ts";

export type AtprotoSessionContext = {
  did: string;
  oauthSession: OAuthSession;
};

export function atprotoSessionForRequestEffect(
  request: Request,
): Effect.Effect<AtprotoSessionContext | undefined> {
  return Effect.gen(function* () {
    const sessionToken = readAuthSessionToken(request.headers.get("cookie"));
    if (!sessionToken) return undefined;

    const app = resolveAppSessionToken(sessionToken);
    if (!app) return undefined;

    const { did } = app;
    if (!isDid(did)) return undefined;

    const oauthSession = yield* restoreAtprotoSessionEffect(did);
    if (!oauthSession) {
      // OAuth session is gone (revoked or never written). Drop the
      // app session so the user re-authenticates; don't try to
      // revoke at the auth server (already gone).
      revokeAppSession(sessionToken);
      return undefined;
    }

    return { did, oauthSession };
  });
}

/** Valid AT Proto OAuth session plus DID from opaque server cookie. */
export function getAtprotoSessionForRequest(
  request: Request,
): Promise<AtprotoSessionContext | undefined> {
  return Effect.runPromise(atprotoSessionForRequestEffect(request));
}
