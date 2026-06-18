// In-process synthetic provider.
//
// Subscribes to the firehose for `dev.cocore.compute.job` records.
// When a job arrives, builds a matching receipt with a real P-256
// signature over the canonical bytes (so the AppView's
// cryptographic verifyReceipt route accepts it) and dispatches it
// back to the firehose. The exchange picks up the receipt and
// settles it through the normal path.
//
// This is what makes the "submit job in the browser → see a receipt"
// loop close in dev without a real Mac mini provider attached. It is
// gated behind `COCORE_AUTORESPOND=1` (the default) so production
// stacks pointed at real providers can disable it.

import { Firehose, canonicalize, type IndexedRecord, type JobRecord } from "@cocore/sdk";

interface AutorespondOpts {
  firehose: Firehose;
  providerDid: string;
  /** Per-token rate the autoresponder charges. Mirrors the active
   *  exchange policy's `tokenRate` so the receipt this thing
   *  fabricates settles at the same numbers a real provider would
   *  produce — receipts won't trip a verifier that re-derives
   *  `price = inputPerMTok * tokens.in / 1e6 + outputPerMTok *
   *  tokens.out / 1e6` (with a 1-minor-unit floor for very short
   *  jobs). Caller wires this from the same
   *  COCORE_TOKEN_RATE_*_PER_MTOK env vars the bootstrap publisher
   *  reads. */
  tokenRate: {
    inputPerMTok: number;
    outputPerMTok: number;
    currency: string;
  };
}

export async function startAutoresponder(opts: AutorespondOpts): Promise<void> {
  const { firehose, providerDid, tokenRate } = opts;
  const startedAtIso = new Date(Date.now() - 60_000).toISOString();
  const expiresAtIso = new Date(Date.now() + 23 * 3600_000).toISOString();

  // 1. Generate a long-lived P-256 keypair for this responder process.
  //    The attestation we publish names the public half; the receipts
  //    we sign are verifiable against that attestation.
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  // 'raw' export = 0x04 || X || Y; lexicon publicKey strips the 0x04.
  const pubB64 = b64(rawPub.slice(1));

  // 2. Publish a one-shot attestation that every receipt strong-refs.
  const attRkey = randomTid();
  const attUri = `at://${providerDid}/dev.cocore.compute.attestation/${attRkey}`;
  const attCid = PLACEHOLDER_CID;
  await firehose.dispatch({
    uri: attUri,
    cid: attCid,
    collection: "dev.cocore.compute.attestation",
    repo: providerDid,
    rkey: attRkey,
    body: {
      publicKey: pubB64,
      encryptionPubKey: "AAAA",
      chipName: "bridge-autoresponder",
      hardwareModel: "synthetic",
      serialNumberHash: "0".repeat(64),
      osVersion: "synthetic",
      binaryHash: "0".repeat(64),
      sipEnabled: true,
      secureBootEnabled: true,
      secureEnclaveAvailable: true,
      authenticatedRootEnabled: true,
      selfSignature: "synthetic",
      attestedAt: startedAtIso,
      expiresAt: expiresAtIso,
    },
  });

  // 3. Subscribe to job records and synthesize matching receipts.
  firehose.on("dev.cocore.compute.job", async (rec) => {
    try {
      const job = rec.body as JobRecord;
      // The receipt's `requester` field must equal the DID of the
      // repo the job was published to (verifyForCharge cross-checks
      // this against the job-owning repo). The firehose record
      // carries that as `repo`.
      const requesterDid = rec.repo;
      const startedAt = new Date().toISOString();
      const completedAt = new Date(Date.now() + 1).toISOString();

      const tokens = { in: 32, out: Math.min(job.maxTokensOut, 64) };
      // Real-pricing path: compute exactly what a real provider
      // would stamp under the active exchange policy's tokenRate.
      // Floor at 1 minor unit so very short jobs still produce a
      // non-zero receipt visible on the earnings dashboard. Cap at
      // the job's price ceiling to preserve the autoresponder's old
      // "always fits" guarantee — verifiers reject receipts whose
      // amount > job.priceCeiling.amount.
      const inCharge = Math.floor((tokenRate.inputPerMTok * tokens.in) / 1_000_000);
      const outCharge = Math.floor((tokenRate.outputPerMTok * tokens.out) / 1_000_000);
      const computed = Math.max(1, inCharge + outCharge);
      const price = {
        amount: Math.min(computed, job.priceCeiling.amount),
        currency: job.priceCeiling.currency,
      };

      const receiptBody = {
        job: { uri: rec.uri, cid: rec.cid },
        requester: requesterDid,
        model: job.model,
        inputCommitment: job.inputCommitment,
        outputCommitment: await syntheticOutputCommitment(job),
        tokens,
        startedAt,
        completedAt,
        price,
        attestation: { uri: attUri, cid: attCid },
      };

      // Sign the canonical bytes with our P-256 private half. Same
      // path the smoke test takes; the AppView verifies with WebCrypto.
      const canonical = new TextEncoder().encode(canonicalize(receiptBody));
      const rawSig = new Uint8Array(
        await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, canonical),
      );
      const sigB64 = b64(rawToDer(rawSig));

      const receiptRkey = randomTid();
      const receiptUri = `at://${providerDid}/dev.cocore.compute.receipt/${receiptRkey}`;
      const indexed: IndexedRecord = {
        uri: receiptUri,
        cid: PLACEHOLDER_CID,
        collection: "dev.cocore.compute.receipt",
        repo: providerDid,
        rkey: receiptRkey,
        body: { ...receiptBody, enclaveSignature: sigB64 },
      };
      await firehose.dispatch(indexed);
      console.error(`autorespond: published receipt ${receiptUri} for job ${rec.uri}`);
    } catch (e) {
      console.error(`autorespond: failed to handle job ${rec.uri}:`, (e as Error).message);
    }
  });

  console.error(`autorespond: enabled, providerDid=${providerDid}, attestation=${attUri}`);
}

const PLACEHOLDER_CID = "bafyreigh2akiscaildc5sgz5wybizysiehxiv4dhpwwqouytxnvgkpkcaq";

function randomTid(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function syntheticOutputCommitment(job: JobRecord): Promise<string> {
  const seed = `${job.inputCommitment}:${job.model}:${job.maxTokensOut}`;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  );
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rawToDer(rawSig: Uint8Array): Uint8Array {
  const r = encodeInt(rawSig.slice(0, 32));
  const s = encodeInt(rawSig.slice(32, 64));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

function encodeInt(b: Uint8Array): number[] {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const trimmed = b.slice(i);
  const pad = (trimmed[0]! & 0x80) !== 0;
  return [0x02, trimmed.length + (pad ? 1 : 0), ...(pad ? [0x00] : []), ...trimmed];
}
