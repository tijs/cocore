// End-to-end: publish a real cocore record to a real PDS, prove
// the AppView's Indexer receives it via the real
// com.atproto.sync.subscribeRepos firehose.
//
// This is the milestone test. Until this passes, the federation
// invariants are proved against an in-memory pub/sub. Once it
// passes, two AppView operators running the same RelayFirehose
// against the same relay arrive at byte-identical state.

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AtpAgent } from "@atproto/api";
import { TestNetworkNoAppView } from "@atproto/dev-env";
import { Firehose as CocoreFirehose } from "@cocore/sdk";
import { RelayFirehose } from "../indexer/relay-firehose.ts";
import { Indexer } from "../indexer/index.ts";
import { Store } from "../store.ts";

function newStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "cocore-fh-int-"));
  return new Store(join(dir, "appview.db"));
}

test("record published to a real PDS reaches the Indexer via the relay firehose", async () => {
  const net = await TestNetworkNoAppView.create({});
  try {
    // 1. Stand up the AppView side: an in-process cocore Firehose
    //    feeding an Indexer-backed Store. RelayFirehose pumps the
    //    real WS subscription into it.
    const cocoreFh = new CocoreFirehose();
    const indexer = new Indexer(newStore());
    indexer.subscribe(cocoreFh);

    const wsUrl = net.pds.url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const relay = new RelayFirehose({
      service: wsUrl,
      out: cocoreFh,
      // Test PDS uses ephemeral DIDs the upstream IdResolver can't
      // reach; commit auth is meaningful in production but not here.
      unauthenticatedCommits: true,
    });
    relay.start();

    // 2. Stand up the publishing side: an account on the test PDS
    //    that writes a real `dev.cocore.compute.provider` record.
    const agent = new AtpAgent({ service: net.pds.url });
    await agent.com.atproto.server.createAccount({
      email: "firehose-int@cocore.test",
      handle: "firehose-int.test",
      password: "pwpwpwpw",
    });
    await agent.login({ identifier: "firehose-int.test", password: "pwpwpwpw" });

    const providerRecord = {
      machineLabel: "M3 Max test rig",
      chip: "Apple M3 Max",
      ramGB: 64,
      supportedModels: ["llama-3.1-70b"],
      priceList: [
        {
          modelId: "llama-3.1-70b",
          inputPricePerMTok: 50,
          outputPricePerMTok: 200,
          currency: "USD",
        },
      ],
      encryptionPubKey: "AAAA",
      attestationPubKey: "BBBB",
      trustLevel: "self-attested",
      createdAt: new Date().toISOString(),
    };

    // Give the firehose a moment to connect before we publish.
    await sleep(300);

    const created = await agent.com.atproto.repo.createRecord({
      repo: agent.session!.did,
      collection: "dev.cocore.compute.provider",
      record: providerRecord,
    });
    const expectedUri = created.data.uri;

    // 3. Wait for the Indexer to see the record. The dev PDS emits
    //    the #commit within ms; we give it 5s of slack for jitter.
    const deadline = Date.now() + 5000;
    let row: ReturnType<Store["get"]> = null;
    while (Date.now() < deadline) {
      row = indexer.store.get(expectedUri);
      if (row) break;
      await sleep(50);
    }
    assert.ok(row, `Indexer did not receive record at ${expectedUri} within 5s`);
    assert.equal(row.collection, "dev.cocore.compute.provider");
    assert.equal(row.repo, agent.session!.did);
    const body = row.body as { machineLabel: string; chip: string };
    assert.equal(body.machineLabel, "M3 Max test rig");
    assert.equal(body.chip, "Apple M3 Max");

    await relay.stop();
  } finally {
    await net.close();
  }
});

test("two Indexers on the same relay see byte-identical state", async () => {
  const net = await TestNetworkNoAppView.create({});
  try {
    // Two independent cocore Firehoses + Indexers, both subscribed
    // to the same upstream relay. After publishing one record,
    // both stores must carry it with the same uri/cid/body.
    const fhA = new CocoreFirehose();
    const fhB = new CocoreFirehose();
    const indexerA = new Indexer(newStore());
    const indexerB = new Indexer(newStore());
    indexerA.subscribe(fhA);
    indexerB.subscribe(fhB);

    const wsUrl = net.pds.url.replace(/^http:/, "ws:");
    const relayA = new RelayFirehose({ service: wsUrl, out: fhA, unauthenticatedCommits: true });
    const relayB = new RelayFirehose({ service: wsUrl, out: fhB, unauthenticatedCommits: true });
    relayA.start();
    relayB.start();

    const agent = new AtpAgent({ service: net.pds.url });
    await agent.com.atproto.server.createAccount({
      email: "fed@cocore.test",
      handle: "fed-fh.test",
      password: "pwpwpwpw",
    });
    await agent.login({ identifier: "fed-fh.test", password: "pwpwpwpw" });

    await sleep(400);

    const att = {
      publicKey: "AAAA",
      encryptionPubKey: "XXXX",
      chipName: "Apple M3 Max",
      hardwareModel: "Mac15,8",
      serialNumberHash: "d".repeat(64),
      osVersion: "15.0",
      binaryHash: "e".repeat(64),
      sipEnabled: true,
      secureBootEnabled: true,
      secureEnclaveAvailable: true,
      authenticatedRootEnabled: true,
      selfSignature: new Uint8Array([1, 2, 3, 4]),
      attestedAt: "2026-05-08T00:00:00.000Z",
      expiresAt: "2026-05-09T00:00:00.000Z",
    };
    const created = await agent.com.atproto.repo.createRecord({
      repo: agent.session!.did,
      collection: "dev.cocore.compute.attestation",
      record: att,
    });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (indexerA.store.get(created.data.uri) && indexerB.store.get(created.data.uri)) break;
      await sleep(50);
    }
    const a = indexerA.store.get(created.data.uri);
    const b = indexerB.store.get(created.data.uri);
    assert.ok(a && b, "both indexers must see the record");
    assert.equal(a.uri, b.uri);
    assert.equal(a.cid, b.cid);
    assert.equal(JSON.stringify(a.body), JSON.stringify(b.body));

    await relayA.stop();
    await relayB.stop();
  } finally {
    await net.close();
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
