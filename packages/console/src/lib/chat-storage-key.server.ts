import { createHmac } from "node:crypto";

/** Stable dev-only fallback. Unreachable in production by construction —
 *  see chatStorageSecret(), which fails closed rather than returning this. */
const DEV_FALLBACK_SECRET = "cocore-local-chat-storage-dev-only";

/** Below this, a secret is not meaningfully stronger than the public dev
 *  fallback, so we reject it in production rather than offering false safety. */
const MIN_SECRET_LENGTH = 32;

function chatStorageSecret(): string {
  const fromEnv = process.env["COCORE_CHAT_STORAGE_SECRET"]?.trim();

  // Fail closed in production: a missing or weak secret must never silently
  // downgrade to the public dev fallback, which would let anyone with the
  // source derive every user's per-DID chat key.
  if (process.env["NODE_ENV"] === "production") {
    if (!fromEnv) {
      throw new Error(
        "COCORE_CHAT_STORAGE_SECRET is required in production; refusing to derive chat keys from the public dev fallback.",
      );
    }
    if (fromEnv.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `COCORE_CHAT_STORAGE_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${fromEnv.length}).`,
      );
    }
    return fromEnv;
  }

  // Non-production: prefer a real secret if set, else the dev fallback.
  return fromEnv || DEV_FALLBACK_SECRET;
}

/** Per-DID AES-256 key (base64url) returned to the signed-in browser.
 *  Derived server-side so another account on the same device cannot
 *  decrypt this user's local chat blob without an authenticated session. */
export function deriveChatStorageKey(did: string): string {
  return createHmac("sha256", chatStorageSecret())
    .update(`cocore:chat-storage:v1:${did}`)
    .digest("base64url");
}
