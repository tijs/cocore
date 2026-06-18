// SQLite-backed implementation of @atcute/oauth-node-client's
// SessionStore. The default `MemoryStore` evaporates on every console
// restart — fine while the only consumer was the cookie session, but
// API keys now reference these sessions by DID and have to keep
// working across deploys.
//
// Each call to `OAuthSession.handle()` will hit `set()` here whenever
// it refreshes a token, so this store also serves as the persistence
// hook for token rotation.
//
// Note: StoredSession contains the DPoP private key. Treat the DB
// file as a credentials store; mount it on a non-public volume.

import type { Did } from "@atcute/lexicons";
import type { StoredSession } from "@atcute/oauth-node-client";
import type { Store } from "@atcute/oauth-node-client";

import { consoleDb } from "@/lib/console-db.server.ts";

export class SqliteOauthSessionStore implements Store<Did, StoredSession> {
  get(key: Did): StoredSession | undefined {
    const row = consoleDb().prepare(`SELECT data FROM oauth_sessions WHERE did = ?`).get(key) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.data) as StoredSession;
    } catch {
      return undefined;
    }
  }

  set(key: Did, value: StoredSession): void {
    consoleDb()
      .prepare(
        `INSERT INTO oauth_sessions (did, data, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(did) DO UPDATE SET
           data = excluded.data,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(key, JSON.stringify(value));
  }

  delete(key: Did): void {
    consoleDb().prepare(`DELETE FROM oauth_sessions WHERE did = ?`).run(key);
  }

  clear(): void {
    consoleDb().prepare(`DELETE FROM oauth_sessions`).run();
  }
}
