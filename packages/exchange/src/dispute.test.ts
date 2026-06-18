import { describe, expect, it } from "vitest";

import { ExchangeDisputeService, MemoryDisputeTransport } from "./dispute.ts";

const EX_DID = "did:web:console.cocore.dev:exchange";
const SETTLEMENT_REF = {
  uri: `at://${EX_DID}/dev.cocore.compute.settlement/abc`,
  cid: "bafyreigh2akiscaildc5sgz5wybizysiehxiv4dhpwwqouytxnvgkpkcaq",
};

describe("ExchangeDisputeService", () => {
  it("openDispute publishes status=open with exchange == repo", async () => {
    const transport = new MemoryDisputeTransport();
    const svc = new ExchangeDisputeService({ exchangeDid: EX_DID, transport });
    const r = await svc.openDispute({
      settlement: SETTLEMENT_REF,
      raisedBy: "did:plc:requester",
      raisedAt: "2026-05-09T20:00:00.000Z",
      reason: { category: "non-delivery", detail: "no completion ack" },
    });
    expect(r.record.status).toBe("open");
    expect(r.record.exchange).toBe(EX_DID);
    expect(r.record.outcome).toBeUndefined();
    expect(r.published.uri.startsWith(`at://${EX_DID}/dev.cocore.compute.dispute/`)).toBe(true);
  });

  it("resolveDispute updates the prior record in place and stamps the verdict", async () => {
    const transport = new MemoryDisputeTransport();
    const svc = new ExchangeDisputeService({ exchangeDid: EX_DID, transport });
    const opened = await svc.openDispute({
      settlement: SETTLEMENT_REF,
      raisedBy: "did:plc:requester",
      raisedAt: "2026-05-09T20:00:00.000Z",
      reason: { category: "non-delivery" },
    });
    const refundRef = {
      uri: `at://${EX_DID}/dev.cocore.compute.settlement/refund-1`,
      cid: "bafyrefund",
    };
    const resolved = await svc.resolveDispute({
      uri: opened.published.uri,
      swapCid: opened.published.cid,
      prior: opened.record,
      outcome: {
        verdict: "refund-full",
        refundSettlement: refundRef,
        rationale: "provider never returned a receipt",
        decidedAt: "2026-05-09T21:00:00.000Z",
      },
    });
    expect(resolved.record.status).toBe("resolved");
    expect(resolved.record.outcome?.verdict).toBe("refund-full");
    expect(resolved.record.outcome?.refundSettlement).toEqual(refundRef);
    // CID changed from the open version, indicating an in-place update:
    expect(resolved.published.cid).not.toBe(opened.published.cid);
  });

  it("rejects a refund verdict without a refundSettlement strong-ref", async () => {
    const transport = new MemoryDisputeTransport();
    const svc = new ExchangeDisputeService({ exchangeDid: EX_DID, transport });
    const opened = await svc.openDispute({
      settlement: SETTLEMENT_REF,
      raisedBy: "did:plc:requester",
      raisedAt: "2026-05-09T20:00:00.000Z",
      reason: { category: "fraud" },
    });
    await expect(
      svc.resolveDispute({
        uri: opened.published.uri,
        swapCid: opened.published.cid,
        prior: opened.record,
        outcome: {
          verdict: "refund-partial",
          decidedAt: "2026-05-09T21:00:00.000Z",
        },
      }),
    ).rejects.toThrow(/refundSettlement/);
  });

  it("refuses to resolve a dispute that is already resolved", async () => {
    const transport = new MemoryDisputeTransport();
    const svc = new ExchangeDisputeService({ exchangeDid: EX_DID, transport });
    const opened = await svc.openDispute({
      settlement: SETTLEMENT_REF,
      raisedBy: "did:plc:requester",
      raisedAt: "2026-05-09T20:00:00.000Z",
      reason: { category: "fraud" },
    });
    const resolved = await svc.resolveDispute({
      uri: opened.published.uri,
      swapCid: opened.published.cid,
      prior: opened.record,
      outcome: {
        verdict: "uphold-charge",
        decidedAt: "2026-05-09T21:00:00.000Z",
        rationale: "evidence supports the provider",
      },
    });
    await expect(
      svc.resolveDispute({
        uri: resolved.published.uri,
        swapCid: resolved.published.cid,
        prior: resolved.record,
        outcome: {
          verdict: "refund-full",
          refundSettlement: SETTLEMENT_REF,
          decidedAt: "2026-05-09T22:00:00.000Z",
        },
      }),
    ).rejects.toThrow(/already resolved/);
  });
});
