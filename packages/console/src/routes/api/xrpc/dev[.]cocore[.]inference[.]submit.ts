// POST /xrpc/dev.cocore.inference.submit
//
// Authenticated requester-side submit. The console builds a
// (paymentAuthorization, job) pair scoped to the configured exchange,
// publishes both via the local bridge, and hands the job/auth URIs
// back to the browser so it can poll for a receipt.
//
// Body:
//   {
//     model: string,
//     prompt: string,
//     maxTokensOut: int,
//     priceCeiling: { amount: int, currency: string }
//   }
//
// Response: 200 { jobUri, authUri, inputCommitment } | 401 | 400 | 502.

import { createFileRoute } from "@tanstack/react-router";
import { BridgeRecordTransport, submitJob } from "@cocore/sdk/publish";
import { cocoreConfig } from "@/lib/cocore-config.ts";
import { getAtprotoSessionForRequest } from "@/middleware/auth.server.ts";

interface SubmitBody {
  model?: unknown;
  prompt?: unknown;
  maxTokensOut?: unknown;
  priceCeiling?: unknown;
}

interface ParsedSubmit {
  model: string;
  prompt: string;
  maxTokensOut: number;
  priceCeiling: { amount: number; currency: string };
}

function parseSubmit(body: SubmitBody): ParsedSubmit | string {
  if (typeof body.model !== "string" || body.model.length === 0) return "model required";
  if (typeof body.prompt !== "string" || body.prompt.length === 0) return "prompt required";
  if (
    typeof body.maxTokensOut !== "number" ||
    !Number.isInteger(body.maxTokensOut) ||
    body.maxTokensOut < 1
  ) {
    return "maxTokensOut must be a positive integer";
  }
  const pc = body.priceCeiling as { amount?: unknown; currency?: unknown } | undefined;
  if (
    !pc ||
    typeof pc.amount !== "number" ||
    !Number.isInteger(pc.amount) ||
    pc.amount < 0 ||
    typeof pc.currency !== "string" ||
    pc.currency.length === 0
  ) {
    return "priceCeiling must be { amount: int, currency: string }";
  }
  return {
    model: body.model,
    prompt: body.prompt,
    maxTokensOut: body.maxTokensOut,
    priceCeiling: { amount: pc.amount, currency: pc.currency },
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/xrpc/dev.cocore.inference.submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getAtprotoSessionForRequest(request);
        if (!session) return json({ error: "not authenticated" }, 401);

        let body: SubmitBody;
        try {
          body = (await request.json()) as SubmitBody;
        } catch {
          return json({ error: "bad json" }, 400);
        }

        const parsed = parseSubmit(body);
        if (typeof parsed === "string") return json({ error: parsed }, 400);

        const config = cocoreConfig();
        const transport = new BridgeRecordTransport({ endpoint: config.bridgeUrl });

        try {
          const submitted = await submitJob({
            transport,
            requesterDid: session.did,
            inputs: {
              model: parsed.model,
              prompt: parsed.prompt,
              maxTokensOut: parsed.maxTokensOut,
              priceCeiling: parsed.priceCeiling,
              exchangeDid: config.exchangeDid,
            },
          });
          return json(
            {
              jobUri: submitted.job.ref.uri,
              authUri: submitted.authorization.ref.uri,
              inputCommitment: submitted.job.record.inputCommitment,
            },
            200,
          );
        } catch (e) {
          return json({ error: (e as Error).message }, 502);
        }
      },
    },
  },
});
