// Runtime lexicon registry for @cocore/sdk consumers.
//
// We intentionally don't run @atproto/lex-cli codegen here. The
// codegen output is volatile across lex-cli versions (0.9 renamed
// `gen-api` to `build`, with stricter cross-namespace ref handling),
// and we only consume two artefacts from it: the runtime
// `lexicons` registry and the NSID id strings. Both are tiny and
// trivially derivable from the JSON we already ship under
// /lexicons/dev/cocore/compute/.
//
//   import { lexicons, ids } from '@cocore/sdk/lex';
//
//   try {
//     lexicons.assertValidRecord(ids.DevCocoreComputeReceipt, body);
//   } catch (e) {
//     // body doesn't conform to dev.cocore.compute.receipt
//   }
//
// We extend the generated registry with the standard ATProto
// `com.atproto.repo.strongRef` schema (small, stable upstream).

import { Lexicons, type LexiconDoc } from "@atproto/lexicon";
import attestation from "../../../lexicons/dev/cocore/compute/attestation.json" with { type: "json" };
import defs from "../../../lexicons/dev/cocore/compute/defs.json" with { type: "json" };
import dispute from "../../../lexicons/dev/cocore/compute/dispute.json" with { type: "json" };
import exchangeAttestation from "../../../lexicons/dev/cocore/compute/exchangeAttestation.json" with { type: "json" };
import exchangePolicy from "../../../lexicons/dev/cocore/compute/exchangePolicy.json" with { type: "json" };
import job from "../../../lexicons/dev/cocore/compute/job.json" with { type: "json" };
import paymentAuthorization from "../../../lexicons/dev/cocore/compute/paymentAuthorization.json" with { type: "json" };
import provider from "../../../lexicons/dev/cocore/compute/provider.json" with { type: "json" };
import receipt from "../../../lexicons/dev/cocore/compute/receipt.json" with { type: "json" };
import settlement from "../../../lexicons/dev/cocore/compute/settlement.json" with { type: "json" };
import termsAcceptance from "../../../lexicons/dev/cocore/compute/termsAcceptance.json" with { type: "json" };
import latency from "../../../lexicons/dev/cocore/compute/latency.json" with { type: "json" };
import listJobs from "../../../lexicons/dev/cocore/compute/listJobs.json" with { type: "json" };
import listProviders from "../../../lexicons/dev/cocore/compute/listProviders.json" with { type: "json" };
import listReceipts from "../../../lexicons/dev/cocore/compute/listReceipts.json" with { type: "json" };
import listSettlements from "../../../lexicons/dev/cocore/compute/listSettlements.json" with { type: "json" };
import modelActivity from "../../../lexicons/dev/cocore/compute/modelActivity.json" with { type: "json" };
import verifyReceiptLex from "../../../lexicons/dev/cocore/compute/verifyReceipt.json" with { type: "json" };
import verifySettlementLex from "../../../lexicons/dev/cocore/compute/verifySettlement.json" with { type: "json" };

const COCORE_LEXICONS: LexiconDoc[] = [
  attestation as LexiconDoc,
  defs as LexiconDoc,
  dispute as LexiconDoc,
  exchangeAttestation as LexiconDoc,
  exchangePolicy as LexiconDoc,
  job as LexiconDoc,
  paymentAuthorization as LexiconDoc,
  provider as LexiconDoc,
  receipt as LexiconDoc,
  settlement as LexiconDoc,
  termsAcceptance as LexiconDoc,
  latency as LexiconDoc,
  listJobs as LexiconDoc,
  listProviders as LexiconDoc,
  listReceipts as LexiconDoc,
  listSettlements as LexiconDoc,
  modelActivity as LexiconDoc,
  verifyReceiptLex as LexiconDoc,
  verifySettlementLex as LexiconDoc,
];

// com.atproto.repo.strongRef schema, copied verbatim from
// bluesky-social/atproto/lexicons/com/atproto/repo/strongRef.json.
// Update if the upstream schema changes; small + stable.
const STRONG_REF: LexiconDoc = {
  lexicon: 1,
  id: "com.atproto.repo.strongRef",
  description: "A URI with a content-hash fingerprint.",
  defs: {
    main: {
      type: "object",
      required: ["uri", "cid"],
      properties: {
        uri: { type: "string", format: "at-uri" },
        cid: { type: "string", format: "cid" },
      },
    },
  },
};

export const lexicons = new Lexicons([...COCORE_LEXICONS, STRONG_REF]);

export const ids = {
  DevCocoreComputeAttestation: "dev.cocore.compute.attestation",
  DevCocoreComputeDefs: "dev.cocore.compute.defs",
  DevCocoreComputeDispute: "dev.cocore.compute.dispute",
  DevCocoreComputeExchangeAttestation: "dev.cocore.compute.exchangeAttestation",
  DevCocoreComputeExchangePolicy: "dev.cocore.compute.exchangePolicy",
  DevCocoreComputeJob: "dev.cocore.compute.job",
  DevCocoreComputePaymentAuthorization: "dev.cocore.compute.paymentAuthorization",
  DevCocoreComputeProvider: "dev.cocore.compute.provider",
  DevCocoreComputeReceipt: "dev.cocore.compute.receipt",
  DevCocoreComputeSettlement: "dev.cocore.compute.settlement",
  DevCocoreComputeTermsAcceptance: "dev.cocore.compute.termsAcceptance",
  DevCocoreComputeLatency: "dev.cocore.compute.latency",
  DevCocoreComputeListJobs: "dev.cocore.compute.listJobs",
  DevCocoreComputeListProviders: "dev.cocore.compute.listProviders",
  DevCocoreComputeListReceipts: "dev.cocore.compute.listReceipts",
  DevCocoreComputeListSettlements: "dev.cocore.compute.listSettlements",
  DevCocoreComputeModelActivity: "dev.cocore.compute.modelActivity",
  DevCocoreComputeVerifyReceipt: "dev.cocore.compute.verifyReceipt",
  DevCocoreComputeVerifySettlement: "dev.cocore.compute.verifySettlement",
} as const;

export const schemas: LexiconDoc[] = [...COCORE_LEXICONS, STRONG_REF];
