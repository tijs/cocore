// GET /xrpc/dev.cocore.inference.status?jobUri=at://...
//
// Authenticated polling endpoint for the Request Inference page. The
// browser submits a job, then polls this endpoint until a matching
// receipt (and optionally a settlement) shows up in the AppView.
//
// The console doesn't itself index receipts; we proxy the AppView
// over HTTP so the browser doesn't need to know about its address.

import { createFileRoute } from "@tanstack/react-router";
import { cocoreConfig } from "@/lib/cocore-config.ts";
import { getAtprotoSessionForRequest } from "@/middleware/auth.server.ts";

interface AppViewReceiptRow {
  uri: string;
  cid: string;
  collection: string;
  repo: string;
  rkey: string;
  body: {
    job: { uri: string; cid: string };
    requester: string;
    model: string;
    outputCommitment: string;
    tokens: { in: number; out: number };
    startedAt: string;
    completedAt: string;
    price: { amount: number; currency: string };
    attestation: { uri: string; cid: string };
    enclaveSignature: string;
    outputCipherURL?: string;
  };
}

interface AppViewSettlementRow {
  uri: string;
  cid: string;
  collection: string;
  body: {
    receipt: { uri: string; cid: string };
    amountCharged: { amount: number; currency: string };
    providerPayout: { amount: number; currency: string };
    exchangeFee: { amount: number; currency: string };
    status: "settled" | "refunded" | "disputed";
    settledAt: string;
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/xrpc/dev.cocore.inference.status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getAtprotoSessionForRequest(request);
        if (!session) return json({ error: "not authenticated" }, 401);

        const url = new URL(request.url);
        const jobUri = url.searchParams.get("jobUri");
        if (!jobUri) return json({ error: "missing jobUri" }, 400);

        const config = cocoreConfig();
        let receipt: AppViewReceiptRow | null = null;
        try {
          const r = await fetch(
            `${config.appviewUrl}/xrpc/dev.cocore.appview.getReceipts?job=${encodeURIComponent(jobUri)}`,
          );
          if (!r.ok) return json({ error: `appview: ${r.status}` }, 502);
          const j = (await r.json()) as { receipts: AppViewReceiptRow[] };
          receipt = j.receipts[0] ?? null;
        } catch (e) {
          return json({ error: `appview unreachable: ${(e as Error).message}` }, 502);
        }

        if (!receipt) return json({ status: "pending" }, 200);

        // Settlement is optional — it usually arrives within ~100ms
        // of the receipt landing on the firehose, but the browser
        // may catch the gap. Probe but don't require.
        let settlement: AppViewSettlementRow | null = null;
        try {
          const r = await fetch(
            `${config.appviewUrl}/xrpc/dev.cocore.appview.getSettlements?receipt=${encodeURIComponent(receipt.uri)}`,
          );
          if (r.ok) {
            const j = (await r.json()) as { settlements: AppViewSettlementRow[] };
            settlement = j.settlements[0] ?? null;
          }
        } catch {
          // Soft fail: the settlement endpoint is new; older AppViews
          // 404 here. The receipt-only response is still useful.
        }

        return json(
          {
            status: settlement ? "settled" : "received",
            receipt,
            settlement,
          },
          200,
        );
      },
    },
  },
});
