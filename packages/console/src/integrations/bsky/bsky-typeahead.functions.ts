import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  q: z.string().min(2),
  limit: z.number().int().positive().max(25).optional(),
});

export type BskyHandleTypeaheadResponse = {
  actors: Array<{ handle: string; avatar: string | null }>;
};

const searchBlueskyActorsTypeaheadServerFn = createServerFn({ method: "GET" })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<BskyHandleTypeaheadResponse> => {
    const host = "https://public.api.bsky.app";
    const url = new URL("xrpc/app.bsky.actor.searchActorsTypeahead", host);
    url.searchParams.set("q", data.q);
    url.searchParams.set("limit", String(data.limit ?? 5));

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("Failed to fetch actors");
    }
    return res.json() as Promise<BskyHandleTypeaheadResponse>;
  });

/** Pass the current input slice (trimmed externally if desired). Query is disabled below 2 grapheme counts via `enabled`. */
export function bskyHandleTypeaheadQueryOptions(query: string) {
  const q = query.trim();
  return queryOptions({
    queryKey: ["bsky-handle-typeahead", q] as const,
    queryFn: () => searchBlueskyActorsTypeaheadServerFn({ data: { q, limit: 5 } }),
    enabled: q.length >= 2,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });
}
