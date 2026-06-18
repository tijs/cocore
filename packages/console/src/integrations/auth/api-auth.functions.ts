import type { ActorIdentifier } from "@atcute/lexicons";

import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect } from "effect";
import { z } from "zod";

import { atprotoOAuthAuthorizeEffect } from "@/integrations/auth/atproto.server.ts";
import { sanitizeAuthRedirectTarget } from "@/utils/auth-redirect.ts";
import { getSavedHandlesFromCookieHeader } from "@/utils/saved-handles.ts";

const authorizeInputSchema = z.object({
  handle: z.string().min(1, "Handle is required"),
  redirect: z.string().optional(),
});

export type AtprotoAuthorizeInput = z.infer<typeof authorizeInputSchema>;

/** Routes / server-only `beforeLoad` callers. Not for JSX. */
export const atprotoAuthorizeServerFn = createServerFn({ method: "GET" })
  .inputValidator(authorizeInputSchema)
  .handler(async ({ data }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const request = getRequest();
        const normalized = data.handle.replace(/^@/, "").trim() as ActorIdentifier;
        const redirectTarget = sanitizeAuthRedirectTarget(data.redirect ?? undefined, request.url);

        const { url } = yield* atprotoOAuthAuthorizeEffect({
          target: {
            type: "account",
            identifier: normalized,
          },
          state: {
            redirect: redirectTarget,
            handle: normalized,
          },
        });

        return { authorizationUrl: url.toString() };
      }),
    ),
  );

export const atprotoAuthorizeMutationOptions = mutationOptions({
  mutationFn: (variables: AtprotoAuthorizeInput) => atprotoAuthorizeServerFn({ data: variables }),
});

const signupInputSchema = z.object({
  redirect: z.string().optional(),
});

export type AtprotoSignupInput = z.infer<typeof signupInputSchema>;

/** Routes / server-only `beforeLoad` callers. Not for JSX. */
export const atprotoSignupServerFn = createServerFn({ method: "GET" })
  .inputValidator(signupInputSchema)
  .handler(async ({ data }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const request = getRequest();
        const redirectTarget = sanitizeAuthRedirectTarget(data.redirect ?? undefined, request.url);

        const { url } = yield* atprotoOAuthAuthorizeEffect({
          prompt: "create",
          target: {
            type: "pds",
            serviceUrl: "https://selfhosted.social/",
          },
          state: {
            redirect: redirectTarget,
          },
        });

        return { authorizationUrl: url.toString() };
      }),
    ),
  );

export const atprotoSignupMutationOptions = mutationOptions({
  mutationFn: (variables: AtprotoSignupInput) => atprotoSignupServerFn({ data: variables }),
});

/**
 * Server-side reader for the `saved-handles` cookie. The cookie is
 * non-HttpOnly (the browser writes it after a successful sign-in
 * lands), but reading it server-side lets the login route render
 * one-tap "continue as @handle" cards on first paint without a
 * client-only flash.
 */
const getSavedHandlesServerFn = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    Effect.sync(() => {
      const request = getRequest();
      return getSavedHandlesFromCookieHeader(request.headers.get("cookie"));
    }),
  ),
);

export const getSavedHandlesQueryOptions = queryOptions({
  queryKey: ["saved-handles"] as const,
  queryFn: getSavedHandlesServerFn,
});
