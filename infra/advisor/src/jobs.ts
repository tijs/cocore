// `POST /jobs` — Phase 2.5 dispatch endpoint.
//
// Accepts a sealed prompt + the requester's pubkey, picks an attested
// provider (or honors `targetProviderDid` when supplied), and forwards
// an `inference_request` over the chosen provider's WebSocket. Returns
// an SSE stream that relays the chunk + complete frames the provider
// emits.
//
// Body shape:
//   {
//     "jobUri":            string  // at:// strong-ref to the job record
//     "requesterDid":      string  // did:plc:… or did:web:…
//     "requesterPubKey":   string  // base64 X25519, 32 raw bytes
//     "model":             string  // opaque model id; empty = no filter
//     "maxTokensOut":      number
//     "ciphertext":        number[] | string  // bytes (array) or base64
//     "sessionId":         string?  // server generates if omitted
//     "targetProviderDid": string?  // pin dispatch; otherwise pickFor()
//   }
//
// Response: `text/event-stream`. The first event is `open`, followed
// by zero or more `chunk` events, terminated by `complete` (or
// `error` on failure / idle timeout).

import type { IncomingMessage, ServerResponse } from "node:http";

import type { AdvisorMessage, InferenceRequest } from "./protocol.ts";
import type { ProviderEntry, ProviderRegistry } from "./registry.ts";
import type { SessionManager } from "./sessions.ts";

interface JobBody {
  jobUri: string;
  /** Optional: CID half of the job strong-ref. Required for the
   *  provider to publish a receipt; without it `inference_complete`
   *  carries an empty `receipt_uri`. */
  jobCid?: string;
  requesterDid: string;
  requesterPubKey: string;
  model: string;
  maxTokensOut: number;
  ciphertext: number[] | string;
  sessionId?: string;
  targetProviderDid?: string;
  /** Optional: pin to a SPECIFIC machine under `targetProviderDid` (its
   *  provider-record rkey / advisor machine_id). Ignored unless
   *  `targetProviderDid` is also set. Lets the console route a "test this
   *  machine" probe at exactly one of an owner's machines. */
  targetMachineId?: string;
}

interface ParsedJob {
  ok: true;
  body: Required<Omit<JobBody, "jobCid" | "targetProviderDid" | "targetMachineId">> & {
    jobCid?: string;
    targetProviderDid?: string;
    targetMachineId?: string;
  };
}

interface ParseError {
  ok: false;
  status: number;
  error: string;
}

function parseJobBody(input: unknown, generateId: () => string): ParsedJob | ParseError {
  if (input === null || typeof input !== "object") {
    return { ok: false, status: 400, error: "body must be a JSON object" };
  }
  const b = input as Record<string, unknown>;
  const required: Array<keyof JobBody> = [
    "jobUri",
    "requesterDid",
    "requesterPubKey",
    "model",
    "maxTokensOut",
    "ciphertext",
  ];
  for (const k of required) {
    if (!(k in b)) return { ok: false, status: 400, error: `missing field: ${k}` };
  }
  if (typeof b["jobUri"] !== "string") {
    return { ok: false, status: 400, error: "jobUri must be a string" };
  }
  if (typeof b["requesterDid"] !== "string") {
    return { ok: false, status: 400, error: "requesterDid must be a string" };
  }
  if (typeof b["requesterPubKey"] !== "string") {
    return { ok: false, status: 400, error: "requesterPubKey must be a string" };
  }
  if (typeof b["model"] !== "string") {
    return { ok: false, status: 400, error: "model must be a string" };
  }
  if (typeof b["maxTokensOut"] !== "number" || !Number.isInteger(b["maxTokensOut"])) {
    return { ok: false, status: 400, error: "maxTokensOut must be an integer" };
  }
  const ct = b["ciphertext"];
  if (!(typeof ct === "string" || (Array.isArray(ct) && ct.every((n) => typeof n === "number")))) {
    return {
      ok: false,
      status: 400,
      error: "ciphertext must be a base64 string or number[] (array of byte values)",
    };
  }
  if (b["sessionId"] !== undefined && typeof b["sessionId"] !== "string") {
    return { ok: false, status: 400, error: "sessionId must be a string when provided" };
  }
  if (b["jobCid"] !== undefined && typeof b["jobCid"] !== "string") {
    return { ok: false, status: 400, error: "jobCid must be a string when provided" };
  }
  if (b["targetProviderDid"] !== undefined && typeof b["targetProviderDid"] !== "string") {
    return { ok: false, status: 400, error: "targetProviderDid must be a string when provided" };
  }
  if (b["targetMachineId"] !== undefined && typeof b["targetMachineId"] !== "string") {
    return { ok: false, status: 400, error: "targetMachineId must be a string when provided" };
  }
  return {
    ok: true,
    body: {
      jobUri: b["jobUri"] as string,
      jobCid: typeof b["jobCid"] === "string" ? b["jobCid"] : undefined,
      requesterDid: b["requesterDid"] as string,
      requesterPubKey: b["requesterPubKey"] as string,
      model: b["model"] as string,
      maxTokensOut: b["maxTokensOut"] as number,
      ciphertext: ct as number[] | string,
      sessionId: typeof b["sessionId"] === "string" ? b["sessionId"] : generateId(),
      targetProviderDid:
        typeof b["targetProviderDid"] === "string" ? b["targetProviderDid"] : undefined,
      targetMachineId: typeof b["targetMachineId"] === "string" ? b["targetMachineId"] : undefined,
    },
  };
}

/** Hard cap on a request body. `/jobs` is public (it's how requesters
 *  dispatch), so an unbounded read is a trivial memory-exhaustion DoS. A
 *  sealed prompt + metadata is comfortably under 1 MiB. */
const MAX_BODY_BYTES = 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown;
}

export interface JobsContext {
  registry: ProviderRegistry;
  sessions: SessionManager;
  generateId: () => string;
  /** Maximum age (ms) for a provider's last successful attestation
   *  before `pickFor` refuses to route to them. Belt-and-suspenders
   *  in front of the WebSocket-level re-challenge timeout: if the
   *  socket somehow stayed open without a fresh attestation, this
   *  still keeps stale providers out of dispatch.
   *
   *  Set from main.ts to `RECHALLENGE_INTERVAL_MS +
   *  CHALLENGE_RESPONSE_TIMEOUT_MS + 30_000` so a single missed
   *  challenge falls back inside the window but two consecutive
   *  ones do not. */
  attestationMaxAgeMs?: number;
  /** How long to wait for a provider to answer the preflight `ping`
   *  before treating it as unresponsive and failing over to the next
   *  candidate. Small by design — a healthy serve loop answers in a few
   *  ms; this only needs to clear network RTT. Defaults to 1500ms. */
  preflightTimeoutMs?: number;
}

/** Handle one POST /jobs request. Writes the response (success: SSE
 *  stream owned by SessionManager; failure: JSON status). */
export async function handleJobsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: JobsContext,
): Promise<void> {
  // Start of the time-to-first-token clock: the moment cocore received
  // this dispatch. Carried into the session so the first relayed chunk
  // records received → first-chunk.
  const receivedAt = Date.now();
  let raw: unknown;
  try {
    raw = await readBody(req);
  } catch (e) {
    return jsonError(res, 400, `invalid JSON body: ${(e as Error).message}`);
  }
  const parsed = parseJobBody(raw, ctx.generateId);
  if (!parsed.ok) return jsonError(res, parsed.status, parsed.error);
  const job = parsed.body;

  const preflightTimeoutMs = ctx.preflightTimeoutMs ?? 1500;

  // Build the candidate list. A pinned `targetProviderDid` restricts
  // dispatch to that owner's machines (optionally a single machine via
  // `targetMachineId`); otherwise we get the whole eligible list, best-first.
  // Either way we preflight + fail over through the resulting list — a DID
  // can now span several machines, so "pinned" still means "this owner" but
  // can land on whichever of their machines is live.
  let candidates: ProviderEntry[];
  if (job.targetProviderDid) {
    const now = Date.now();
    const maxAge = ctx.attestationMaxAgeMs;
    const machines = ctx.registry
      .getMachines(job.targetProviderDid)
      .filter((m) => !job.targetMachineId || m.machineId === job.targetMachineId);
    if (machines.length === 0) {
      return jsonError(res, 503, `provider ${job.targetProviderDid} not connected`);
    }
    // Apply the same eligibility the open pool gets: owner-active, attested,
    // fresh, and in good standing. Naming a provider doesn't buy a pass on
    // attestation freshness or route work to a machine the owner stopped /
    // that's been flagged unhealthy.
    const eligible = machines.filter((m) => {
      if (m.active === false) return false;
      if (m.attestedAt === null) return false;
      if (typeof maxAge === "number" && Number.isFinite(maxAge) && now - m.attestedAt > maxAge) {
        return false;
      }
      if (m.unhealthyAt !== null) return false;
      return true;
    });
    if (eligible.length === 0) {
      return jsonError(
        res,
        503,
        `provider ${job.targetProviderDid} has no attested, healthy machine available`,
      );
    }
    eligible.sort((a, b) => b.lastSeen - a.lastSeen);
    candidates = eligible;
  } else {
    candidates = ctx.registry.pickCandidates(job.model || undefined, true, ctx.attestationMaxAgeMs);
    if (candidates.length === 0) {
      return jsonError(res, 503, "no attested providers available");
    }
  }

  // Spread load across an owner's capable machines. The candidate list
  // arrives sorted freshest-heartbeat-first, and the preflight loop below
  // dispatches to the first responder — so a burst of near-simultaneous
  // requests would otherwise pile entirely onto whichever single machine is
  // instantaneously freshest, starving an equally-capable sibling that just
  // came online (the "resumed this machine but it serves nothing while the
  // other one does everything" report). Re-rank by current in-flight load so
  // each request in a burst lands on the least-busy machine; freshest
  // heartbeat stays the tie-break, so the single-machine and idle-fleet cases
  // behave exactly as before. The eligibility + preflight guarantees are
  // untouched — every candidate here is already attested, active, healthy,
  // and model-matching, and still gets a liveness ping before dispatch.
  candidates = [...candidates].sort((a, b) => {
    const loadA = ctx.sessions.inflightFor(a.did, a.machineId);
    const loadB = ctx.sessions.inflightFor(b.did, b.machineId);
    if (loadA !== loadB) return loadA - loadB;
    return b.lastSeen - a.lastSeen;
  });

  // Preflight each candidate and route to the first that answers. A
  // silent provider is marked unhealthy and told its standing changed
  // (so the operator gets a red ping), then we move on — the requester
  // transparently lands on a live machine instead of hanging on a dead
  // one. The chosen provider answered a round-trip through its serve loop
  // a moment ago, so it's genuinely ready to take the job.
  let provider: ProviderEntry | null = null;
  let probed = 0;
  for (const cand of candidates) {
    probed += 1;
    let alive = false;
    try {
      alive = await cand.ping(preflightTimeoutMs);
    } catch {
      alive = false;
    }
    // The requester may have hung up while we were probing.
    if (res.writableEnded) return;
    if (alive) {
      ctx.registry.markHealthy(cand.did, cand.machineId);
      provider = cand;
      break;
    }
    ctx.registry.markUnhealthy(cand.did, cand.machineId, "preflight-no-response");
    try {
      // Tell the machine it's out of rotation AND ask it to self-right now,
      // rather than waiting for its next scheduled health tick. The console
      // can also trigger this on demand via /control.
      cand.send({ type: "health_notice", standing: "bad", reason: "preflight-no-response" });
      cand.send({ type: "recover_request", reason: "preflight-no-response" });
    } catch {
      // socket already gone; the sweeper / close hook will clean up
    }
    console.error(
      `[jobs] preflight no-response did=${cand.did} machine=${cand.machineId}; marking unhealthy, requesting self-right, trying next`,
    );
  }

  if (!provider) {
    return jsonError(
      res,
      503,
      `no responsive providers available (preflighted ${probed}, none answered in ${preflightTimeoutMs}ms)`,
    );
  }

  ctx.sessions.open(
    job.sessionId,
    provider.did,
    provider.machineId,
    job.requesterDid,
    res,
    receivedAt,
  );

  // Hook so we drop the session if the requester goes away mid-stream.
  req.on("close", () => {
    if (ctx.sessions.has(job.sessionId)) {
      ctx.sessions.close(job.sessionId, "client-disconnected");
    }
  });

  const inferenceFrame: AdvisorMessage = {
    type: "inference_request",
    job_uri: job.jobUri,
    ...(job.jobCid ? { job_cid: job.jobCid } : {}),
    requester_did: job.requesterDid,
    requester_pub_key: job.requesterPubKey,
    model: job.model,
    max_tokens_out: job.maxTokensOut,
    ciphertext: job.ciphertext,
    session_id: job.sessionId,
  } as InferenceRequest & { type: "inference_request" };

  try {
    provider.send(inferenceFrame);
    // Account the dispatch for silent-failure detection. `recordDispatch`
    // returns true on the heartbeat-free edge where this dispatch is the one
    // that tips the provider over the threshold with still-zero completions
    // — log the flip once so the operator sees a machine that's accepting
    // work and producing nothing.
    if (ctx.registry.recordDispatch(provider.did, provider.machineId)) {
      console.error(
        `[jobs] silent-failure detected did=${provider.did}: dispatched jobs but no completions observed`,
      );
    }
  } catch (e) {
    ctx.sessions.close(job.sessionId, `provider-send-failed: ${(e as Error).message}`);
  }
}

function jsonError(res: ServerResponse, status: number, error: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error }));
}
