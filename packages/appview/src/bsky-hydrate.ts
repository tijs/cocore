// Server-side identity hydrator backed by the public bsky appview.
//
// Why this exists: most cocore members have OAuth'd in but never
// published a `dev.cocore.account.profile` record (the auto-
// provision path was broken before the indexer broadening + the
// scope fix landed). The discovery directory was rendering bare
// DIDs as a result, which looks bad. Fix: when our local profile
// table doesn't have a row for a DID, resolve handle + display
// name + avatar through `https://public.api.bsky.app/xrpc/
// app.bsky.actor.getProfile`. The bsky appview is public, has its
// own CDN-tier cache, and tolerates the kind of fanout a small
// AppView produces.
//
// Cache: an in-process Map keyed by DID with a configurable TTL
// (1 hour default). One bsky round-trip per DID per TTL window
// across all directory page-loads. Negative results are cached
// too (with a shorter TTL) so a failed lookup doesn't retry on
// every page load.

interface Hydrated {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface CacheEntry {
  value: Hydrated | null;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h for positive results
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // 5m for "not found" — recover faster
const MAX_CACHE_ENTRIES = 10_000;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Hydrated | null>>();

function getCached(did: string): Hydrated | null | undefined {
  const entry = cache.get(did);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(did);
    return undefined;
  }
  return entry.value;
}

function setCached(did: string, value: Hydrated | null): void {
  // Bounded LRU-ish: when over cap, drop the oldest insertion. Map
  // iteration order is insertion order, so taking the first key
  // gives us the oldest. Good enough for a cache that's ~hundreds
  // of entries in practice.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(did, {
    value,
    expiresAt: Date.now() + (value === null ? NEGATIVE_TTL_MS : DEFAULT_TTL_MS),
  });
}

/** Fetch identity for one DID from the public bsky appview.
 *  Returns null on any failure (network, 404, malformed). */
async function fetchOne(did: string): Promise<Hydrated | null> {
  const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile");
  url.searchParams.set("actor", did);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      did?: unknown;
      handle?: unknown;
      displayName?: unknown;
      avatar?: unknown;
    };
    if (typeof body.handle !== "string" || body.handle.length === 0) return null;
    return {
      handle: body.handle,
      displayName:
        typeof body.displayName === "string" && body.displayName.length > 0
          ? body.displayName
          : null,
      avatarUrl: typeof body.avatar === "string" && body.avatar.length > 0 ? body.avatar : null,
    };
  } catch {
    return null;
  }
}

/** Resolve identity for one DID, going through the cache. Multiple
 *  concurrent calls for the same DID collapse onto a single
 *  in-flight fetch via the `inFlight` map (prevents N parallel
 *  page-loads from each firing their own request when the cache is
 *  cold). */
async function hydrateOne(did: string): Promise<Hydrated | null> {
  const cached = getCached(did);
  if (cached !== undefined) return cached;
  const existing = inFlight.get(did);
  if (existing) return existing;
  const p = fetchOne(did).then((v) => {
    setCached(did, v);
    inFlight.delete(did);
    return v;
  });
  inFlight.set(did, p);
  return p;
}

/** Resolve identity for N DIDs in parallel. Used by `listAccounts`
 *  to fill in the directory page in a single fan-out. Order of the
 *  returned map is not meaningful; callers index by DID. */
export async function hydrateDids(dids: string[]): Promise<Map<string, Hydrated>> {
  const out = new Map<string, Hydrated>();
  const results = await Promise.all(dids.map(async (did) => [did, await hydrateOne(did)] as const));
  for (const [did, v] of results) {
    if (v) out.set(did, v);
  }
  return out;
}

/** Test seam — flush the cache so a test doesn't leak state into
 *  the next one. */
export function __resetHydrateCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
