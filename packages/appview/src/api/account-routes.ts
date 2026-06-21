// XRPC handlers for dev.cocore.account.* (API-key management), served
// by the AppView and backed by the operational AccountStore.
//
// Auth: atproto service-auth only. A client calls the method through
// its PDS's service proxy (`atproto-proxy: <appviewDid>#cocore_appview`);
// the PDS mints a JWT signed by the user's repo key, which we verify
// with `verifyServiceAuthToken`. The authenticated DID scopes every
// operation, so a caller can only ever touch their own keys.
//
// Authored as an @effect/platform `HttpRouter`: every route is an Effect
// returning an `HttpServerResponse` (`ok`/`err`), closing over the
// operational `AccountStore` and the service-auth `appviewDid` audience
// (dependency injection by closure — no Context tags). Each route carries
// an `appview.account.<op>` span. listApiKeys/createApiKey are mounted
// with `HttpRouter.all` + an explicit method check so a wrong-method call
// still yields 405 (the rest are single-method `get`/`post` routes).

import { HttpRouter, HttpServerRequest } from "@effect/platform";
import { Effect } from "effect";

import { verifyServiceAuthToken } from "../auth/service-auth.ts";
import type { AccountStore, ApiKeyRow } from "../operational/account-store.ts";
import { bearer, err, jsonBody, ok } from "./http-app.ts";

/** Shape an {@link ApiKeyRow} into the `dev.cocore.account.defs#apiKeyView`
 *  wire form: never the secret, and null optionals dropped (absent, not
 *  null) so the JSON matches the lexicon. */
function apiKeyView(row: ApiKeyRow): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: row.id,
    did: row.did,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt,
  };
  if (row.expiresAt) view.expiresAt = row.expiresAt;
  if (row.revokedAt) view.revokedAt = row.revokedAt;
  if (row.lastUsedAt) view.lastUsedAt = row.lastUsedAt;
  return view;
}

/** The four account methods as an `HttpRouter`, scoped to `appviewDid` as
 *  the service-auth audience and `store` as the key backend. Mount into the
 *  AppView app. */
export function buildAccountRouter(
  store: AccountStore,
  appviewDid: string,
): HttpRouter.HttpRouter<never, never> {
  const NS = "dev.cocore.account";

  /** Service-auth for `lxm`: yields the authenticated DID, or a 401-shaped
   *  error response carrying the verifier's own status/error/message. */
  const auth = (lxm: string) =>
    Effect.gen(function* () {
      const token = yield* bearer;
      const result = yield* Effect.promise(() =>
        verifyServiceAuthToken(token, { audience: appviewDid, lxm }),
      );
      if (!result.ok) {
        return {
          ok: false as const,
          response: err(result.status, { error: result.error, message: result.message }),
        };
      }
      return { ok: true as const, did: result.did };
    });

  /** Parse the shared `{ id }` body for revoke/delete; yields the id, or a
   *  400-shaped error response on a bad body or a missing/oversize id. */
  const readKeyId = Effect.gen(function* () {
    const parsed = yield* Effect.either(jsonBody);
    if (parsed._tag === "Left") {
      return {
        ok: false as const,
        response: err(400, { error: "InvalidRequest", message: parsed.left.message }),
      };
    }
    const body = parsed.right as { id?: unknown };
    if (typeof body.id !== "string" || body.id.length < 1 || body.id.length > 200) {
      return {
        ok: false as const,
        response: err(400, {
          error: "InvalidRequest",
          message: "id must be a string of length 1..200",
        }),
      };
    }
    return { ok: true as const, id: body.id };
  });

  return HttpRouter.empty.pipe(
    HttpRouter.all(
      `/xrpc/${NS}.listApiKeys`,
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest;
        if (req.method !== "GET") {
          return err(405, { error: "MethodNotAllowed", message: "expected HTTP GET" });
        }
        const a = yield* auth(`${NS}.listApiKeys`);
        if (!a.ok) return a.response;
        return ok({ keys: store.listKeysForDid(a.did).map(apiKeyView) });
      }).pipe(Effect.withSpan("appview.account.listKeys")),
    ),
    HttpRouter.all(
      `/xrpc/${NS}.createApiKey`,
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest;
        if (req.method !== "POST") {
          return err(405, { error: "MethodNotAllowed", message: "expected HTTP POST" });
        }
        const a = yield* auth(`${NS}.createApiKey`);
        if (!a.ok) return a.response;
        const parsed = yield* Effect.either(jsonBody);
        if (parsed._tag === "Left") {
          return err(400, { error: "InvalidRequest", message: parsed.left.message });
        }
        const body = parsed.right as { name?: unknown; expiresAt?: unknown };
        if (typeof body.name !== "string" || body.name.length < 1 || body.name.length > 100) {
          return err(400, {
            error: "InvalidRequest",
            message: "name must be a string of length 1..100",
          });
        }
        if (
          body.expiresAt !== undefined &&
          body.expiresAt !== null &&
          typeof body.expiresAt !== "string"
        ) {
          return err(400, {
            error: "InvalidRequest",
            message: "expiresAt must be an RFC3339 string when provided",
          });
        }
        const { key, secret } = store.createKey({
          did: a.did,
          name: body.name,
          expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
        });
        return ok({ key: apiKeyView(key), secret });
      }).pipe(Effect.withSpan("appview.account.createKey")),
    ),
    HttpRouter.post(
      `/xrpc/${NS}.revokeApiKey`,
      Effect.gen(function* () {
        const a = yield* auth(`${NS}.revokeApiKey`);
        if (!a.ok) return a.response;
        const k = yield* readKeyId;
        if (!k.ok) return k.response;
        return ok({ revoked: store.revokeKey({ id: k.id, did: a.did }) });
      }).pipe(Effect.withSpan("appview.account.revokeKey")),
    ),
    HttpRouter.post(
      `/xrpc/${NS}.deleteApiKey`,
      Effect.gen(function* () {
        const a = yield* auth(`${NS}.deleteApiKey`);
        if (!a.ok) return a.response;
        const k = yield* readKeyId;
        if (!k.ok) return k.response;
        return ok({ deleted: store.deleteKey({ id: k.id, did: a.did }) });
      }).pipe(Effect.withSpan("appview.account.deleteKey")),
    ),
  );
}
