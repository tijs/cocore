// Pins the "stay signed in across deploys" property: a token issued
// before the process exits MUST resolve to the same DID after the DB
// is closed and reopened. The pre-PR store was an in-memory Map and
// dropped this property on every Railway redeploy, which presented to
// the user as "logged out a few minutes after signing in."

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vitest";

import { _resetConsoleDbCache } from "@/lib/console-db.server.ts";
import {
  issueAppSession,
  resolveAppSessionToken,
  revokeAppSession,
} from "./app-session-store.server.ts";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cocore-app-session-test-"));
  dbPath = join(tmpDir, "console.sqlite");
  process.env["COCORE_CONSOLE_DB"] = dbPath;
  _resetConsoleDbCache();
});

afterEach(() => {
  _resetConsoleDbCache();
  delete process.env["COCORE_CONSOLE_DB"];
  rmSync(tmpDir, { recursive: true, force: true });
});

test("issue + resolve round-trips a DID", () => {
  const token = issueAppSession("did:plc:alice");
  assert.deepEqual(resolveAppSessionToken(token), { did: "did:plc:alice" });
});

test("resolve of an unknown token returns undefined", () => {
  assert.equal(resolveAppSessionToken("nope"), undefined);
  assert.equal(resolveAppSessionToken(undefined), undefined);
});

test("revoke removes the row so subsequent resolves miss", () => {
  const token = issueAppSession("did:plc:alice");
  revokeAppSession(token);
  assert.equal(resolveAppSessionToken(token), undefined);
});

test("survives a process restart (close + reopen the DB) — the deploy bug", () => {
  // Issue under one DB connection.
  const token = issueAppSession("did:plc:alice");

  // Simulate a process restart: drop the cached connection. The
  // next consoleDb() call reopens the same file and re-runs the
  // schema. If the row didn't actually persist, the next resolve
  // returns undefined — which is exactly the symptom users saw.
  _resetConsoleDbCache();

  assert.deepEqual(resolveAppSessionToken(token), { did: "did:plc:alice" });
});
