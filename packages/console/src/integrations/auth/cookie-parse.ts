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

/** Raw value for `AUTH_SESSION_TOKEN_COOKIE` from `Cookie:` header (no decoding). */
export function readAuthSessionToken(cookieHeader: unknown): string | undefined {
  const raw = normalizeCookieHeaderInput(cookieHeader);
  if (raw === undefined) return undefined;
  for (const pair of raw.split("; ")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const name = pair.slice(0, eqIdx);
    if (name === AUTH_SESSION_TOKEN_COOKIE) {
      return pair.slice(eqIdx + 1);
    }
  }
  return undefined;
}
