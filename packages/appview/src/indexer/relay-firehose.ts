// RelayFirehose: real wire transport for the Indexer.
//
// Wraps @atproto/sync's Firehose so cocore code can subscribe to a
// relay's `com.atproto.sync.subscribeRepos` stream and dispatch
// every cocore record into our in-process Firehose (the seam in
// @cocore/sdk/firehose). Once started, two AppView operators
// running this against the same relay get byte-identical state for
// every cocore record — that's the federation invariant the
// project leans on.
//
// Each #commit event carries an array of ops; we filter to cocore
// collections and convert into IndexedRecord shapes.

import {
  Firehose as AtFirehose,
  FirehoseSubscriptionError,
  MemoryRunner,
  type Event as AtEvent,
} from "@atproto/sync";
import { IdResolver } from "@atproto/identity";
import { logWarn, makeRuntime, type O11yRuntime } from "@cocore/o11y";
import {
  COLLECTIONS,
  type CollectionId,
  type Firehose as CocoreFirehose,
  type IndexedRecord,
} from "@cocore/sdk";
import { Effect, Fiber, Schedule } from "effect";

/** All cocore collections the firehose listens for. `COLLECTIONS`
 *  itself only enumerates `dev.cocore.compute.*` (the receipt-side
 *  records); we additionally subscribe to the account lexicons
 *  (profile, tokenGrant, friend, tokenPatronage) so the AppView's
 *  discovery directory + profile pages + incoming-friends UI have
 *  the data they need. New account NSIDs land here when they ship. */
const ACCOUNT_COLLECTIONS = [
  "dev.cocore.account.profile",
  "dev.cocore.account.tokenGrant",
  "dev.cocore.account.tokenPatronage",
  "dev.cocore.account.friend",
] as const;

const ALL_COLLECTIONS = [...COLLECTIONS, ...ACCOUNT_COLLECTIONS];

const COLLECTION_SET = new Set<string>(ALL_COLLECTIONS);

// One o11y runtime for the module — provides the tracing layer that
// `Effect.withSpan` reports through and the logger `logWarn` flows to.
// A no-op until OTEL_EXPORTER_OTLP_* is set (see @cocore/o11y).
const runtime: O11yRuntime = makeRuntime({ serviceName: "cocore-appview" });

// Supervised reconnect backoff for the relay subscription. Jittered
// exponential starting at 1s, capped at 30s via `either(spaced(30s))`
// (`either` takes the shorter of the two delays, so once the
// exponential growth passes 30s the 30s schedule wins). Recurs
// forever, so a dropped subscription always tries to reconnect.
const RECONNECT_SCHEDULE = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.either(Schedule.spaced("30 seconds")),
);

export interface RelayFirehoseOpts {
  /** WebSocket URL of the relay. e.g. `wss://bsky.network` or
   *  `ws://localhost:NNNN` for the dev PDS. */
  service: string;
  /** Cocore Firehose to fan events into. */
  out: CocoreFirehose;
  /** When true, accept commit events without verifying the signing
   *  key against the publishing DID's document. Use this for
   *  test PDSes (where the IdResolver can't reach a real PLC) and
   *  trusted local relays. Defaults to false in production. */
  unauthenticatedCommits?: boolean;
  /** Optional cursor seed. If absent, starts from the relay's
   *  current head (no backfill). */
  initialCursor?: number;
  /** Hook for the operator to persist the cursor. Called after
   *  every successful event handle. The default no-op is fine for
   *  in-memory tests; production implementations should durably
   *  store this so a restart resumes where it left off. */
  setCursor?: (cursor: number) => Promise<void>;
}

export class RelayFirehose {
  private inner: AtFirehose;
  private opts: RelayFirehoseOpts;
  private idResolver: IdResolver;
  private runner: MemoryRunner;
  /** Fiber running the supervised reconnect loop; set by `start()`. */
  private fiber?: Fiber.RuntimeFiber<void, unknown>;

  constructor(opts: RelayFirehoseOpts) {
    this.opts = opts;
    this.idResolver = new IdResolver();
    const setCursor = opts.setCursor ?? (async () => {});
    let lastCursor: number | undefined = opts.initialCursor;
    this.runner = new MemoryRunner({ setCursor });

    this.inner = new AtFirehose({
      service: opts.service,
      idResolver: this.idResolver,
      runner: this.runner,
      unauthenticatedCommits: opts.unauthenticatedCommits ?? false,
      filterCollections: ALL_COLLECTIONS,
      handleEvent: async (evt: AtEvent) => {
        if (evt.event === "create" || evt.event === "update") {
          const commit = evt as AtCommitEvt;
          if (!COLLECTION_SET.has(commit.collection)) return;
          await opts.out.dispatch(toCocoreIndexedRecord(commit));
        }
        // Ignore #identity, #account, #sync, and tombstones for
        // now. M11.5: emit a deletion event into the cocore
        // Firehose so the AppView's store can prune.
        const seq = (evt as { seq?: number }).seq;
        if (typeof seq === "number") lastCursor = seq;
      },
      onError: (err: Error) => {
        // A subscription-level error means the upstream connection
        // dropped/failed. @atproto/sync would otherwise swallow it and
        // recurse internally on a fixed delay; instead we re-throw so
        // it escapes `start()` and the supervised loop below reconnects
        // it with jittered exponential backoff + tracing. Per-event
        // errors (validation/parse/handler) are recoverable — log and
        // keep consuming the stream.
        if (err instanceof FirehoseSubscriptionError) throw err;
        // eslint-disable-next-line no-console
        console.error("relay-firehose error:", err.message);
      },
    });
    void lastCursor;
  }

  /** Run one subscription attempt. `inner.start()` resolves only on a
   *  clean abort (via `stop()`); a dropped subscription rejects it (the
   *  `onError` re-throw above). On interruption the finalizer aborts the
   *  live connection so `stop()` can wind the WS down cleanly.
   *
   *  Re-running `inner.start()` re-iterates the underlying subscription,
   *  which re-reads the cursor from the shared `MemoryRunner` — so a
   *  reconnect resumes from the persisted cursor, never from head. */
  private connectOnce(): Effect.Effect<void, unknown> {
    return Effect.async<void, unknown>((resume) => {
      let settled = false;
      this.inner.start().then(
        () => {
          if (!settled) {
            settled = true;
            resume(Effect.void);
          }
        },
        (err: unknown) => {
          if (!settled) {
            settled = true;
            resume(Effect.fail(err));
          }
        },
      );
      return Effect.promise(async () => {
        settled = true;
        await this.inner.destroy();
      });
    }).pipe(
      Effect.withSpan("relay.subscribe", { attributes: { "relay.service": this.opts.service } }),
      Effect.tapError((err) =>
        logWarn("relay-firehose subscription dropped; reconnecting", {
          service: this.opts.service,
          cursor: this.runner.getCursor(),
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }

  start(): void {
    if (this.fiber) return;
    this.fiber = runtime.runFork(this.connectOnce().pipe(Effect.retry(RECONNECT_SCHEDULE)));
  }

  async stop(): Promise<void> {
    const fiber = this.fiber;
    this.fiber = undefined;
    if (fiber) {
      // Interrupting runs `connectOnce`'s finalizer, which aborts the
      // live subscription (resolving `inner.destroy()`); if we're mid
      // backoff it just cancels the sleep.
      await runtime.runPromise(Fiber.interrupt(fiber)).catch(() => {});
    } else {
      await this.inner.destroy();
    }
  }
}

interface AtCommitEvt {
  event: "create" | "update" | "delete";
  did: string;
  collection: string;
  rkey: string;
  cid?: { toString(): string } | null;
  record?: unknown;
  uri?: { toString(): string };
}

function toCocoreIndexedRecord(evt: AtCommitEvt): IndexedRecord {
  const uri = evt.uri ? evt.uri.toString() : `at://${evt.did}/${evt.collection}/${evt.rkey}`;
  const cid = evt.cid ? evt.cid.toString() : "";
  return {
    uri,
    cid,
    collection: evt.collection as CollectionId,
    repo: evt.did,
    rkey: evt.rkey,
    body: evt.record,
  };
}
