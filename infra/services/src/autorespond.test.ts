// Verifies that the in-process autoresponder closes the loop:
// when a job lands on the firehose, a P-256-signed receipt arrives
// shortly after and verifies against the autoresponder's
// attestation.

import { describe, expect, it } from "vitest";
import {
  Firehose,
  type IndexedRecord,
  type AttestationRecord,
  type JobRecord,
  type ReceiptRecord,
} from "@cocore/sdk";
import { verifyReceiptSignature } from "@cocore/sdk/p256";
import { startAutoresponder } from "./autorespond.ts";

const PROVIDER_DID = "did:plc:test-bridge-autoresponder";
const REQUESTER_DID = "did:plc:test-requester";

function jobIndexed(args: { rkey: string; auth: string }): IndexedRecord<JobRecord> {
  const uri = `at://${REQUESTER_DID}/dev.cocore.compute.job/${args.rkey}`;
  return {
    uri,
    cid: "bafy-job",
    collection: "dev.cocore.compute.job",
    repo: REQUESTER_DID,
    rkey: args.rkey,
    body: {
      model: "test-model",
      inputCommitment: "a".repeat(64),
      maxTokensOut: 256,
      priceCeiling: { amount: 100, currency: "USD" },
      acceptedTrustLevel: "self-attested",
      paymentAuthorization: {
        uri: `at://${REQUESTER_DID}/dev.cocore.compute.paymentAuthorization/${args.auth}`,
        cid: "bafy-auth",
      },
      nonce: "0".repeat(32),
      expiresAt: "2030-01-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
    },
  };
}

describe("startAutoresponder", () => {
  it("publishes one attestation at startup, then a signed receipt per job", async () => {
    const firehose = new Firehose();
    const events: IndexedRecord[] = [];
    firehose.on(null, async (rec) => {
      events.push(rec);
    });

    await startAutoresponder({
      firehose,
      providerDid: PROVIDER_DID,
      tokenRate: { inputPerMTok: 10, outputPerMTok: 10, currency: "USD" },
    });

    // Attestation arrives during startup.
    const att = events.find((e) => e.collection === "dev.cocore.compute.attestation");
    expect(att).toBeDefined();
    expect(att!.repo).toBe(PROVIDER_DID);
    const attBody = att!.body as AttestationRecord;
    expect(attBody.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);

    // Submit a job; expect a receipt that strong-refs that job and is
    // P-256-signed by the attestation's publicKey.
    const job = jobIndexed({ rkey: "job1", auth: "auth1" });
    await firehose.dispatch(job);

    const receiptRec = events.find((e) => e.collection === "dev.cocore.compute.receipt");
    expect(receiptRec).toBeDefined();
    const receipt = receiptRec!.body as ReceiptRecord;

    expect(receipt.job.uri).toBe(job.uri);
    expect(receipt.requester).toBe(REQUESTER_DID);
    expect(receipt.model).toBe(job.body.model);
    expect(receipt.inputCommitment).toBe(job.body.inputCommitment);
    expect(receipt.attestation.uri).toBe(att!.uri);
    expect(receipt.price.currency).toBe(job.body.priceCeiling.currency);
    expect(receipt.price.amount).toBeLessThanOrEqual(job.body.priceCeiling.amount);
    expect(receipt.tokens.out).toBeLessThanOrEqual(job.body.maxTokensOut);

    const sigOk = await verifyReceiptSignature(
      receipt as unknown as { enclaveSignature?: string } & Record<string, unknown>,
      attBody.publicKey,
    );
    expect(sigOk).toBe(true);
  });

  it("ignores non-job records", async () => {
    const firehose = new Firehose();
    const events: IndexedRecord[] = [];
    firehose.on(null, async (rec) => {
      events.push(rec);
    });
    await startAutoresponder({
      firehose,
      providerDid: PROVIDER_DID,
      tokenRate: { inputPerMTok: 10, outputPerMTok: 10, currency: "USD" },
    });
    const baseline = events.length;

    await firehose.dispatch({
      uri: `at://${REQUESTER_DID}/dev.cocore.compute.paymentAuthorization/x`,
      cid: "bafy-auth",
      collection: "dev.cocore.compute.paymentAuthorization",
      repo: REQUESTER_DID,
      rkey: "x",
      body: {
        exchange: "did:web:exchange.local",
        ceiling: { amount: 100, currency: "USD" },
        scope: "singleJob",
        nonce: "0".repeat(32),
        expiresAt: "2030-01-01T00:00:00.000Z",
        createdAt: new Date().toISOString(),
      },
    });

    // baseline + 1 (the auth itself), nothing more.
    expect(events.length).toBe(baseline + 1);
  });
});
