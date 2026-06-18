// One-shot seed for local dev: same fixture as smoke, via the bridge.
//
//   pnpm dev:seed
//
// Env:
//   BRIDGE — default http://localhost:8080
//
//   Fleet (machines / earnings — indexed providers + receipts under this DID):
//     COCORE_SEED_PROVIDER_DID — optional; default did:plc:smoke-provider
//     COCORE_SEED_REQUESTER_DID — optional; default did:plc:smoke-requester
//   Aliases (same effect): DEV_SEED_DEFAULT_PROVIDER_DID, DEV_SEED_DEFAULT_REQUESTER_DID
//
//   Single console account: set provider + requester to the same DID, e.g.
//     COCORE_SEED_PROVIDER_DID=did:plc:… COCORE_SEED_REQUESTER_DID=did:plc:… pnpm dev:seed
//
//   Full tuples: DEV_BOOTSTRAP_FIXTURES (time-spread receipts). Plus 3 job-only rows
//   (2 pending, 1 expired) for the fleet requester DID above.
//
//   Synthetic /friends directory members (DEV_DIRECTORY_FRIEND_FIXTURES): published
//   after the main seed — add them from Discover, not the Bluesky-backed handle box.
//
// Requires cocore-services (bridge on :8080).

import {
  DEV_BOOTSTRAP_FIXTURES,
  DEV_DIRECTORY_FRIEND_FIXTURES,
  DEV_SEED_DEFAULT_PROVIDER_DID,
  DEV_SEED_DEFAULT_REQUESTER_DID,
  seedDevStack,
  seedDirectoryFriendProfiles,
  seedJobWithoutReceipt,
} from "./seed-dev-stack.ts";

const BRIDGE = process.env["BRIDGE"] ?? "http://localhost:8080";
const BRIDGE_WAIT_MS = Number(process.env["COCORE_SEED_BRIDGE_WAIT_MS"] ?? 20_000);
const BRIDGE_POLL_MS = 400;

function firstEnvDid(keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

const fleetProviderDid =
  firstEnvDid(["COCORE_SEED_PROVIDER_DID", "DEV_SEED_DEFAULT_PROVIDER_DID"]) ??
  DEV_SEED_DEFAULT_PROVIDER_DID;
const fleetRequesterDid =
  firstEnvDid(["COCORE_SEED_REQUESTER_DID", "DEV_SEED_DEFAULT_REQUESTER_DID"]) ??
  DEV_SEED_DEFAULT_REQUESTER_DID;

function briefErr(e: unknown): string {
  if (e instanceof Error) {
    const c = "cause" in e ? (e as Error & { cause?: unknown }).cause : undefined;
    const extra = c instanceof Error ? ` (${c.message})` : c != null ? ` (${String(c)})` : "";
    return `${e.message}${extra}`;
  }
  return String(e);
}

async function waitForBridge(base: string): Promise<void> {
  const deadline = Date.now() + BRIDGE_WAIT_MS;
  let attempt = 0;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(`${base}/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        if (attempt > 1) {
          process.stderr.write(`bridge ready after ${attempt} attempt(s)\n`);
        }
        return;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, BRIDGE_POLL_MS));
  }
  const hint = `Cannot reach bridge at ${base} within ${BRIDGE_WAIT_MS}ms.\nStart cocore-services first, then retry:\n  mise services\n  # or: pnpm dev:services\n`;
  throw new Error(`${hint}Last error: ${briefErr(lastErr)}`);
}

async function main(): Promise<void> {
  process.stderr.write(
    `waiting for bridge at ${BRIDGE} (fleet provider=${fleetProviderDid} requester=${fleetRequesterDid})…\n`,
  );
  await waitForBridge(BRIDGE);

  let lastRow: Awaited<ReturnType<typeof seedDevStack>> | undefined;
  let i = 0;
  for (const fx of DEV_BOOTSTRAP_FIXTURES) {
    lastRow = await seedDevStack({
      bridge: BRIDGE,
      requester: fleetRequesterDid,
      provider: fleetProviderDid,
      ...fx,
    });
    i += 1;
  }
  const out = lastRow!;

  await seedJobWithoutReceipt({
    bridge: BRIDGE,
    requester: fleetRequesterDid,
    kind: "pending",
    model: "gpt-dev",
    inputCommitmentSeed: 0xc0c00001,
  });
  await seedJobWithoutReceipt({
    bridge: BRIDGE,
    requester: fleetRequesterDid,
    kind: "pending",
    model: "llama-70b-chat",
    pricingCeilingAmount: 220,
    inputCommitmentSeed: 0xc0c00002,
  });
  await seedJobWithoutReceipt({
    bridge: BRIDGE,
    requester: fleetRequesterDid,
    kind: "expired",
    model: "smoke-model",
    pricingCeilingAmount: 100,
    inputCommitmentSeed: 0xc0c00003,
  });

  await seedDirectoryFriendProfiles({ bridge: BRIDGE });

  console.error(
    [
      `dev seed OK (${i} tuples + 3 job-only + ${DEV_DIRECTORY_FRIEND_FIXTURES.length} friend-test directory profiles)`,
      `provider=${fleetProviderDid}`,
      `requester=${fleetRequesterDid}`,
      `lastReceipt=${out.receiptUri}`,
      `— /machines + /earnings: sign in as ${fleetProviderDid} · /jobs: sign in as ${fleetRequesterDid}`,
      `— /friends: search "friendtest" or open Discover; add Dev friend Alpha/Beta/Gamma from the grid (not the handle preview box).`,
    ].join(" · "),
  );
}

main().catch((e) => {
  console.error("dev seed FAIL:", briefErr(e));
  process.exit(1);
});
