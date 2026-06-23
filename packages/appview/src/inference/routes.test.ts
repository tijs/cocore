import { describe, expect, it } from "vitest";

import { Store } from "../store.ts";
import type { AppviewOAuthClient } from "../auth/oauth-client.ts";
import { withAppviewServer } from "../api/http-app.ts";
import { buildInferenceRouter } from "./routes.ts";

// dispatch authenticates BEFORE touching the store/oauth, so the 401 and
// 405 gates can be exercised with a stub OAuth client.
function router() {
  return buildInferenceRouter({
    store: new Store(":memory:"),
    oauth: {} as unknown as AppviewOAuthClient,
    appviewDid: "did:web:appview.test",
    advisorUrl: "http://127.0.0.1:1",
    exchangeDid: "did:web:exchange.test",
  });
}

describe("inference.dispatch route", () => {
  it("requires service auth (401 without a token)", async () => {
    await withAppviewServer(router(), async (base) => {
      const r = await fetch(`${base}/xrpc/dev.cocore.inference.dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "llama",
          prompt: "hi",
          maxTokensOut: 16,
          priceCeiling: { amount: 0, currency: "USD" },
        }),
      });
      expect(r.status).toBe(401);
    });
  });

  it("405s on the wrong method", async () => {
    await withAppviewServer(router(), async (base) => {
      expect((await fetch(`${base}/xrpc/dev.cocore.inference.dispatch`)).status).toBe(405); // GET
    });
  });
});
