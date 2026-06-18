// Read + publish dev.cocore.compute.termsAcceptance records.
//
// The console-side flow:
//   1. On every signed-in page load the modal asks the server "is
//      the current user up-to-date with the active exchange's
//      terms?" — which calls `getActiveTermsStateEffect(session)`.
//   2. That helper finds the freshest active `exchangePolicy` on
//      the configured exchange's PDS, pulls its `termsVersion`,
//      then lists the user's `termsAcceptance` records and looks
//      for one whose `termsVersion` matches.
//   3. If no match, the modal blocks all interaction until the
//      user clicks "I agree" — which calls
//      `acceptTermsServerFn` to publish a fresh
//      `termsAcceptance` record under their DID.

import type { OAuthSession } from "@atcute/oauth-node-client";
import { Effect } from "effect";

import { cocoreConfig } from "@/lib/cocore-config.ts";

interface ListRecordsResponse {
  records?: Array<{ uri: string; cid: string; value: Record<string, unknown> }>;
  cursor?: string;
}

interface PolicySummary {
  uri: string;
  cid: string;
  termsVersion: string | null;
  termsUri: string | null;
}

/** Find the freshest `dev.cocore.compute.exchangePolicy` record in
 *  the exchange's repo. Returns null if no policy is found. */
async function fetchActivePolicy(exchangeDid: string): Promise<PolicySummary | null> {
  // The exchange's PDS endpoint resolves from the DID. For did:plc we
  // hit plc.directory; for did:web we look at the host's well-known.
  // Both cases come back with a service entry of type
  // AtprotoPersonalDataServer.
  let pdsEndpoint: string | null = null;
  if (exchangeDid.startsWith("did:plc:")) {
    try {
      const r = await fetch(`https://plc.directory/${encodeURIComponent(exchangeDid)}`);
      if (!r.ok) return null;
      const doc = (await r.json()) as {
        service?: Array<{ type?: string; serviceEndpoint?: string }>;
      };
      const svc = (doc.service ?? []).find(
        (s) => s.type === "AtprotoPersonalDataServer" && typeof s.serviceEndpoint === "string",
      );
      pdsEndpoint = svc?.serviceEndpoint ?? null;
    } catch {
      return null;
    }
  } else if (exchangeDid.startsWith("did:web:")) {
    // did:web exchanges don't have a PDS in the bsky sense; their
    // policy lives on whichever ATProto repo the operator picked.
    // We don't yet support resolving these — return null and the
    // modal won't block.
    return null;
  } else {
    return null;
  }
  if (!pdsEndpoint) return null;

  // The atproto listRecords default is rkey-DESCENDING (newest TID
  // first). `reverse=true` returns rkey-ASCENDING (oldest first) —
  // the original implementation here used `reverse=true` thinking
  // it meant "newest first," which produced the inverse behavior:
  // the gate's "freshest active" scan picked the oldest v1 record
  // from 2026-05-09 even after we'd published v1-2026-05-10b. Any
  // user who'd accepted v1 looked already-up-to-date forever.
  // Drop `reverse=true` so the default newest-first applies, and
  // belt-and-suspenders sort by createdAt descending in case some
  // future PDS implementation uses a different default sort.
  const params = new URLSearchParams({
    repo: exchangeDid,
    collection: "dev.cocore.compute.exchangePolicy",
    limit: "20",
  });
  const r = await fetch(
    `${pdsEndpoint.replace(/\/$/, "")}/xrpc/com.atproto.repo.listRecords?${params}`,
  );
  if (!r.ok) return null;
  const body = (await r.json()) as ListRecordsResponse;
  const sorted = (body.records ?? []).slice().sort((a, b) => {
    const ac = typeof a.value["createdAt"] === "string" ? (a.value["createdAt"] as string) : "";
    const bc = typeof b.value["createdAt"] === "string" ? (b.value["createdAt"] as string) : "";
    return bc.localeCompare(ac);
  });
  for (const rec of sorted) {
    const v = rec.value;
    if (v.active === false) continue;
    return {
      uri: rec.uri,
      cid: rec.cid,
      termsVersion: typeof v.termsVersion === "string" ? v.termsVersion : null,
      termsUri: typeof v.termsUri === "string" ? v.termsUri : null,
    };
  }
  return null;
}

async function listMyAcceptances(
  session: OAuthSession,
): Promise<Array<{ uri: string; termsVersion: string | null; exchange: string | null }>> {
  const params = new URLSearchParams({
    repo: session.did,
    collection: "dev.cocore.compute.termsAcceptance",
    limit: "100",
    reverse: "true",
  });
  const r = await session.handle(`/xrpc/com.atproto.repo.listRecords?${params}`, {
    method: "GET",
  });
  if (!r.ok) return [];
  const body = (await r.json()) as ListRecordsResponse;
  return (body.records ?? []).map((rec) => ({
    uri: rec.uri,
    termsVersion:
      typeof rec.value.termsVersion === "string" ? (rec.value.termsVersion as string) : null,
    exchange: typeof rec.value.exchange === "string" ? (rec.value.exchange as string) : null,
  }));
}

export interface TermsState {
  /** The active exchange policy + its terms version. Null if we
   *  couldn't resolve it (e.g. did:web exchange or PLC unreachable);
   *  the modal degrades to "no prompt" in that case. */
  activePolicy: PolicySummary | null;
  /** Whether the signed-in user has a current termsAcceptance. */
  accepted: boolean;
  /** Whether the user has ever accepted ANY terms version with this
   *  exchange before. Lets the gate distinguish "the terms changed"
   *  (they agreed to a prior version) from a first-time acceptance
   *  (they've never agreed to anything — nothing has "changed"). */
  hasPriorAcceptance: boolean;
}

/** Hard-coded stub returned for any did:web exchange when running
 *  outside production, so `mise dev` doesn't strand signed-in users
 *  on the "service initializing" page. The real flow needs a
 *  published `dev.cocore.compute.exchangePolicy` resolvable from
 *  the exchange DID; did:web exchanges have no PDS lookup wired up
 *  yet. Pretend a policy exists and that the user has accepted it.
 *  Bumping the version here doesn't re-prompt anyone; this codepath
 *  exists only to unblock dev. */
function devStubPolicyFor(exchangeDid: string): PolicySummary {
  return {
    uri: `at://${exchangeDid}/dev.cocore.compute.exchangePolicy/dev-stub`,
    cid: "bafyreigh2akiscaildc5sgz5wybizysiehxiv4dhpwwqouytxnvgkpkcaq",
    termsVersion: "v0-local-dev",
    termsUri: "/terms",
  };
}

function isLocalDevExchange(exchangeDid: string): boolean {
  if (process.env["NODE_ENV"] === "production") return false;
  return exchangeDid.startsWith("did:web:");
}

export function getActiveTermsStateEffect(session: OAuthSession): Effect.Effect<TermsState> {
  return Effect.promise(async () => {
    const exchangeDid = cocoreConfig().exchangeDid;
    if (isLocalDevExchange(exchangeDid)) {
      return {
        activePolicy: devStubPolicyFor(exchangeDid),
        accepted: true,
        hasPriorAcceptance: true,
      };
    }
    const activePolicy = await fetchActivePolicy(exchangeDid);
    if (!activePolicy || !activePolicy.termsVersion) {
      // No active policy means the exchange hasn't published one yet
      // (fresh deploy, or a wipe ahead of re-bootstrap). The gate at
      // `_header-layout.tsx` reads `accepted: false` + a null policy
      // and renders the "service initializing" variant — better UX
      // than the previous behavior, which silently treated missing
      // policy as "everything's fine, proceed" and let users into the
      // app without any terms record.
      return { activePolicy, accepted: false, hasPriorAcceptance: false };
    }
    const acceptances = await listMyAcceptances(session);
    const accepted = acceptances.some(
      (a) => a.exchange === exchangeDid && a.termsVersion === activePolicy.termsVersion,
    );
    // Has the user agreed to ANY version of this exchange's terms before?
    // When the gate shows (accepted === false), any such record is for an
    // older version — so this is a genuine "terms changed" re-acceptance
    // rather than a first-time agreement.
    const hasPriorAcceptance = acceptances.some((a) => a.exchange === exchangeDid);
    return { activePolicy, accepted, hasPriorAcceptance };
  });
}

export interface AcceptTermsInputs {
  policyUri: string;
  policyCid: string;
  termsVersion: string;
  termsUri: string;
  userAgent?: string;
}

export async function acceptTerms(
  session: OAuthSession,
  inputs: AcceptTermsInputs,
): Promise<{ uri: string; cid: string }> {
  // Don't just write a record — get the exchange to COUNTERSIGN the
  // acceptance first, so the published record carries a cocore attestation
  // (an ES256 `sig` over its canonical bytes + a strong-ref to the
  // exchangeAttestation that names the signing key). The signing key lives
  // only on the services container, so we ask it to build + sign the exact
  // record, then persist that record verbatim under the user's PDS. The
  // exchange owns the canonical bytes; the user owns the repo.
  const { bridgeUrl, internalApiKey } = cocoreConfig();
  if (!internalApiKey) {
    throw new Error(
      "cannot countersign terms acceptance: COCORE_INTERNAL_API_KEY is not set on the console",
    );
  }
  const signResp = await fetch(
    `${bridgeUrl.replace(/\/$/, "")}/xrpc/dev.cocore.exchange.signTermsAcceptance`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${internalApiKey}`,
      },
      body: JSON.stringify({
        policyUri: inputs.policyUri,
        policyCid: inputs.policyCid,
        termsVersion: inputs.termsVersion,
        termsUri: inputs.termsUri,
        ...(inputs.userAgent ? { userAgent: inputs.userAgent } : {}),
      }),
    },
  );
  if (!signResp.ok) {
    const body = await signResp.text().catch(() => "");
    throw new Error(`exchange signTermsAcceptance ${signResp.status}: ${body.slice(0, 300)}`);
  }
  const { record } = (await signResp.json()) as { record: Record<string, unknown> };
  if (!record || typeof record["sig"] !== "string") {
    throw new Error("exchange did not return a signed terms-acceptance record");
  }

  // Persist the signed record VERBATIM — the `record` value (incl `$type`,
  // `attestation`, and `sig`) is exactly what the exchange signed over, so a
  // verifier re-canonicalises the stored record minus `sig` and it matches.
  const r = await session.handle(`/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: session.did,
      collection: "dev.cocore.compute.termsAcceptance",
      record,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`createRecord termsAcceptance ${r.status}: ${body.slice(0, 300)}`);
  }
  return (await r.json()) as { uri: string; cid: string };
}
