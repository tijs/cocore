import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "vitest";

import { Store } from "../store.ts";
import { withAppviewServer } from "./http-app.ts";
import { buildReadRouter } from "./read-router.ts";

function freshStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "cocore-readrouter-"));
  return new Store(join(dir, "appview.db"));
}

test("read router serves listProviders + getProfile validation over the platform serve-model", async () => {
  const store = freshStore();
  store.upsert({
    uri: "at://did:plc:p/dev.cocore.compute.provider/1",
    cid: "bafyreigh2akiscaildc5sgz5wybizysiehxiv4dhpwwqouytxnvgkpkcaq",
    collection: "dev.cocore.compute.provider",
    repo: "did:plc:p",
    rkey: "1",
    body: { model: "m" },
  });

  await withAppviewServer(buildReadRouter(store), async (base) => {
    const providers = await fetch(`${base}/xrpc/dev.cocore.compute.listProviders`);
    assert.equal(providers.status, 200);
    const body = (await providers.json()) as { providers: Array<{ repo: string }> };
    assert.equal(body.providers.length, 1);
    assert.equal(body.providers[0]!.repo, "did:plc:p");

    // Missing/invalid did → typed BadRequest → 400.
    const bad = await fetch(`${base}/xrpc/dev.cocore.account.getProfile`);
    assert.equal(bad.status, 400);

    // Unknown DID with no footprint → typed NotFound → 404.
    const missing = await fetch(
      `${base}/xrpc/dev.cocore.account.getProfile?did=${encodeURIComponent("did:plc:nope")}`,
    );
    assert.equal(missing.status, 404);

    // Unmatched route → platform's automatic 404.
    const noroute = await fetch(`${base}/nope`);
    assert.equal(noroute.status, 404);
  });
});
