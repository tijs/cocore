// Seeds the local dev stack with multiple provider rows + receipts for one DID (your operator PDS).
// Requires cocore-services bridge (same as `pnpm dev:seed`).
//
//   COCORE_SEED_PROVIDER_DID=did:plc:… pnpm dev:seed:account
//   COCORE_SEED_REQUESTER_DID=did:plc:… — same as console sign-in so /jobs lists seeded jobs
//   Aliases: DEV_SEED_DEFAULT_PROVIDER_DID, DEV_SEED_DEFAULT_REQUESTER_DID
//
// Default provider DID is the hipstersmoothie dev fixture below; override with env.

import {
  DEV_SEED_DEFAULT_REQUESTER_DID,
  seedDevStack,
  seedJobWithoutReceipt,
} from "./seed-dev-stack.ts";

const DEFAULT_PROVIDER_DID = "did:plc:m2sjv3wncvsasdapla35hzwj";

const BRIDGE = process.env["BRIDGE"] ?? "http://localhost:8080";
const BRIDGE_WAIT_MS = Number(process.env["COCORE_SEED_BRIDGE_WAIT_MS"] ?? 20_000);
const BRIDGE_POLL_MS = 400;

const FIXTURES: {
  machineLabel: string;
  chip: string;
  ramGB: number;
  gpuCores: number;
  receiptCompletedHoursAgo: number;
  receiptPriceAmount: number;
  /** Receipt + auth ceiling minor units; must be >= receiptPriceAmount */
  pricingCeilingAmount: number;
}[] = [
  {
    machineLabel: "workshop",
    chip: "NVIDIA GeForce RTX 4090",
    ramGB: 64,
    gpuCores: 128,
    receiptCompletedHoursAgo: 2,
    receiptPriceAmount: 184,
    pricingCeilingAmount: 280,
  },
  {
    machineLabel: "attic-rig",
    chip: "NVIDIA GeForce RTX 3090",
    ramGB: 32,
    gpuCores: 82,
    receiptCompletedHoursAgo: 8,
    receiptPriceAmount: 96,
    pricingCeilingAmount: 280,
  },
  {
    machineLabel: "basement",
    chip: "Apple M3 Max",
    ramGB: 128,
    gpuCores: 40,
    receiptCompletedHoursAgo: 20,
    receiptPriceAmount: 220,
    pricingCeilingAmount: 280,
  },
];

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
  const providerDid =
    process.env["COCORE_SEED_PROVIDER_DID"]?.trim() ||
    process.env["DEV_SEED_DEFAULT_PROVIDER_DID"]?.trim() ||
    DEFAULT_PROVIDER_DID;
  const requesterDid =
    process.env["COCORE_SEED_REQUESTER_DID"]?.trim() ??
    process.env["DEV_SEED_DEFAULT_REQUESTER_DID"]?.trim() ??
    DEV_SEED_DEFAULT_REQUESTER_DID;

  process.stderr.write(`waiting for bridge at ${BRIDGE}…\n`);
  await waitForBridge(BRIDGE);

  process.stderr.write(
    `seeding ${FIXTURES.length} machines for provider ${providerDid} (requester ${requesterDid})…\n`,
  );

  const results: Awaited<ReturnType<typeof seedDevStack>>[] = [];
  for (const f of FIXTURES) {
    const out = await seedDevStack({
      bridge: BRIDGE,
      provider: providerDid,
      requester: requesterDid,
      machineLabel: f.machineLabel,
      chip: f.chip,
      ramGB: f.ramGB,
      gpuCores: f.gpuCores,
      receiptCompletedHoursAgo: f.receiptCompletedHoursAgo,
      receiptPriceAmount: f.receiptPriceAmount,
      pricingCeilingAmount: f.pricingCeilingAmount,
    });
    results.push(out);
    console.error(`  ok: ${out.providerUri}`);
  }

  await seedJobWithoutReceipt({
    bridge: BRIDGE,
    requester: requesterDid,
    kind: "pending",
    model: "gpt-dev",
    inputCommitmentSeed: 0xd1000001,
  });
  await seedJobWithoutReceipt({
    bridge: BRIDGE,
    requester: requesterDid,
    kind: "pending",
    model: "llama-70b-chat",
    pricingCeilingAmount: 220,
    inputCommitmentSeed: 0xd1000002,
  });
  await seedJobWithoutReceipt({
    bridge: BRIDGE,
    requester: requesterDid,
    kind: "expired",
    model: "smoke-model",
    pricingCeilingAmount: 100,
    inputCommitmentSeed: 0xd1000003,
  });

  console.error(
    `account seed OK (${providerDid}): ${results.length} receipt tuples + 3 job-only (2 pending, 1 expired); requester=${requesterDid} — /machines /jobs`,
  );
}

main().catch((e) => {
  console.error("account seed FAIL:", briefErr(e));
  process.exit(1);
});
