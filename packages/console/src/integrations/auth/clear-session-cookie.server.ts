import { setCookie } from "@tanstack/react-start/server";

import { AUTH_SESSION_TOKEN_COOKIE } from "@/integrations/auth/constants.ts";
import { authCookieDomain } from "@/integrations/auth/cookie-domain.ts";

/**
 * Expire every scope the session cookie could have been set under: the
 * host-only variant AND, on cocore.dev hosts, the `Domain=cocore.dev` variant.
 *
 * Clearing only the active (domain-scoped) cookie strands the legacy host-only
 * cookie left over from the host-only → `Domain=cocore.dev` cutover (commit
 * bcf24d5). That orphan sorts first in the `Cookie:` header and shadows every
 * future login, producing a permanent "logged out despite logging in" loop
 * that previously only a manual "clear cookies" could fix. h3's `setCookie`
 * de-dupes by `name;domain;path`, so emitting one clear with `Domain` and one
 * without yields two distinct `Set-Cookie` headers — both variants get dropped.
 */
export function clearAllAuthSessionCookies(requestUrl: string): void {
  const isSecure = requestUrl.startsWith("https://");
  const cookieDomain = authCookieDomain(new URL(requestUrl).host);
  const base = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 0,
    ...(isSecure ? { secure: true } : {}),
  };
  // Host-only variant (no Domain) — the legacy/orphan cookie.
  setCookie(AUTH_SESSION_TOKEN_COOKIE, "", base);
  // Domain-scoped variant (the one current logins set), when applicable.
  if (cookieDomain) {
    setCookie(AUTH_SESSION_TOKEN_COOKIE, "", { ...base, domain: cookieDomain });
  }
}
