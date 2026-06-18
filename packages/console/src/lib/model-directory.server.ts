// Model directory — derive a "what's online right now?" view from
// the AppView's mirror of `dev.cocore.compute.provider` records,
// intersected with the advisor's live `/providers` list so stale
// PDS records for disconnected machines never appear as routable.
//
// Each provider record carries `supportedModels: string[]`, written
// by the agent at startup from its loaded engine registry. This file
// walks every indexed provider record, groups by model id, and
// produces a directory the console can render at /models and that
// api-docs pulls from instead of hardcoding a stale list of NSIDs.
//
// On top of the structural directory, we fold in two cross-cutting
// inputs from the AppView:
//
//   * `modelActivity` — per-model + per-provider request/token counts
//     in 1h/24h/7d/30d windows, computed from the indexed receipts.
//   * `listProfiles` — every `dev.cocore.account.profile` row, so we
//     can render display-name + handle chips next to each machine
//     without a per-DID round trip.
//
// Server-only: imports the appview client + Effect runtime.

import { Effect } from "effect";

import {
  appviewListProfilesEffect,
  appviewListProvidersEffect,
  appviewModelActivityEffect,
  type AppviewActivityStats,
  type AppviewModelActivityResponse,
} from "@/integrations/appview/appview.server.ts";
import { cocoreConfig } from "@/lib/cocore-config.ts";

interface PriceEntry {
  modelId?: string;
  inputPricePerMTok?: number;
  outputPricePerMTok?: number;
  currency?: string;
}

interface ProviderRecordView {
  machineLabel?: string;
  chip?: string;
  ramGB?: number;
  supportedModels?: string[];
  priceList?: PriceEntry[];
  attestationPubKey?: string;
  createdAt?: string;
}

interface ProfileRecordView {
  displayName?: string;
  handle?: string;
  avatarUrl?: string;
}

interface ProfileChip {
  did: string;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
}

interface ModelMachine {
  did: string;
  machineLabel: string | null;
  chip: string | null;
  ramGB: number | null;
  attestationPubKey: string | null;
  lastSeen: string | null;
  /** Host profile chip (display name + handle + avatar). null when
   *  the DID has no `dev.cocore.account.profile` record yet — the UI
   *  falls back to a shortened DID in that case. */
  host: ProfileChip | null;
  /** Per-window request + token totals from indexed receipts where
   *  this machine was the provider. Zeroes when the machine hasn't
   *  served anything for the model in any window. */
  activity: AppviewActivityStats;
}

export interface ModelDirectoryEntry {
  modelId: string;
  machineCount: number;
  machines: ModelMachine[];
  /** CC-per-MTok input rate from the freshest provider record that
   *  advertises the model. null when no provider includes the model
   *  in its `priceList`. */
  inputPricePerMTok: number | null;
  outputPricePerMTok: number | null;
  /** Currency code from the provider record's priceList entry —
   *  typically "CC". null when unknown. */
  currency: string | null;
  freshestAt: string | null;
  /** Aggregate request + token totals across every machine that has
   *  served the model in each window. */
  activity: AppviewActivityStats;
}

export interface ModelDirectoryResponse {
  models: ModelDirectoryEntry[];
  /** Wall-clock at the time we built this snapshot. Useful when the
   *  UI wants to render "as of …". */
  generatedAt: string;
  /** True when the AppView fetch failed and the response is built
   *  from an empty input set; the UI can warn instead of pretending
   *  nothing's online. */
  appviewUnreachable: boolean;
}

// Outage-aware logging. The directory is rebuilt on every page view,
// so a down AppView used to emit one identical stack trace per
// request — enough volume to bury the lines that explain *why* it's
// down. Instead: log the full error on the reachable→unreachable
// transition, re-log at most once per minute while it stays down,
// and log a single recovery line when it comes back.
const UNREACHABLE_RELOG_MS = 60_000;
let appviewUnreachableSince: number | null = null;
let lastUnreachableLogAt = 0;

function logAppviewUnreachable(reason: unknown): void {
  const now = Date.now();
  const since = appviewUnreachableSince ?? now;
  const isTransition = appviewUnreachableSince === null;
  appviewUnreachableSince = since;
  if (isTransition || now - lastUnreachableLogAt >= UNREACHABLE_RELOG_MS) {
    lastUnreachableLogAt = now;
    const downFor = isTransition ? "" : ` (down for ${Math.round((now - since) / 1000)}s)`;
    console.warn(`[model-directory] AppView listProviders failed${downFor}:`, reason);
  }
}

function logAppviewRecovered(): void {
  if (appviewUnreachableSince === null) return;
  const downForS = Math.round((Date.now() - appviewUnreachableSince) / 1000);
  appviewUnreachableSince = null;
  lastUnreachableLogAt = 0;
  console.warn(`[model-directory] AppView reachable again after ~${downForS}s`);
}

function pickPrice(entries: PriceEntry[] | undefined, modelId: string): PriceEntry | null {
  if (!entries) return null;
  return entries.find((e) => e?.modelId === modelId) ?? null;
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function safeNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function emptyActivityStats(): AppviewActivityStats {
  return {
    hour: { requests: 0, tokens: 0 },
    day: { requests: 0, tokens: 0 },
    week: { requests: 0, tokens: 0 },
    month: { requests: 0, tokens: 0 },
  };
}

/** Look up a model's activity for a given provider DID. Returns
 *  zeroes if either the model or the DID is missing from the
 *  activity aggregation. */
function activityFor(
  activity: AppviewModelActivityResponse | null,
  modelId: string,
  did: string,
): AppviewActivityStats {
  const m = activity?.models.find((row) => row.modelId === modelId);
  if (!m) return emptyActivityStats();
  const p = m.byProvider.find((row) => row.did === did);
  return p?.stats ?? emptyActivityStats();
}

function totalsFor(
  activity: AppviewModelActivityResponse | null,
  modelId: string,
): AppviewActivityStats {
  const m = activity?.models.find((row) => row.modelId === modelId);
  return m?.totals ?? emptyActivityStats();
}

interface AdvisorProviderRow {
  did: string;
  attestedAt: string | null;
  active?: boolean;
  lastSeen?: string;
}

/** DIDs the advisor currently considers routable — attested and not
 *  owner-paused. Matches the filter in inference-dispatch pickProvider
 *  plus the advisor registry's `active` gate. Returns null when the
 *  advisor is unreachable so callers can treat every indexed provider
 *  as offline rather than showing stale PDS records. */
async function fetchAdvisorOnlineDids(): Promise<Map<string, string> | null> {
  const base = cocoreConfig().advisorUrl.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/providers`);
    if (!r.ok) return null;
    const list = (await r.json()) as AdvisorProviderRow[];
    const online = new Map<string, string>();
    for (const p of list) {
      if (!p.attestedAt) continue;
      if (p.active === false) continue;
      online.set(p.did, p.lastSeen ?? p.attestedAt);
    }
    return online;
  } catch (reason) {
    console.warn("[model-directory] Advisor /providers failed:", reason);
    return null;
  }
}

export async function buildModelDirectory(): Promise<ModelDirectoryResponse> {
  const generatedAt = new Date().toISOString();

  // Pull providers, profiles, and activity in parallel. Each is
  // tolerant of AppView failure independently — providers being
  // unreachable means an empty directory, but a profile or
  // activity miss just means we render bare DIDs / zero counts.
  const [appviewResults, advisorOnline] = await Promise.all([
    Promise.allSettled([
      Effect.runPromise(appviewListProvidersEffect),
      Effect.runPromise(appviewListProfilesEffect),
      Effect.runPromise(appviewModelActivityEffect),
    ]),
    fetchAdvisorOnlineDids(),
  ]);
  const [providersResult, profilesResult, activityResult] = appviewResults;

  if (providersResult.status !== "fulfilled") {
    logAppviewUnreachable(providersResult.reason);
    return { models: [], generatedAt, appviewUnreachable: true };
  }
  logAppviewRecovered();

  const profilesByDid = new Map<string, ProfileChip>();
  if (profilesResult.status === "fulfilled") {
    for (const row of profilesResult.value.profiles) {
      const body = row.body as ProfileRecordView;
      profilesByDid.set(row.repo, {
        did: row.repo,
        displayName: safeString(body.displayName),
        handle: safeString(body.handle),
        avatarUrl: safeString(body.avatarUrl),
      });
    }
  } else {
    console.warn("[model-directory] AppView listProfiles failed:", profilesResult.reason);
  }

  const activity = activityResult.status === "fulfilled" ? activityResult.value : null;
  if (activityResult.status !== "fulfilled") {
    console.warn("[model-directory] AppView modelActivity failed:", activityResult.reason);
  }

  // Group machines by model id.
  const byModel = new Map<string, ModelDirectoryEntry>();
  for (const row of providersResult.value.providers) {
    const body = row.body as ProviderRecordView;
    const supportedModels = body.supportedModels ?? [];
    const did = row.repo;
    const lastSeen = safeString(body.createdAt) ?? safeString(row.indexedAt) ?? null;
    if (!advisorOnline?.has(did)) continue;

    for (const modelId of supportedModels) {
      if (typeof modelId !== "string" || modelId.length === 0) continue;
      let entry = byModel.get(modelId);
      if (!entry) {
        entry = {
          modelId,
          machineCount: 0,
          machines: [],
          inputPricePerMTok: null,
          outputPricePerMTok: null,
          currency: null,
          freshestAt: null,
          activity: totalsFor(activity, modelId),
        };
        byModel.set(modelId, entry);
      }
      const seen = advisorOnline.get(did) ?? lastSeen;
      entry.machines.push({
        did,
        machineLabel: safeString(body.machineLabel),
        chip: safeString(body.chip),
        ramGB: safeNumber(body.ramGB),
        attestationPubKey: safeString(body.attestationPubKey),
        lastSeen: seen,
        host: profilesByDid.get(did) ?? null,
        activity: activityFor(activity, modelId, did),
      });
      entry.machineCount = entry.machines.length;
      const price = pickPrice(body.priceList, modelId);
      if (price) {
        // Take the first price we see for the model id. The exchange
        // pins the rate uniform today, so machines agree; if a future
        // policy lets providers diverge, this is the surface that
        // gets updated to surface min/max instead of one.
        if (entry.inputPricePerMTok === null)
          entry.inputPricePerMTok = safeNumber(price.inputPricePerMTok);
        if (entry.outputPricePerMTok === null)
          entry.outputPricePerMTok = safeNumber(price.outputPricePerMTok);
        if (entry.currency === null) entry.currency = safeString(price.currency);
      }
      if (seen) {
        if (!entry.freshestAt || seen > entry.freshestAt) {
          entry.freshestAt = seen;
        }
      }
    }
  }

  // Sort models: most-provisioned first; within that, alphabetical.
  // `stub` is a connectivity smoke test, not a production model — and
  // every machine advertises it, so by machine-count it would otherwise
  // lead the directory and become the chat page's default. Force it last
  // regardless, so the lead entry (and the default) is always a real model.
  const models = Array.from(byModel.values())
    .filter((e) => e.machineCount > 0)
    .sort((a, b) => {
      const aStub = a.modelId.toLowerCase() === "stub";
      const bStub = b.modelId.toLowerCase() === "stub";
      if (aStub !== bStub) return aStub ? 1 : -1;
      if (a.machineCount !== b.machineCount) return b.machineCount - a.machineCount;
      return a.modelId.localeCompare(b.modelId);
    });

  return { models, generatedAt, appviewUnreachable: false };
}
