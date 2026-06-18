// Per-DID preferences stored only in the console SQLite DB (not on
// ATProto). Keeps ephemeral onboarding flags off the user's PDS.

import { consoleDb } from "@/lib/console-db.server.ts";

export function getStartGuideSeenAt(did: string): string | null {
  const row = consoleDb()
    .prepare(`SELECT start_guide_seen_at FROM console_user_prefs WHERE did = ?`)
    .get(did) as { start_guide_seen_at: string | null } | undefined;
  const v = row?.start_guide_seen_at;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Idempotent: writes the first-seen timestamp once; concurrent-safe. */
export function markStartGuideSeenIfNeeded(did: string): void {
  const now = new Date().toISOString();
  consoleDb()
    .prepare(
      `INSERT INTO console_user_prefs (did, start_guide_seen_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(did) DO UPDATE SET
         start_guide_seen_at = COALESCE(console_user_prefs.start_guide_seen_at, excluded.start_guide_seen_at),
         updated_at = CASE
           WHEN console_user_prefs.start_guide_seen_at IS NULL THEN excluded.updated_at
           ELSE console_user_prefs.updated_at
         END`,
    )
    .run(did, now, now);
}

export function deleteConsoleUserPrefsForDid(did: string): number {
  const r = consoleDb().prepare(`DELETE FROM console_user_prefs WHERE did = ?`).run(did);
  return r.changes;
}
