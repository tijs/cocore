import { describe, expect, it } from "vitest";

import { AccountStore } from "../operational/account-store.ts";
import { withAppviewServer } from "../api/http-app.ts";
import { buildDevicePairRouter } from "./routes.ts";
import { PairStore } from "./pair-store.ts";

function router() {
  return buildDevicePairRouter(new PairStore("https://console.test"), {
    accountStore: new AccountStore(":memory:"),
    appviewDid: "did:web:appview.test",
    apiBase: "https://console.test",
  });
}

describe("devicePair routes", () => {
  it("start returns a deviceId + userCode + console verification URI", async () => {
    await withAppviewServer(router(), async (base) => {
      const r = await fetch(`${base}/xrpc/dev.cocore.devicePair.start`, { method: "POST" });
      expect(r.status).toBe(200);
      const b = (await r.json()) as {
        deviceId: string;
        userCode: string;
        verificationUri: string;
      };
      expect(b.deviceId).toBeTruthy();
      expect(b.userCode).toBeTruthy();
      expect(b.verificationUri).toContain("https://console.test/devices/new?code=");
    });
  });

  it("poll is pending after start and 404 for an unknown device", async () => {
    await withAppviewServer(router(), async (base) => {
      const start = (await (
        await fetch(`${base}/xrpc/dev.cocore.devicePair.start`, { method: "POST" })
      ).json()) as { deviceId: string };
      const pending = await fetch(
        `${base}/xrpc/dev.cocore.devicePair.poll?deviceId=${start.deviceId}`,
      );
      expect(pending.status).toBe(200);
      expect(((await pending.json()) as { status: string }).status).toBe("pending");

      const unknown = await fetch(`${base}/xrpc/dev.cocore.devicePair.poll?deviceId=nope`);
      expect(unknown.status).toBe(404);
    });
  });

  it("confirm requires service auth (401 without a token)", async () => {
    await withAppviewServer(router(), async (base) => {
      const r = await fetch(`${base}/xrpc/dev.cocore.devicePair.confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: "ABCD1234", decision: "approve" }),
      });
      expect(r.status).toBe(401);
    });
  });

  it("405s on the wrong method", async () => {
    await withAppviewServer(router(), async (base) => {
      expect((await fetch(`${base}/xrpc/dev.cocore.devicePair.start`)).status).toBe(405); // GET
    });
  });
});
