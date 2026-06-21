import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  type AppviewAccountSummary,
  appviewListAccountsEffect,
} from "@/integrations/appview/appview.server.ts";
import { runTraced } from "@/lib/o11y.server.ts";
import { authMiddleware } from "@/middleware/auth.ts";

const directoryTypeaheadSchema = z.object({
  q: z.string().min(1).max(256),
  limit: z.number().int().min(1).max(50).optional(),
});

const cocoreDirectoryTypeaheadServerFn = createServerFn({ method: "GET" })
  .inputValidator(directoryTypeaheadSchema)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ accounts: AppviewAccountSummary[] }> => {
    const res = await runTraced(
      "appview.listAccounts",
      appviewListAccountsEffect({
        query: data.q,
        limit: data.limit ?? 20,
        offset: 0,
        sortBy: "recent",
        providersOnly: false,
        viewerDid: context.did,
        excludeViewerFriends: true,
      }),
    );
    return { accounts: res.accounts };
  });

/** Same as {@link cocoreDirectoryTypeaheadServerFn} but without OAuth — for `/login` only. */
const cocoreDirectoryTypeaheadPublicServerFn = createServerFn({ method: "GET" })
  .inputValidator(directoryTypeaheadSchema)
  .handler(async ({ data }): Promise<{ accounts: AppviewAccountSummary[] }> => {
    const res = await runTraced(
      "appview.listAccounts",
      appviewListAccountsEffect({
        query: data.q,
        limit: data.limit ?? 20,
        offset: 0,
        sortBy: "recent",
        providersOnly: false,
      }),
    );
    return { accounts: res.accounts };
  });

/** Typeahead over signed-up cocore members (`listAccounts` + `q`), scoped to the viewer and omitting existing friends. */
export function cocoreDirectoryTypeaheadQueryOptions(q: string) {
  const trimmed = q.trim();
  return queryOptions({
    queryKey: ["cocore-directory-typeahead", trimmed] as const,
    queryFn: () => cocoreDirectoryTypeaheadServerFn({ data: { q: trimmed, limit: 20 } }),
    enabled: trimmed.length >= 1,
    staleTime: 30_000,
    /** Keep prior rows visible while a longer `q` refetches (matches Bluesky typeahead UX). */
    placeholderData: (previousData) => previousData,
  });
}

/** Public directory typeahead (no `viewerDid`) for unauthenticated pages such as `/login`. */
export function cocoreDirectoryTypeaheadPublicQueryOptions(q: string) {
  const trimmed = q.trim();
  return queryOptions({
    queryKey: ["cocore-directory-typeahead-public", trimmed] as const,
    queryFn: () => cocoreDirectoryTypeaheadPublicServerFn({ data: { q: trimmed, limit: 20 } }),
    enabled: trimmed.length >= 1,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });
}
