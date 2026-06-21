import { createMiddleware } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { runTraced } from "@/lib/o11y.server.ts";
import { atprotoSessionForRequestEffect } from "@/middleware/auth.server.ts";
import { getSafePostLoginRedirect } from "@/utils/auth-redirect.ts";

export type { AtprotoSessionContext } from "@/middleware/auth.server.ts";

export const unauthMiddleware = createMiddleware().server(async ({ next }) => {
  const request = getRequest();
  const context = await runTraced(
    "auth.sessionForRequest",
    atprotoSessionForRequestEffect(request),
  );

  if (context) {
    throw redirect({ to: "/machines" });
  }

  return await next();
});

export const authMiddleware = createMiddleware().server(async ({ next }) => {
  const request = getRequest();
  const context = await runTraced(
    "auth.sessionForRequest",
    atprotoSessionForRequestEffect(request),
  );

  if (!context) {
    throw redirect({
      to: "/login",
      search: { redirect: getSafePostLoginRedirect(request) },
    });
  }

  return await next({ context });
});
