import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../store.ts";
import { AccountStore } from "../operational/account-store.ts";
import { buildAppviewApp } from "./server.ts";
import { withAppviewServer } from "./http-app.ts";

const APPVIEW_DID = "did:web:appview.test";

function setup(): { store: Store; accountStore: AccountStore } {
  const dir = mkdtempSync(join(tmpdir(), "cocore-agent-status-"));
  return {
    store: new Store(join(dir, "appview.db")),
    accountStore: new AccountStore(join(dir, "account.db")),
  };
}

interface StatusBody {
  did: string;
  currency: string;
  balance: number | null;
  earned24h: number;
  trustLevel: string | null;
  agentVersion: string | null;
}

test("GET /api/agent/status: 401 without a bearer key", async () => {
  const { store, accountStore } = setup();
  await withAppviewServer(
    buildAppviewApp(store, { accountStore, appviewDid: APPVIEW_DID }),
    async (base) => {
      const res = await fetch(`${base}/api/agent/status`);
      assert.equal(res.status, 401);
    },
  );
});

test("GET /api/agent/status: 401 for an unknown key", async () => {
  const { store, accountStore } = setup();
  await withAppviewServer(
    buildAppviewApp(store, { accountStore, appviewDid: APPVIEW_DID }),
    async (base) => {
      const res = await fetch(`${base}/api/agent/status`, {
        headers: { authorization: "Bearer cocore-totally-bogus" },
      });
      assert.equal(res.status, 401);
    },
  );
});

test("GET /api/agent/status: resolves an AppView-minted key and reports provider status", async () => {
  const { store, accountStore } = setup();
  const did = "did:plc:provider1";
  const { secret } = accountStore.createKey({ did, name: "test machine" });
  store.upsert({
    uri: `at://${did}/dev.cocore.compute.provider/m1`,
    cid: "cid-prov",
    collection: "dev.cocore.compute.provider",
    repo: did,
    rkey: "m1",
    body: { trustLevel: "hardware-attested", binaryVersion: "1.2.3" },
  });
  await withAppviewServer(
    buildAppviewApp(store, { accountStore, appviewDid: APPVIEW_DID }),
    async (base) => {
      const res = await fetch(`${base}/api/agent/status`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as StatusBody;
      assert.equal(body.did, did);
      assert.equal(body.currency, "credits");
      assert.equal(body.trustLevel, "hardware-attested");
      assert.equal(body.agentVersion, "1.2.3");
      // No bridgeUrl wired in the test → ledger reads degrade, not throw.
      assert.equal(body.earned24h, 0);
      assert.equal(body.balance, null);
    },
  );
});

test("GET /agent/status (no /api prefix) is also served", async () => {
  const { store, accountStore } = setup();
  const did = "did:plc:provider2";
  const { secret } = accountStore.createKey({ did, name: "test machine" });
  await withAppviewServer(
    buildAppviewApp(store, { accountStore, appviewDid: APPVIEW_DID }),
    async (base) => {
      const res = await fetch(`${base}/agent/status`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as StatusBody;
      assert.equal(body.did, did);
      assert.equal(body.trustLevel, null);
      assert.equal(body.agentVersion, null);
    },
  );
});
