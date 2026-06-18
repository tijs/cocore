// Dispute opener + resolver for the cocore exchange.
//
// Disputes live in the EXCHANGE'S repo at NSID
// `dev.cocore.compute.dispute`. The lexicon constrains
// `record.exchange` to equal the repo it's published in, so only
// the exchange that signed the original settlement can sign its
// dispute. That's enforced cryptographically by the PDS (auth on
// write) and structurally by the lexicon's constraint.
//
// Lifecycle:
//   * `openDispute(...)` creates a record with status="open" and
//     an unset `outcome`. Called when:
//       - Stripe `charge.dispute.created` fires (forwarded from the
//         console webhook; the exchange owns the adjudication).
//       - An operator manually files one via an internal tool.
//   * `resolveDispute(...)` updates the existing record in place to
//     status="resolved" with a verdict, optionally strong-refing a
//     compensating refund settlement (status="refunded").
//
// We don't ship a refund-settlement helper here yet — when the
// exchange decides to refund, the operator publishes a
// dev.cocore.compute.settlement with status="refunded" and
// `refundOf` pointing at the original. The dispute resolver then
// strong-refs that record. Keeping the refund machinery in the
// settlement layer (publisher.ts) means we don't fork the
// "exchange writes a settlement" path.

import type { StrongRef } from "@cocore/sdk/types";

import type { PublishedRecord } from "./publisher.ts";
import { type PrivateJwk, signRecord } from "./signing.ts";

type DisputeReasonCategory =
  | "fraud"
  | "non-delivery"
  | "quality-failure"
  | "processor-chargeback"
  | "duplicate-charge"
  | "other";

type DisputeVerdict = "refund-full" | "refund-partial" | "uphold-charge" | "forfeit-payout";

interface DisputeReason {
  category: DisputeReasonCategory;
  detail?: string;
}

interface DisputeOutcome {
  verdict: DisputeVerdict;
  refundSettlement?: StrongRef;
  rationale?: string;
  decidedAt: string;
}

export interface DisputeRecord {
  $type: "dev.cocore.compute.dispute";
  settlement: StrongRef;
  exchange: string;
  raisedBy: string;
  raisedAt: string;
  reason: DisputeReason;
  status: "open" | "resolved";
  outcome?: DisputeOutcome;
  evidenceCid?: string;
  sig?: string;
  createdAt: string;
}

/** Pluggable transport for writing dispute records. The default
 *  implementation in {@link MemoryDisputeTransport} keeps the records
 *  in-process for tests; production uses the same console-proxy
 *  surface as settlements. */
export interface DisputeTransport {
  create(exchangeDid: string, record: DisputeRecord): Promise<PublishedRecord>;
  /** Update an existing dispute by URI. PDS putRecord with swap-on-CID
   *  to avoid a write-read race when two operator actions resolve the
   *  same dispute in parallel. */
  update(
    exchangeDid: string,
    uri: string,
    swapCid: string,
    record: DisputeRecord,
  ): Promise<PublishedRecord>;
}

export class MemoryDisputeTransport implements DisputeTransport {
  readonly stored = new Map<string, { cid: string; record: DisputeRecord }>();

  async create(exchangeDid: string, record: DisputeRecord): Promise<PublishedRecord> {
    const rkey = randomTid();
    const uri = `at://${exchangeDid}/dev.cocore.compute.dispute/${rkey}`;
    const cid = `bafyrei-mem-dispute-${rkey}`;
    this.stored.set(uri, { cid, record });
    return { uri, cid };
  }

  async update(
    _exchangeDid: string,
    uri: string,
    swapCid: string,
    record: DisputeRecord,
  ): Promise<PublishedRecord> {
    const prior = this.stored.get(uri);
    if (!prior) throw new Error(`no prior dispute at ${uri}`);
    if (prior.cid !== swapCid) throw new Error(`swap-cid mismatch on ${uri}`);
    const cid = `bafyrei-mem-dispute-${uri.split("/").pop()}-v${Date.now()}`;
    this.stored.set(uri, { cid, record });
    return { uri, cid };
  }
}

export interface DisputeService {
  openDispute(input: {
    settlement: StrongRef;
    raisedBy: string;
    raisedAt: string;
    reason: DisputeReason;
    evidenceCid?: string;
  }): Promise<{ published: PublishedRecord; record: DisputeRecord }>;

  resolveDispute(input: {
    /** The published dispute record's URI + CID, returned from openDispute. */
    uri: string;
    swapCid: string;
    /** Original record body so we can update it in place; resolveDispute
     *  doesn't refetch — callers that want a fresh read can do so
     *  themselves and pass the latest record here. */
    prior: DisputeRecord;
    outcome: DisputeOutcome;
  }): Promise<{ published: PublishedRecord; record: DisputeRecord }>;
}

export class ExchangeDisputeService implements DisputeService {
  private readonly exchangeDid: string;
  private readonly transport: DisputeTransport;
  private readonly signingKey?: PrivateJwk;

  constructor(opts: { exchangeDid: string; transport: DisputeTransport; signingKey?: PrivateJwk }) {
    this.exchangeDid = opts.exchangeDid;
    this.transport = opts.transport;
    this.signingKey = opts.signingKey;
  }

  async openDispute(
    input: Parameters<DisputeService["openDispute"]>[0],
  ): ReturnType<DisputeService["openDispute"]> {
    const record: DisputeRecord = {
      $type: "dev.cocore.compute.dispute",
      settlement: input.settlement,
      exchange: this.exchangeDid,
      raisedBy: input.raisedBy,
      raisedAt: input.raisedAt,
      reason: input.reason,
      status: "open",
      ...(input.evidenceCid ? { evidenceCid: input.evidenceCid } : {}),
      createdAt: new Date().toISOString(),
    };
    const signed = await this.signed(record);
    const published = await this.transport.create(this.exchangeDid, signed);
    return { published, record: signed };
  }

  async resolveDispute(
    input: Parameters<DisputeService["resolveDispute"]>[0],
  ): ReturnType<DisputeService["resolveDispute"]> {
    if (input.prior.status === "resolved") {
      throw new Error(`dispute ${input.uri} already resolved`);
    }
    if (
      (input.outcome.verdict === "refund-full" || input.outcome.verdict === "refund-partial") &&
      !input.outcome.refundSettlement
    ) {
      throw new Error(`verdict ${input.outcome.verdict} requires refundSettlement strong-ref`);
    }
    const record: DisputeRecord = {
      ...input.prior,
      status: "resolved",
      outcome: input.outcome,
    };
    const signed = await this.signed(record);
    const published = await this.transport.update(
      this.exchangeDid,
      input.uri,
      input.swapCid,
      signed,
    );
    return { published, record: signed };
  }

  private async signed(record: DisputeRecord): Promise<DisputeRecord> {
    if (!this.signingKey) return record;
    const sig = await signRecord(record as unknown as Record<string, unknown>, this.signingKey);
    return { ...record, sig };
  }
}

function randomTid(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
