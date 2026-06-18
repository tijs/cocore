import { Effect } from "effect";

import { atprotoOAuth } from "@/integrations/auth/atproto.server.ts";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
} as const;

export const atprotoMetadataJsonEffect: Effect.Effect<Response> = Effect.sync(
  () =>
    new Response(JSON.stringify(atprotoOAuth.metadata), {
      headers: jsonHeaders,
    }),
);

export const atprotoJwksJsonEffect: Effect.Effect<Response> = Effect.sync(() => {
  const jwks = atprotoOAuth.jwks;
  if (!jwks) {
    return new Response(JSON.stringify({ keys: [] }), {
      status: 200,
      headers: jsonHeaders,
    });
  }
  return new Response(JSON.stringify(jwks), {
    status: 200,
    headers: jsonHeaders,
  });
});
