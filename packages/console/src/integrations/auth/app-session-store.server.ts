// Persistent app-session store.
//
// "App session" = the opaque cookie token the browser presents on
// every request. The token resolves to a DID; the DID resolves to an
// OAuth session in `oauth_sessions`. Without persistence here, the
// cookie outlives the deploy but the lookup table doesn't, so a
// redeploy looks identical to the user as "you got logged out a few
// minutes after signing in." That's the bug this file fixes.
//
// Two-layer story (intentional):
//   * `oauth_sessions` (PR #66) — DID → DPoP key + access/refresh
//     tokens. Survives restart so API keys keep working.
//   * `app_sessions` (this file) — cookie token → DID. Survives
//     restart so the browser stays signed in across deploys.
//
// Server-only: imports better-sqlite3 via consoleDb. The `.server.ts`
// suffix gates this file behind TanStack Start's import-protection
// plugin so a stray client import fails the build.

import { consoleDb } from "@/lib/console-db.server.ts";

const APP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface AppSessionRow {
  did: string;
  expires_at_ms: number;
}

export function issueAppSession(did: string): string {
  const token = crypto.randomUUID();
  consoleDb()
    .prepare(`INSERT INTO app_sessions(token, did, created_at, expires_at_ms) VALUES (?, ?, ?, ?)`)
    .run(token, did, new Date().toISOString(), Date.now() + APP_SESSION_TTL_MS);
  return token;
}

export function resolveAppSessionToken(token: string | undefined): { did: string } | undefined {
  if (!token) return undefined;
  const row = consoleDb()
    .prepare(`SELECT did, expires_at_ms FROM app_sessions WHERE token = ?`)
    .get(token) as AppSessionRow | undefined;
  if (!row) return undefined;
  if (row.expires_at_ms <= Date.now()) {
    consoleDb().prepare(`DELETE FROM app_sessions WHERE token = ?`).run(token);
    return undefined;
  }
  return { did: row.did };
}

export function revokeAppSession(token: string | undefined): void {
  if (!token) return;
  consoleDb().prepare(`DELETE FROM app_sessions WHERE token = ?`).run(token);
}
