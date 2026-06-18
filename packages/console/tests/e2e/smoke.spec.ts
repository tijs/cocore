// Route-by-route smoke tests for the cocore console.
//
// What we assert:
//   - Public routes render with 200 + a recognizable text marker.
//   - Auth-gated routes 307 to /login when called anonymously
//     (we assert via the response chain, not just final URL, so a
//     redirect-loop or 500 fails loudly).
//   - JSON API endpoints under /api/* respond with the documented
//     shape for unauthenticated callers.
//   - Static assets we depend on (app icon SVG, agent installer,
//     exchange did doc) are reachable.
//
// What we DON'T assert: anything signed-in. That needs a paired
// test PDS + an OAuth round-trip; deliberately scoped out for now
// so the suite stays fast + reliable.

import { expect, test } from "@playwright/test";

// Routes a logged-out visitor should be able to load and see content
// on. The text marker is something stable inside the page (not a
// nav-link to it, since auth-gated nav links also reference these
// strings).
const PUBLIC_PAGES: Array<{ path: string; marker: RegExp }> = [
  { path: "/login", marker: /sign in|log in|atproto/i },
  { path: "/terms", marker: /terms of service|alpha software|installing/i },
  { path: "/privacy", marker: /privacy policy|what we collect|generative-ai/i },
];

// Routes an anonymous browser must NOT be able to see — they must
// 307 to /login. If one of these starts rendering content for an
// anon visitor, that's a security regression.
const AUTH_GATED_PAGES = [
  "/machines",
  "/jobs",
  // /earnings was removed in the closed-loop pivot — provider
  // income is now part of /account (token balance + ledger event
  // log), so the dedicated earnings dashboard had no semantics
  // distinct from /account anymore.
  //
  // /api-keys + /payments were consolidated into /account in
  // bff19d9. The /account page hosts both surfaces under tabs.
  "/account",
  "/devices/new",
  "/admin/disputes",
];

// Image / DID-doc assets we contractually serve unauthenticated.
const PUBLIC_ASSETS: Array<{ path: string; contentType: RegExp }> = [
  { path: "/exchange/did.json", contentType: /^application\/(did\+json|json)/ },
  { path: "/og.png", contentType: /^image\/png/ },
];

// Endpoints whose handler must run successfully but where a healthy
// 5xx is acceptable when the deployment hasn't been configured (e.g.
// `/agent` proxies through GitHub releases via GITHUB_TOKEN; in CI
// without that token the route correctly returns 503). We just want
// to assert the handler didn't 500 with an unhandled exception or
// vanish entirely (404).
const RUNS_BUT_MAY_BE_DEGRADED: string[] = ["/agent", "/agent/version"];

// Internal exchange-only endpoints. Without the Bearer key they MUST
// return 401, never 500. CI runs with no key configured at all.
// Stripe-era /api/internal/{charge,payout} endpoints were removed
// in the closed-loop pivot; only the dispute resolver remains.
const INTERNAL_AUTHED_POST_ROUTES = ["/api/internal/disputes/resolve"];

test.describe("public pages render", () => {
  for (const { path, marker } of PUBLIC_PAGES) {
    test(`GET ${path} renders ok + matches /${marker.source}/`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response, `no response from ${path}`).not.toBeNull();
      expect(response!.ok(), `${path} returned ${response!.status()}`).toBe(true);
      // Body should contain the marker somewhere. We grab the full
      // textContent of the page so SSR-rendered content is visible
      // without waiting on hydration.
      const body = await page.locator("body").textContent();
      expect(body ?? "", `marker not found on ${path}`).toMatch(marker);
    });
  }

  test("GET / is a public marketing page that does not redirect anon visitors", async ({
    page,
  }) => {
    // `/` is the layout-wrapped marketing stub. Anon visitors stay on
    // it (they see the hero + a "Sign in" CTA); logged-in users see
    // the same page with navbar links into /machines. We assert the
    // URL stays put so a future regression that re-introduces an
    // unguarded redirect (e.g. a hidden auth-gate) fails loudly.
    const response = await page.goto("/");
    expect(response, "no response from /").not.toBeNull();
    expect(response!.ok(), `/ returned ${response!.status()}`).toBe(true);
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("auth-gated pages redirect anonymous traffic to /login", () => {
  for (const path of AUTH_GATED_PAGES) {
    test(`GET ${path} as anon redirects to /login`, async ({ request, page }) => {
      // Server-side check: confirm the redirect status is 3xx with a
      // /login Location. A 500 here is what would have caught the
      // ffa7c56 regression.
      const direct = await request.get(path, { maxRedirects: 0 });
      expect(
        direct.status(),
        `${path} should redirect, got ${direct.status()}`,
      ).toBeGreaterThanOrEqual(300);
      expect(direct.status()).toBeLessThan(400);
      const location = direct.headers()["location"];
      expect(location, `${path} redirect missing Location header`).toBeDefined();
      expect(location, `${path} should redirect to /login`).toMatch(/^\/login(\?|$)/);

      // Browser-level check: navigation lands on the login page.
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    });
  }
});

test.describe("public API endpoints respond as documented", () => {
  for (const { path, contentType } of PUBLIC_ASSETS) {
    test(`GET ${path} ok with content-type matching ${contentType.source}`, async ({ request }) => {
      const r = await request.get(path);
      expect(r.ok(), `${path} returned ${r.status()}`).toBe(true);
      expect(r.headers()["content-type"] ?? "").toMatch(contentType);
    });
  }

  for (const path of RUNS_BUT_MAY_BE_DEGRADED) {
    test(`GET ${path} handler runs (200 ok or graceful 5xx)`, async ({ request }) => {
      const r = await request.get(path);
      // Acceptable: 200 (env configured), 503 (env knob missing —
      // route surfaces a structured error), 502 (upstream
      // transient). NOT acceptable: 404 (route deleted) or
      // unhandled-exception 500.
      const status = r.status();
      expect(
        status === 200 || status === 502 || status === 503,
        `${path} returned ${status}; expected 200 or graceful 5xx`,
      ).toBe(true);
    });
  }

  test("POST /api/v1/chat/completions without auth returns 401 with OpenAI error envelope", async ({
    request,
  }) => {
    const r = await request.post("/api/v1/chat/completions", {
      data: { model: "stub", messages: [{ role: "user", content: "hi" }] },
    });
    expect(r.status(), `expected 401, got ${r.status()}`).toBe(401);
    const body = (await r.json()) as { error?: { type?: string; message?: string } };
    expect(body.error?.type).toBe("authentication_error");
    expect(body.error?.message).toMatch(/api key|bearer/i);
  });

  test("GET /exchange/did.json returns valid DID document for did:web", async ({ request }) => {
    const r = await request.get("/exchange/did.json");
    expect(r.ok()).toBe(true);
    const doc = (await r.json()) as Record<string, unknown>;
    expect(doc["@context"], "did doc missing @context").toBeDefined();
    expect(doc.id, "did doc missing id").toMatch(/^did:web:/);
  });

  test("GET /lexicons returns the dev.cocore namespace index", async ({ request }) => {
    const r = await request.get("/lexicons");
    expect(r.ok()).toBe(true);
    const body = (await r.json()) as {
      namespace: string;
      lexicons: Array<{ nsid: string; url: string }>;
    };
    expect(body.namespace).toBe("dev.cocore");
    // We expect at least the receipt + settlement + dispute lexicons
    // to be advertised. If a future PR drops one of these from the
    // public surface that should be a deliberate test change.
    const nsids = body.lexicons.map((l) => l.nsid);
    expect(nsids).toEqual(
      expect.arrayContaining([
        "dev.cocore.compute.receipt",
        "dev.cocore.compute.settlement",
        "dev.cocore.compute.dispute",
        "dev.cocore.compute.exchangePolicy",
        "dev.cocore.compute.provider",
      ]),
    );
  });

  for (const nsid of [
    "dev.cocore.compute.receipt",
    "dev.cocore.compute.settlement",
    "dev.cocore.compute.dispute",
    "dev.cocore.compute.exchangePolicy",
    "dev.cocore.compute.provider",
  ]) {
    test(`GET /lexicons/${nsid} returns the lexicon JSON`, async ({ request }) => {
      const r = await request.get(`/lexicons/${nsid}`);
      expect(r.ok(), `${nsid} returned ${r.status()}`).toBe(true);
      const doc = (await r.json()) as { lexicon?: number; id?: string };
      expect(doc.lexicon, `${nsid} missing lexicon version`).toBe(1);
      expect(doc.id, `${nsid} id mismatch`).toBe(nsid);
    });
  }

  test("GET /lexicons/<unknown> returns 404 with a helpful body", async ({ request }) => {
    const r = await request.get("/lexicons/dev.cocore.compute.does-not-exist");
    expect(r.status()).toBe(404);
    const body = (await r.json()) as { error?: string; known?: string[] };
    expect(body.error).toBe("lexicon-not-found");
    expect(body.known, "404 should list known nsids").toBeDefined();
    expect(Array.isArray(body.known) && body.known.length).toBeGreaterThan(0);
  });

  for (const path of INTERNAL_AUTHED_POST_ROUTES) {
    test(`POST ${path} without bearer returns 401 (not 500)`, async ({ request }) => {
      const r = await request.post(path, {
        data: { stripeDisputeId: "du_test", action: "ack" },
      });
      expect(r.status(), `${path} returned ${r.status()}; expected 401 from missing bearer`).toBe(
        401,
      );
      const body = (await r.json()) as { error?: string };
      expect(body.error).toBe("unauthorized");
    });
  }
});
