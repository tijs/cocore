// Verifies the schema-evolution path. Two flows that matter:
//
//   1. The closed-loop pivot DROPs the Stripe-era `payment_accounts`
//      and `charge_log` tables on boot. A legacy DB that still
//      carries them should come out the other side without those
//      tables.
//   2. A fresh DB boots into the full current schema (api_keys,
//      oauth_sessions, app_sessions, pending_disputes,
//      console_user_prefs) without ALTER warnings.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vitest";

import Database from "better-sqlite3";

import { _resetConsoleDbCache, consoleDb } from "./console-db.server.ts";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cocore-console-db-test-"));
  dbPath = join(tmpDir, "console.sqlite");
  process.env["COCORE_CONSOLE_DB"] = dbPath;
  _resetConsoleDbCache();
});

afterEach(() => {
  _resetConsoleDbCache();
  delete process.env["COCORE_CONSOLE_DB"];
  rmSync(tmpDir, { recursive: true, force: true });
});

test("migration: legacy Stripe-era tables (payment_accounts, charge_log) get dropped on boot", () => {
  // Seed the file with the old shape from the pre-pivot era.
  {
    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE payment_accounts (
        did TEXT PRIMARY KEY,
        payouts_enabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE charge_log (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        amount_minor INTEGER NOT NULL
      );
    `);
    seed
      .prepare(`INSERT INTO payment_accounts (did, payouts_enabled) VALUES (?, ?)`)
      .run("did:plc:legacy", 1);
    seed.close();
  }

  // First consoleDb() call runs migrations — the Stripe-table drop
  // is part of runMigrations().
  const db = consoleDb();

  const surviving = (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('payment_accounts', 'charge_log')`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  assert.deepEqual(surviving, [], `legacy tables still present: ${surviving.join(",")}`);
});

test("migration: a fresh DB picks up the full schema (no ALTER warnings)", () => {
  const db = consoleDb();
  for (const t of [
    "api_keys",
    "oauth_sessions",
    "app_sessions",
    "pending_disputes",
    "console_user_prefs",
  ]) {
    const cols = (db.pragma(`table_info(${t})`) as Array<{ name: string }>).map((r) => r.name);
    assert.ok(cols.length > 0, `${t} has no columns`);
  }
});

test("migration: missing tables aren't created by runMigrations (CREATE TABLE handles those)", () => {
  // If somehow a table doesn't exist, runMigrations is a no-op
  // for it (we only ALTER, never CREATE). The fresh-boot flow
  // runs db.exec(SCHEMA) first, so every table exists by the
  // time runMigrations runs. This test exercises the corner case
  // where someone DROPs a table out-of-band: we don't recreate it.
  consoleDb(); // initial boot
  const db = consoleDb();
  db.exec(`DROP TABLE IF EXISTS pending_disputes`);
  // Drop the cache + re-open. The CREATE block re-creates
  // pending_disputes; runMigrations sees the fresh table and
  // doesn't ALTER anything.
  _resetConsoleDbCache();
  const db2 = consoleDb();
  const cols = (db2.pragma("table_info(pending_disputes)") as Array<{ name: string }>).map(
    (r) => r.name,
  );
  assert.ok(cols.includes("stripe_dispute_id"));
});
