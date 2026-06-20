import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

import { AccountStore } from "../operational/account-store.ts";
import { devicePairRoutes } from "./routes.ts";
import { PairStore } from "./pair-store.ts";

function mount(): Promise<{ base: string; server: Server }> {
  const routes = devicePairRoutes(new PairStore("https://console.test"), {
    accountStore: new AccountStore(":memory:"),
    appviewDid: "did:web:appview.test",
    apiBase: "https://appview.test",
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const h = routes[url.pathname];
    if (!h) return void res.writeHead(404).end("{}");
    void h(req, res, url);
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "string" || !addr) throw new Error("no addr");
      resolve({ base: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

describe("devicePair routes", () => {
  it("start returns a deviceId + userCode + console verification URI", async () => {
    const m = await mount();
    server = m.server;
    const r = await fetch(`${m.base}/xrpc/dev.cocore.devicePair.start`, { method: "POST" });
    expect(r.status).toBe(200);
    const b = (await r.json()) as { deviceId: string; userCode: string; verificationUri: string };
    expect(b.deviceId).toBeTruthy();
    expect(b.userCode).toBeTruthy();
    expect(b.verificationUri).toContain("https://console.test/devices/new?code=");
  });

  it("poll is pending after start and 404 for an unknown device", async () => {
    const m = await mount();
    server = m.server;
    const start = (await (
      await fetch(`${m.base}/xrpc/dev.cocore.devicePair.start`, { method: "POST" })
    ).json()) as { deviceId: string };
    const pending = await fetch(
      `${m.base}/xrpc/dev.cocore.devicePair.poll?deviceId=${start.deviceId}`,
    );
    expect(pending.status).toBe(200);
    expect(((await pending.json()) as { status: string }).status).toBe("pending");

    const unknown = await fetch(`${m.base}/xrpc/dev.cocore.devicePair.poll?deviceId=nope`);
    expect(unknown.status).toBe(404);
  });

  it("confirm requires service auth (401 without a token)", async () => {
    const m = await mount();
    server = m.server;
    const r = await fetch(`${m.base}/xrpc/dev.cocore.devicePair.confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: "ABCD1234", decision: "approve" }),
    });
    expect(r.status).toBe(401);
  });

  it("405s on the wrong method", async () => {
    const m = await mount();
    server = m.server;
    expect((await fetch(`${m.base}/xrpc/dev.cocore.devicePair.start`)).status).toBe(405); // GET
  });
});
