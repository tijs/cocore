import { AUTH_SESSION_TOKEN_COOKIE } from "@/integrations/auth/constants.ts";

/** Coerce runtime header values (`string`, `string[]`, etc.) into a single Cookie header line. */
function normalizeCookieHeaderInput(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) {
    const parts = value.filter((x): x is string => typeof x === "string");
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
  return undefined;
}

/**
 * All raw values for `AUTH_SESSION_TOKEN_COOKIE` in the `Cookie:` header, in
 * header order (no decoding).
 *
 * A browser sends multiple cookies with the same name when the same name was
 * set under different scopes — which is exactly what happened across the
 * host-only → `Domain=cocore.dev` cutover (commit bcf24d5): users who logged
 * in before the change keep a stale host-only `cocore-auth.session_token`, and
 * a later login adds a second `.cocore.dev`-scoped one. RFC 6265 sorts the
 * older host-only cookie first, so reading only the first value resolves the
 * stale token and looks like "logged out despite logging in." Callers should
 * try every candidate and use the first that resolves to a live session.
 */
export function readAllAuthSessionTokens(cookieHeader: unknown): string[] {
  const raw = normalizeCookieHeaderInput(cookieHeader);
  if (raw === undefined) return [];
  const tokens: string[] = [];
  for (const pair of raw.split("; ")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const name = pair.slice(0, eqIdx);
    if (name === AUTH_SESSION_TOKEN_COOKIE) {
      tokens.push(pair.slice(eqIdx + 1));
    }
  }
  return tokens;
}

/** First raw value for `AUTH_SESSION_TOKEN_COOKIE` from `Cookie:` header (no decoding). */
export function readAuthSessionToken(cookieHeader: unknown): string | undefined {
  return readAllAuthSessionTokens(cookieHeader)[0];
}
