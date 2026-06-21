import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";

import { buildRequesterJobRows } from "@/components/jobs/jobs.server.ts";
import {
  sortRequesterJobRows,
  statsForVisibleRows,
  type JobsRangeStats,
  type RequesterJobRow,
} from "@/components/jobs/jobs.shared.ts";
import {
  appviewGetJobsEffect,
  appviewGetReceiptsEffect,
} from "@/integrations/appview/appview.server.ts";
import { resolveActorsForDids } from "@/lib/friends.server.ts";
import { runTraced } from "@/lib/o11y.server.ts";
import { authMiddleware } from "@/middleware/auth.ts";

type MyJobsPayload = {
  did: string;
  fetchedAt: string;
  rows: RequesterJobRow[];
  /** Full-lifetime counts + USD spend over `rows` (server-computed for the dashboard header). */
  lifetimeStats: JobsRangeStats;
  jobsFetchError: string | null;
  receiptsFetchError: string | null;
};

const listMyJobsServerFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }) =>
    runTraced(
      "jobs.listMine",
      Effect.gen(function* () {
        const now = Date.now();
        const did = context.did;
        const fetchedAt = new Date().toISOString();

        const jobsEither = yield* Effect.either(appviewGetJobsEffect(did));
        const receiptsEither = yield* Effect.either(appviewGetReceiptsEffect({ requester: did }));

        const jobRows = jobsEither._tag === "Right" ? jobsEither.right.jobs : [];
        const receiptRows = receiptsEither._tag === "Right" ? receiptsEither.right.receipts : [];

        const baseRows = sortRequesterJobRows(buildRequesterJobRows(jobRows, receiptRows, now));

        // Resolve the providers (who ran each job) to handles so the table
        // can link to their profiles instead of showing a raw DID. Deduped
        // + parallel; an unresolved DID degrades to the abbreviated DID.
        const providerDids = baseRows
          .map((r) => r.providerDid)
          .filter((d): d is string => d != null);
        const resolved =
          providerDids.length > 0
            ? yield* Effect.promise(() => resolveActorsForDids(providerDids))
            : null;
        const rows = resolved
          ? baseRows.map((r) => {
              const p = r.providerDid ? resolved.get(r.providerDid) : undefined;
              return p ? { ...r, providerHandle: p.handle, providerDisplayName: p.displayName } : r;
            })
          : baseRows;
        const lifetimeStats = statsForVisibleRows(rows);

        return {
          did,
          fetchedAt,
          rows,
          lifetimeStats,
          jobsFetchError: jobsEither._tag === "Left" ? jobsEither.left.message : null,
          receiptsFetchError: receiptsEither._tag === "Left" ? receiptsEither.left.message : null,
        } satisfies MyJobsPayload;
      }),
    ),
  );

export const listMyJobsQueryOptions = queryOptions({
  queryKey: ["jobs", "dashboard"] as const,
  queryFn: listMyJobsServerFn,
  // Keep the dashboard cached so navigating back is instant; a couple
  // minutes of staleness is fine for a read-heavy view.
  staleTime: 120_000,
  gcTime: 600_000,
});
