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

import { Firehose as AtFirehose, MemoryRunner, type Event as AtEvent } from "@atproto/sync";
import { IdResolver } from "@atproto/identity";
import {
  COLLECTIONS,
  type CollectionId,
  type Firehose as CocoreFirehose,
  type IndexedRecord,
} from "@cocore/sdk";

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

  constructor(opts: RelayFirehoseOpts) {
    this.opts = opts;
    this.idResolver = new IdResolver();
    const setCursor = opts.setCursor ?? (async () => {});
    let lastCursor: number | undefined = opts.initialCursor;
    const runner = new MemoryRunner({ setCursor });

    this.inner = new AtFirehose({
      service: opts.service,
      idResolver: this.idResolver,
      runner,
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
        // eslint-disable-next-line no-console
        console.error("relay-firehose error:", err.message);
      },
    });
    void lastCursor;
  }

  start(): void {
    this.inner.start();
  }

  async stop(): Promise<void> {
    await this.inner.destroy();
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
