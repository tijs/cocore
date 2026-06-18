import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { z } from "zod";

import { type HighlightCodeInput, highlightCodeEffect } from "@/lib/shiki.server.ts";

const SUPPORTED_THEMES = ["github-dark-default"] as const;

const highlightCodeSchema = z.object({
  code: z.string().min(1).max(10_000),
  lang: z.string().min(1).max(64),
  theme: z.enum(SUPPORTED_THEMES).optional(),
});

const highlightCodeServerFn = createServerFn({ method: "POST" })
  .inputValidator(highlightCodeSchema)
  .handler(({ data }) => Effect.runPromise(highlightCodeEffect(data as HighlightCodeInput)));

export type HighlightCodeOptionsInput = z.infer<typeof highlightCodeSchema>;

export const highlightCodeQueryOptions = (input: HighlightCodeOptionsInput) =>
  queryOptions({
    queryKey: ["highlight-code", input.lang, input.theme ?? "default", input.code] as const,
    queryFn: () => highlightCodeServerFn({ data: input }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
