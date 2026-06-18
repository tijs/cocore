import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { z } from "zod";

import {
  appviewGetReceiptsEffect,
  appviewGetSettlementsEffect,
  appviewListProvidersEffect,
  appviewVerifyReceiptEffect,
  appviewVerifySettlementEffect,
  getAppviewBaseUrl,
  type AppviewIndexedRecord,
} from "@/integrations/appview/appview.server.ts";
import { resolveActorsForDids, type ResolvedActor } from "@/lib/friends.server.ts";

const receiptsFiltersSchema = z.object({
  provider: z.string().optional(),
  requester: z.string().optional(),
  job: z.string().optional(),
});

const settlementsFiltersSchema = z.object({
  receipt: z.string().optional(),
  requester: z.string().optional(),
});

const uriSchema = z.object({
  uri: z.string().min(1, "URI is required"),
});

function runAppview<R, E>(effect: Effect.Effect<R, E>): Promise<R> {
  return Effect.runPromise(effect);
}

export type AppviewIndexedRecordEnriched = AppviewIndexedRecord & {
  repoHandle: string | null;
  repoDisplayName: string | null;
  repoAvatarUrl: string | null;
};

async function enrichIndexedRecords(
  rows: AppviewIndexedRecord[],
): Promise<AppviewIndexedRecordEnriched[]> {
  const resolved = await resolveActorsForDids(rows.map((r) => r.repo));
  return rows.map((row) => {
    const profile: ResolvedActor = resolved.get(row.repo) ?? {
      handle: null,
      displayName: null,
      avatarUrl: null,
    };
    return {
      ...row,
      repoHandle: profile.handle,
      repoDisplayName: profile.displayName,
      repoAvatarUrl: profile.avatarUrl,
    };
  });
}

/** Which AppView the console talks to (set `COCORE_APPVIEW_URL` or `APPVIEW`). */
const getAppviewConfigServerFn = createServerFn({ method: "GET" }).handler(() =>
  Promise.resolve({ baseUrl: getAppviewBaseUrl() } as const),
);

export const appviewConfigQueryOptions = queryOptions({
  queryKey: ["appview-config"] as const,
  queryFn: getAppviewConfigServerFn,
  staleTime: 60_000,
});

const listProvidersAppviewServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const data = await runAppview(appviewListProvidersEffect);
  return { providers: await enrichIndexedRecords(data.providers) };
});

export const listProvidersAppviewQueryOptions = queryOptions({
  queryKey: ["appview", "providers"] as const,
  queryFn: listProvidersAppviewServerFn,
  staleTime: 30_000,
});

const getReceiptsAppviewServerFn = createServerFn({ method: "GET" })
  .inputValidator(receiptsFiltersSchema)
  .handler(async ({ data }) => {
    const result = await runAppview(appviewGetReceiptsEffect(data));
    return { receipts: await enrichIndexedRecords(result.receipts) };
  });

export function getReceiptsAppviewQueryOptions(filters: z.infer<typeof receiptsFiltersSchema>) {
  return queryOptions({
    queryKey: ["appview", "receipts", filters] as const,
    queryFn: () => getReceiptsAppviewServerFn({ data: filters }),
    staleTime: 30_000,
  });
}

const getSettlementsAppviewServerFn = createServerFn({ method: "GET" })
  .inputValidator(settlementsFiltersSchema)
  .handler(async ({ data }) => {
    const result = await runAppview(appviewGetSettlementsEffect(data));
    return { settlements: await enrichIndexedRecords(result.settlements) };
  });

export function getSettlementsAppviewQueryOptions(
  filters: z.infer<typeof settlementsFiltersSchema>,
) {
  return queryOptions({
    queryKey: ["appview", "settlements", filters] as const,
    queryFn: () => getSettlementsAppviewServerFn({ data: filters }),
    staleTime: 30_000,
  });
}

const verifyReceiptAppviewServerFn = createServerFn({ method: "POST" })
  .inputValidator(uriSchema)
  .handler(({ data }) => runAppview(appviewVerifyReceiptEffect(data.uri)));

const verifySettlementAppviewServerFn = createServerFn({ method: "POST" })
  .inputValidator(uriSchema)
  .handler(({ data }) => runAppview(appviewVerifySettlementEffect(data.uri)));

export type VerifyReceiptVariables = z.infer<typeof uriSchema>;
export type VerifySettlementVariables = z.infer<typeof uriSchema>;

export const verifyReceiptAppviewMutationOptions = mutationOptions({
  mutationFn: (variables: VerifyReceiptVariables) =>
    verifyReceiptAppviewServerFn({ data: variables }),
});

export const verifySettlementAppviewMutationOptions = mutationOptions({
  mutationFn: (variables: VerifySettlementVariables) =>
    verifySettlementAppviewServerFn({ data: variables }),
});
