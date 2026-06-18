// Pure-function unit test for the dedup ranking logic.
// dedupMyProviderRecords does network I/O against the user's PDS,
// so we can't exercise it end-to-end without a paired test PDS.
// Instead we test the same grouping + selection logic via a small
// pure helper that mirrors `sameMachineGroupKey` + the ranking loop.
//
// Grouping is by machineLabel FIRST (a reinstalled Mac re-keys its
// software identity, so attestationPubKey changes every reinstall and
// can't collapse the duplicates); attestationPubKey is the fallback
// when there's no label.

import assert from "node:assert/strict";
import { test } from "vitest";

interface Row {
  rkey: string;
  cid: string;
  value: Record<string, unknown>;
}

function sameMachineGroupKey(value: Record<string, unknown>): string | null {
  const label = value["machineLabel"];
  if (typeof label === "string" && label.length > 0) return `label:${label}`;
  const key = value["attestationPubKey"];
  if (typeof key === "string" && key.length > 0) return `key:${key}`;
  return null;
}

/** A faithful copy of dedupMyProviderRecords' grouping + selection
 *  logic, with the network I/O replaced by an in-memory list. */
function dedupRanking(all: Row[]): { kept: string[]; deleted: string[] } {
  const groups = new Map<string, Array<{ rkey: string; createdAt: string }>>();
  const kept: string[] = [];
  for (const r of all) {
    const gk = sameMachineGroupKey(r.value);
    if (gk === null) {
      kept.push(r.rkey);
      continue;
    }
    const createdAt =
      typeof r.value["createdAt"] === "string" ? (r.value["createdAt"] as string) : "";
    const list = groups.get(gk) ?? [];
    list.push({ rkey: r.rkey, createdAt });
    groups.set(gk, list);
  }
  const deleted: string[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));
    const [winner, ...losers] = list;
    if (!winner) continue;
    kept.push(winner.rkey);
    for (const l of losers) deleted.push(l.rkey);
  }
  return { kept, deleted };
}

/** A record for machine `label`, with a per-install `attestationPubKey`
 *  (defaults to a unique key so we exercise the realistic "reinstall
 *  re-keyed the machine" case). */
function row(
  rkey: string,
  label: string,
  createdAt: string,
  attestationPubKey = `key-${rkey}`,
): Row {
  return {
    rkey,
    cid: `cid-${rkey}`,
    value: { machineLabel: label, attestationPubKey, createdAt },
  };
}

test("collapses reinstall duplicates: same machineLabel, DIFFERENT keys", () => {
  // The user's actual case — one Mac reinstalled 4×, each with a fresh
  // software key. They must collapse to the newest despite differing keys.
  const r = dedupRanking([
    row("a", "Mac-Mini-1.local", "2026-05-01T00:00:00Z"),
    row("b", "Mac-Mini-1.local", "2026-05-04T00:00:00Z"), // newest = current install
    row("c", "Mac-Mini-1.local", "2026-05-02T00:00:00Z"),
    row("d", "Mac-Studio.local", "2026-05-01T00:00:00Z"), // a different machine, kept
  ]);
  assert.deepEqual(r.kept.sort(), ["b", "d"]);
  assert.deepEqual(r.deleted.sort(), ["a", "c"]);
});

test("100 reinstall duplicates of one machine collapse to 1 (newest)", () => {
  const records: Row[] = [];
  for (let i = 0; i < 100; i += 1) {
    records.push(
      row(`r${i}`, "Mac-Mini-1.local", `2026-05-01T${String(i).padStart(2, "0")}:00:00Z`),
    );
  }
  const r = dedupRanking(records);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0], "r99");
  assert.equal(r.deleted.length, 99);
});

test("falls back to attestationPubKey when a record has no machineLabel", () => {
  const noLabel = (rkey: string, key: string, createdAt: string): Row => ({
    rkey,
    cid: `cid-${rkey}`,
    value: { attestationPubKey: key, createdAt },
  });
  const r = dedupRanking([
    noLabel("a", "KEY-X", "2026-05-01T00:00:00Z"),
    noLabel("b", "KEY-X", "2026-05-02T00:00:00Z"), // same key → same machine
  ]);
  assert.deepEqual(r.kept, ["b"]);
  assert.deepEqual(r.deleted, ["a"]);
});

test("records with neither label nor key are kept as-is", () => {
  const stranger: Row = { rkey: "stranger", cid: "cid-stranger", value: {} };
  const r = dedupRanking([
    row("a", "Mac-Mini-1.local", "2026-05-01T00:00:00Z"),
    row("b", "Mac-Mini-1.local", "2026-05-02T00:00:00Z"),
    stranger,
  ]);
  assert.ok(r.kept.includes("stranger"), "no-identity row preserved");
  assert.ok(r.kept.includes("b"));
  assert.deepEqual(r.deleted, ["a"]);
});

test("distinct machines are never collapsed", () => {
  const r = dedupRanking([
    row("a", "Mac-A.local", "2026-05-01T00:00:00Z"),
    row("b", "Mac-B.local", "2026-05-01T00:00:00Z"),
    row("c", "Mac-C.local", "2026-05-01T00:00:00Z"),
  ]);
  assert.deepEqual(r.kept.sort(), ["a", "b", "c"]);
  assert.deepEqual(r.deleted, []);
});

test("missing createdAt sorts last (timestamped winner beats unstamped legacy)", () => {
  const legacy: Row = {
    rkey: "legacy",
    cid: "cid-legacy",
    value: { machineLabel: "Mac-Mini-1.local" /* no createdAt */ },
  };
  const r = dedupRanking([legacy, row("modern", "Mac-Mini-1.local", "2026-05-01T00:00:00Z")]);
  assert.deepEqual(r.kept, ["modern"]);
  assert.deepEqual(r.deleted, ["legacy"]);
});
