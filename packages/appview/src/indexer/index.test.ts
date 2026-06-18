import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../store.ts";
import { Indexer } from "./index.ts";

function newStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "cocore-test-"));
  return new Store(join(dir, "appview.db"));
}

test("ingest stores cocore records", () => {
  const store = newStore();
  const idx = new Indexer(store);
  const ok = idx.ingest({
    uri: "at://did:plc:p/dev.cocore.compute.receipt/1",
    cid: "bafycid",
    collection: "dev.cocore.compute.receipt",
    repo: "did:plc:p",
    rkey: "1",
    record: { model: "m", tokens: { in: 1, out: 1 } },
  });
  assert.equal(ok, true);
  const got = store.get("at://did:plc:p/dev.cocore.compute.receipt/1");
  assert.ok(got);
  assert.equal(got.collection, "dev.cocore.compute.receipt");
});

test("ingest ignores non-cocore collections", () => {
  const store = newStore();
  const idx = new Indexer(store);
  const ok = idx.ingest({
    uri: "at://did:plc:p/app.bsky.feed.post/1",
    cid: "bafycid",
    collection: "app.bsky.feed.post",
    repo: "did:plc:p",
    rkey: "1",
    record: {},
  });
  assert.equal(ok, false);
  assert.equal(store.get("at://did:plc:p/app.bsky.feed.post/1"), null);
});

test("listByCollection returns inserted records", () => {
  const store = newStore();
  const idx = new Indexer(store);
  for (let i = 0; i < 3; i++) {
    idx.ingest({
      uri: `at://did:plc:p/dev.cocore.compute.receipt/${i}`,
      cid: `bafy${i}`,
      collection: "dev.cocore.compute.receipt",
      repo: "did:plc:p",
      rkey: String(i),
      record: { i },
    });
  }
  const all = store.listByCollection("dev.cocore.compute.receipt");
  assert.equal(all.length, 3);
});
