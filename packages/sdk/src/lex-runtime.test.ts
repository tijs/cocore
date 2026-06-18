// Drift guard: every JSON file we ship under lexicons/dev/cocore/compute
// MUST be in both the runtime registry and the public ids map. This
// test exists because the registry is a hand-maintained list of
// imports — easy to forget to extend when adding a new lexicon.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import assert from "node:assert/strict";

import { ids, schemas } from "./lex-runtime.ts";

const LEX_DIR = fileURLToPath(new URL("../../../lexicons/dev/cocore/compute/", import.meta.url));

function nsidsOnDisk(): string[] {
  return readdirSync(LEX_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = readFileSync(join(LEX_DIR, f), "utf-8");
      const doc = JSON.parse(raw) as { id?: unknown };
      assert.equal(typeof doc.id, "string", `${f} missing id`);
      return doc.id as string;
    })
    .sort();
}

test("lex-runtime registry contains every on-disk lexicon", () => {
  const onDisk = nsidsOnDisk();
  // Restrict to dev.cocore.* — the registry also bundles
  // com.atproto.repo.strongRef as a vendored stub, which has no
  // matching JSON file under lexicons/.
  const inRegistry = schemas
    .map((s) => s.id)
    .filter((id) => id.startsWith("dev.cocore."))
    .sort();
  // Use deepEqual on sorted arrays so the test failure message names
  // the missing/extra NSID, not just "not equal".
  assert.deepEqual(inRegistry, onDisk);
});

test("lex-runtime ids map covers every on-disk lexicon", () => {
  const onDisk = new Set<string>(nsidsOnDisk());
  // ids has narrow literal-string types; widen to string here so we
  // can compare against on-disk filenames symmetrically.
  const inIds = new Set<string>(Object.values(ids));
  for (const nsid of onDisk) {
    assert.ok(inIds.has(nsid), `ids map missing ${nsid}`);
  }
  for (const nsid of inIds) {
    assert.ok(onDisk.has(nsid), `ids map has stale entry ${nsid}`);
  }
});
