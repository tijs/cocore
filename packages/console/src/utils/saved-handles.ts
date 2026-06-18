// Saved-handles cookie. Lets the login page show recently used
// accounts as one-tap sign-in cards. Stored as a JSON array under a
// non-HttpOnly cookie so both the SSR loader and the browser can
// read/write it. The cookie is *convenience only* — losing it just
// means the user types their handle again. The auth session itself
// lives in `AUTH_SESSION_TOKEN_COOKIE` (HttpOnly).

const SAVED_HANDLES_COOKIE_NAME = "cocore-saved-handles:v1";

const SAVED_HANDLES_LIMIT = 5;

export interface SavedHandle {
  handle: string;
  avatar: string | null;
  /** Unix epoch ms; sorted descending so most-recent appears first. */
  lastUsed: number;
}

function isSavedHandle(value: unknown): value is SavedHandle {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["handle"] === "string" &&
    (v["avatar"] === null || typeof v["avatar"] === "string") &&
    typeof v["lastUsed"] === "number"
  );
}

function decodeCookieValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseSavedHandlesValue(raw: string | undefined): Array<SavedHandle> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeCookieValue(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedHandle).slice(0, SAVED_HANDLES_LIMIT);
  } catch {
    return [];
  }
}

function readCookieValueFromHeader(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return trimmed.slice(eq + 1);
    }
  }
  return undefined;
}

/** Server-side: read saved handles from the request `Cookie` header. */
export function getSavedHandlesFromCookieHeader(
  cookieHeader: string | null | undefined,
): Array<SavedHandle> {
  return parseSavedHandlesValue(readCookieValueFromHeader(cookieHeader, SAVED_HANDLES_COOKIE_NAME));
}

/** Client-side: read saved handles from `document.cookie`. */
function getSavedHandlesFromDocument(): Array<SavedHandle> {
  if (typeof document === "undefined") return [];
  return parseSavedHandlesValue(
    readCookieValueFromHeader(document.cookie, SAVED_HANDLES_COOKIE_NAME),
  );
}

/**
 * Client-side: prepend a handle (deduped by handle) to the saved list,
 * persist back to `document.cookie`, and return the new list. No-op on
 * the server.
 */
export function saveHandle(handle: string, avatar: string | null): Array<SavedHandle> {
  if (typeof document === "undefined") return [];

  const trimmed = handle.trim().replace(/^@/, "");
  if (trimmed === "") return getSavedHandlesFromDocument();

  const existing = getSavedHandlesFromDocument().filter((h) => h.handle !== trimmed);
  const updated = [{ handle: trimmed, avatar, lastUsed: Date.now() }, ...existing]
    .toSorted((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, SAVED_HANDLES_LIMIT);

  const isHttps =
    typeof globalThis.location !== "undefined" && globalThis.location.protocol === "https:";
  const maxAgeSeconds = 365 * 24 * 60 * 60;
  const value = encodeURIComponent(JSON.stringify(updated));
  const attributes = [
    `${SAVED_HANDLES_COOKIE_NAME}=${value}`,
    `Path=/`,
    `SameSite=Lax`,
    `Max-Age=${String(maxAgeSeconds)}`,
    ...(isHttps ? ["Secure"] : []),
  ].join("; ");

  document.cookie = attributes;

  return updated;
}
