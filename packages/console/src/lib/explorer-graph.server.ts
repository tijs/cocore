// Assembles the network-explorer graph: people (accounts) + the
// machines they run + the directed trust (friend) edges between them.
//
// Pure read over the AppView. Every source is fetched with
// `Effect.either` so a single slow/missing endpoint degrades
// gracefully — e.g. before the AppView is redeployed with
// `listFriendEdges`, the graph still renders all the nodes, just
// without edges. Cached for a few minutes like the marketing
// snapshot; the explorer is a read-only browse surface, not a
// live dashboard.

import { Effect } from "effect";

import {
  type AppviewAccountSummary,
  type AppviewFriendEdge,
  type AppviewIndexedRecord,
  type JsonValue,
  appviewListAccountsEffect,
  appviewListFriendEdgesEffect,
  appviewListProfilesEffect,
  appviewListProvidersEffect,
} from "@/integrations/appview/appview.server.ts";
import { runTraced } from "@/lib/o11y.server.ts";

/** One person/account in the network graph, enriched with the
 *  hardware they run and their trust degree. */
export interface ExplorerNode {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Runs at least one machine. */
  isProvider: boolean;
  /** Provider-record count (machines) for this DID. */
  machines: number;
  /** Summed RAM (GB) across this DID's machines. */
  ramGB: number;
  /** Summed CPU cores across machines that report them. */
  cpuCores: number;
  /** Distinct chip strings across machines (e.g. "Apple M3 Max"). */
  chips: string[];
  /** Distinct supported models across machines. */
  models: string[];
  /** Outgoing trust: machines this DID is willing to route jobs to. */
  trustsOut: number;
  /** Incoming trust: how many DIDs route their jobs to this DID. */
  trustedByIn: number;
  lastActivityAt: string | null;
}

/** A directed trust edge: `source` trusts `target` to run its jobs. */
export interface ExplorerEdge {
  source: string;
  target: string;
}

export interface ExplorerGraph {
  generatedAt: string;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  summary: {
    people: number;
    providers: number;
    machines: number;
    totalRamGB: number;
    totalCpuCores: number;
    trustEdges: number;
  };
}

// Hard cap on rendered nodes so the client force-sim stays smooth.
// Far above today's network; we keep the most-connected + most-active
// nodes if it's ever exceeded (see trimToCap).
const MAX_NODES = 220;
const CACHE_TTL_MS = 5 * 60_000;
let cache: { expiresAt: number; graph: ExplorerGraph } | null = null;

function asObject(body: JsonValue): Record<string, JsonValue> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, JsonValue>;
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

interface ProfileFields {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

function profilesByDidFromRows(rows: AppviewIndexedRecord[]): Map<string, ProfileFields> {
  const map = new Map<string, ProfileFields>();
  for (const row of rows) {
    const o = asObject(row.body);
    if (!o) continue;
    map.set(row.repo, {
      handle: safeString(o["handle"]),
      displayName: safeString(o["displayName"]),
      avatarUrl: safeString(o["avatarUrl"]),
    });
  }
  return map;
}

function mergeProfile(node: ExplorerNode, profile: ProfileFields | undefined): void {
  if (!profile) return;
  if (!node.handle && profile.handle) node.handle = profile.handle;
  if (!node.displayName && profile.displayName) node.displayName = profile.displayName;
  if (!node.avatarUrl && profile.avatarUrl) node.avatarUrl = profile.avatarUrl;
}

interface ProviderAgg {
  machines: number;
  ramGB: number;
  cpuCores: number;
  chips: Set<string>;
  models: Set<string>;
}

/** Group raw provider records by owning DID, summing hardware. */
function aggregateProviders(rows: AppviewIndexedRecord[]): Map<string, ProviderAgg> {
  const byDid = new Map<string, ProviderAgg>();
  for (const row of rows) {
    const o = asObject(row.body);
    if (!o) continue;
    let agg = byDid.get(row.repo);
    if (!agg) {
      agg = { machines: 0, ramGB: 0, cpuCores: 0, chips: new Set(), models: new Set() };
      byDid.set(row.repo, agg);
    }
    agg.machines += 1;
    if (typeof o["ramGB"] === "number" && Number.isFinite(o["ramGB"]) && o["ramGB"] > 0) {
      agg.ramGB += o["ramGB"];
    }
    if (typeof o["cpuCores"] === "number" && Number.isFinite(o["cpuCores"]) && o["cpuCores"] > 0) {
      agg.cpuCores += o["cpuCores"];
    }
    if (typeof o["chip"] === "string" && o["chip"].length > 0) agg.chips.add(o["chip"]);
    const sm = o["supportedModels"];
    if (Array.isArray(sm)) {
      for (const m of sm) if (typeof m === "string" && m.length > 0) agg.models.add(m);
    }
  }
  return byDid;
}

function blankNode(did: string): ExplorerNode {
  return {
    did,
    handle: null,
    displayName: null,
    avatarUrl: null,
    isProvider: false,
    machines: 0,
    ramGB: 0,
    cpuCores: 0,
    chips: [],
    models: [],
    trustsOut: 0,
    trustedByIn: 0,
    lastActivityAt: null,
  };
}

/** A node's importance for the cap trim: connected + provider-heavy
 *  + recently active nodes are kept first. */
function nodeWeight(n: ExplorerNode): number {
  return n.trustsOut + n.trustedByIn + (n.isProvider ? 3 : 0) + n.machines;
}

async function buildExplorerGraph(): Promise<ExplorerGraph> {
  const generatedAt = new Date().toISOString();

  const [accountsR, providersR, edgesR, profilesR] = await runTraced(
    "explorer.graph.appview",
    Effect.all(
      [
        Effect.either(appviewListAccountsEffect({ limit: 100, sortBy: "recent" })),
        Effect.either(appviewListProvidersEffect),
        Effect.either(appviewListFriendEdgesEffect({ limit: 5000 })),
        Effect.either(appviewListProfilesEffect),
      ],
      { concurrency: "unbounded" },
    ),
  );

  const accounts: AppviewAccountSummary[] =
    accountsR._tag === "Right" ? accountsR.right.accounts : [];
  const providers: AppviewIndexedRecord[] =
    providersR._tag === "Right" ? providersR.right.providers : [];
  const rawEdges: AppviewFriendEdge[] = edgesR._tag === "Right" ? edgesR.right.edges : [];
  const profilesByDid = profilesByDidFromRows(
    profilesR._tag === "Right" ? profilesR.right.profiles : [],
  );

  const providerAgg = aggregateProviders(providers);

  // Seed nodes from the accounts directory (carries handle + avatar).
  const nodes = new Map<string, ExplorerNode>();
  for (const a of accounts) {
    const node = blankNode(a.did);
    node.handle = a.handle;
    node.displayName = a.displayName;
    node.avatarUrl = a.avatarUrl;
    node.isProvider = a.isProvider;
    node.lastActivityAt = a.lastActivityAt ?? null;
    mergeProfile(node, profilesByDid.get(a.did));
    nodes.set(a.did, node);
  }
  // Ensure every provider DID + every edge endpoint exists as a node,
  // even if the accounts directory didn't surface it.
  const ensure = (did: string): ExplorerNode => {
    let n = nodes.get(did);
    if (!n) {
      n = blankNode(did);
      mergeProfile(n, profilesByDid.get(did));
      nodes.set(did, n);
    }
    return n;
  };
  for (const did of providerAgg.keys()) ensure(did);

  // Fold in hardware aggregates.
  for (const [did, agg] of providerAgg) {
    const n = ensure(did);
    n.machines = agg.machines;
    n.ramGB = agg.ramGB;
    n.cpuCores = agg.cpuCores;
    n.chips = [...agg.chips];
    n.models = [...agg.models];
    if (agg.machines > 0) n.isProvider = true;
  }

  // Edges (both endpoints become nodes) + trust degree.
  const edges: ExplorerEdge[] = [];
  for (const e of rawEdges) {
    const from = ensure(e.friender);
    const to = ensure(e.subject);
    from.trustsOut += 1;
    to.trustedByIn += 1;
    edges.push({ source: e.friender, target: e.subject });
  }

  // Cap node count for client-side sim performance, keeping the
  // most-connected/active nodes and dropping dangling edges.
  let nodeList = [...nodes.values()];
  let keptEdges = edges;
  if (nodeList.length > MAX_NODES) {
    nodeList = nodeList.sort((a, b) => nodeWeight(b) - nodeWeight(a)).slice(0, MAX_NODES);
    const kept = new Set(nodeList.map((n) => n.did));
    keptEdges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  }

  for (const node of nodeList) {
    mergeProfile(node, profilesByDid.get(node.did));
  }

  const summary = {
    people: nodeList.length,
    providers: nodeList.filter((n) => n.isProvider).length,
    machines: nodeList.reduce((s, n) => s + n.machines, 0),
    totalRamGB: nodeList.reduce((s, n) => s + n.ramGB, 0),
    totalCpuCores: nodeList.reduce((s, n) => s + n.cpuCores, 0),
    trustEdges: keptEdges.length,
  };

  return { generatedAt, nodes: nodeList, edges: keptEdges, summary };
}

export async function getExplorerGraphCached(): Promise<ExplorerGraph> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.graph;
  const graph = await buildExplorerGraph();
  cache = { expiresAt: now + CACHE_TTL_MS, graph };
  return graph;
}
