// End-to-end pair flow against a running console.
//
//   aube run dev                   # boot the console (cwd: packages/console)
//   node --experimental-strip-types packages/console/scripts/e2e-pair.ts
//
// Drives all three endpoints in sequence:
//   1. POST start              → got deviceId, userCode
//   2. GET  poll(pending)      → status=pending
//   3. POST confirm(approve)   → ok
//   4. GET  poll(session)      → got session
//   5. GET  poll(consumed)     → 410
//
// Used by `make e2e` once docker-compose lands; runnable today against
// any localhost console.

const BASE = process.env["CONSOLE"] ?? "http://localhost:3000";

async function main() {
  console.log(`> POST ${BASE}/api/xrpc/dev.cocore.devicePair.start`);
  const start = await fetch(`${BASE}/api/xrpc/dev.cocore.devicePair.start`, { method: "POST" });
  if (!start.ok) throw new Error(`start: ${start.status}`);
  const { deviceId, userCode } = await start.json();
  console.log(`  deviceId=${deviceId} userCode=${userCode}`);

  console.log(`> GET  poll(${deviceId})`);
  const pending = await fetch(`${BASE}/api/xrpc/dev.cocore.devicePair.poll?deviceId=${deviceId}`);
  const pendingBody = await pending.json();
  if (pendingBody.status !== "pending")
    throw new Error(`expected pending, got ${pendingBody.status}`);

  console.log(`> POST confirm(approve, ${userCode})`);
  const confirm = await fetch(`${BASE}/api/xrpc/dev.cocore.devicePair.confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userCode,
      decision: "approve",
      session: {
        did: "did:plc:e2e",
        handle: "e2e.example",
        pdsEndpoint: "http://localhost:2583",
        accessToken: "e2e-token",
        refreshToken: "e2e-refresh",
        dpopJwkPrivate: { kty: "EC", crv: "P-256", d: "e2e" },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    }),
  });
  if (!confirm.ok) throw new Error(`confirm: ${confirm.status} ${await confirm.text()}`);

  console.log(`> GET  poll(${deviceId}) again`);
  const session = await fetch(`${BASE}/api/xrpc/dev.cocore.devicePair.poll?deviceId=${deviceId}`);
  const sessionBody = await session.json();
  if (sessionBody.status !== "session")
    throw new Error(`expected session, got ${sessionBody.status}`);
  console.log(`  session.did=${sessionBody.session.did}`);

  console.log(`> GET  poll(${deviceId}) once more (consumed)`);
  const consumed = await fetch(`${BASE}/api/xrpc/dev.cocore.devicePair.poll?deviceId=${deviceId}`);
  if (consumed.status !== 410) throw new Error(`expected 410, got ${consumed.status}`);
  console.log(`  410 consumed (correct)`);

  console.log("\n  pair flow OK");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
