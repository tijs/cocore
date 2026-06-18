// In-process Firehose: a thin pub/sub dispatcher for cocore record
// events. Lives in @cocore/sdk because both AppView indexers and
// exchanges subscribe to the same stream (just for different
// purposes).
//
// The wire transport (com.atproto.sync.subscribeRepos via
// @atproto/sync, or a Jetstream filter) replaces this module's
// internal queue without changing the subscriber-facing surface.
// Right now we focus on the contract: events fan out to all
// subscribers, errors in one subscriber don't poison others, and
// the same byte-identical record body reaches everyone.

import type { CollectionId, IndexedRecord, ReceiptRecord } from "./types.ts";

export type RecordHandler = (rec: IndexedRecord) => Promise<void>;
export type ReceiptHandler = (rec: IndexedRecord<ReceiptRecord>) => Promise<void>;

/** Filter applied per-handler. `null` means "every collection". */
export type CollectionFilter = CollectionId | CollectionId[] | null;

interface Subscription {
  filter: Set<string> | null;
  handler: RecordHandler;
}

export class Firehose {
  private subs: Subscription[] = [];

  /** Subscribe to a subset of collections. Returns an unsubscribe fn. */
  on(filter: CollectionFilter, handler: RecordHandler): () => void {
    const filterSet = filter === null ? null : new Set(Array.isArray(filter) ? filter : [filter]);
    const sub: Subscription = { filter: filterSet, handler };
    this.subs.push(sub);
    return () => {
      this.subs = this.subs.filter((s) => s !== sub);
    };
  }

  /** Convenience: receipts only. */
  onReceipt(handler: ReceiptHandler): () => void {
    return this.on("dev.cocore.compute.receipt", async (rec) => {
      await handler(rec as IndexedRecord<ReceiptRecord>);
    });
  }

  /** Dispatch an event to every interested subscriber. Errors in one
   *  subscriber don't suppress others; the orchestrator is
   *  responsible for its own retry / backoff. */
  async dispatch(rec: IndexedRecord): Promise<void> {
    const work = this.subs
      .filter((s) => s.filter === null || s.filter.has(rec.collection))
      .map(async ({ handler }) => {
        try {
          await handler(rec);
        } catch (e) {
          console.error("firehose subscriber error:", (e as Error).message);
        }
      });
    await Promise.all(work);
  }
}
