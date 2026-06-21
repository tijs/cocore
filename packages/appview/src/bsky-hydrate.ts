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
// Cache: an in-process effect `Cache` keyed by DID with a
// configurable TTL (1 hour default). One bsky round-trip per DID
// per TTL window across all directory page-loads, and concurrent
// lookups for the same DID collapse onto a single in-flight fetch
// for free. Negative results are cached too (with a shorter TTL) so
// a failed lookup doesn't retry on every page load.

import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { makeRuntime } from "@cocore/o11y";
import { Cache, Duration, Effect, Exit } from "effect";

interface Hydrated {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h for positive results
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // 5m for "not found" — recover faster
const MAX_CACHE_ENTRIES = 10_000;

// One o11y runtime for the module — provides the tracing layer that
// `Effect.withSpan` reports through. Cache construction provides its
// own HttpClient layer (below), so `cache.get` needs no environment
// and runs cleanly on this runtime.
const runtime = makeRuntime({ serviceName: "cocore-appview" });

/** Fetch identity for one DID from the public bsky appview.
 *  Returns null on any failure (network, non-2xx, malformed). This
 *  is the cache `lookup`; the `Cache` itself handles TTL + dedup. */
const lookup = (did: string): Effect.Effect<Hydrated | null, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(
      "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
    ).pipe(
      HttpClientRequest.setUrlParam("actor", did),
      HttpClientRequest.setHeader("accept", "application/json"),
    );
    const res = yield* client.execute(request);
    if (res.status < 200 || res.status >= 300) return null;
    const body = (yield* res.json) as {
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
  }).pipe(Effect.catchAll(() => Effect.succeed<Hydrated | null>(null)));

// Build the cache eagerly, providing the fetch-backed HttpClient
// directly so the environment is baked in (and `cache.get` requires
// nothing). `FetchHttpClient.layer` reads `globalThis.fetch` at
// request time, so the test's fetch mock keeps working. Built
// synchronously so `__resetHydrateCacheForTests` can stay sync.
const cache = Effect.runSync(
  Cache.makeWith({
    capacity: MAX_CACHE_ENTRIES,
    lookup,
    // Positive results live for 1h; negative ("not found") results
    // expire after 5m so a transient failure recovers faster. The
    // lookup never fails (it catches into `null`), so the exit is
    // always a success whose value distinguishes the two TTLs.
    timeToLive: (exit: Exit.Exit<Hydrated | null, never>) =>
      Duration.millis(
        Exit.isSuccess(exit) && exit.value !== null ? DEFAULT_TTL_MS : NEGATIVE_TTL_MS,
      ),
  }).pipe(Effect.provide(FetchHttpClient.layer)),
);

/** Resolve identity for N DIDs in parallel. Used by `listAccounts`
 *  to fill in the directory page in a single fan-out. Order of the
 *  returned map is not meaningful; callers index by DID. */
export async function hydrateDids(dids: string[]): Promise<Map<string, Hydrated>> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const results = yield* Effect.forEach(dids, (did) => cache.get(did), {
        concurrency: "unbounded",
      });
      const out = new Map<string, Hydrated>();
      dids.forEach((did, i) => {
        const v = results[i];
        if (v) out.set(did, v);
      });
      return out;
    }).pipe(Effect.withSpan("bsky.hydrate", { attributes: { count: dids.length } })),
  );
}

/** Test seam — flush the cache so a test doesn't leak state into
 *  the next one. */
export function __resetHydrateCacheForTests(): void {
  Effect.runSync(cache.invalidateAll);
}
