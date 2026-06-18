// React Query options for the public model directory the api-docs
// page renders. Hits /api/v1/models?view=directory for the rich
// aggregator output (the bare endpoint now defaults to the canonical
// OpenAI list shape). Replaces the hardcoded `qwen3.5-27b`-style list
// with whatever providers actually advertise on the firehose right now.

import { queryOptions } from "@tanstack/react-query";

import type { ModelDirectoryResponse } from "@/lib/model-directory.server.ts";

export const modelDirectoryQueryOptions = queryOptions({
  queryKey: ["models", "directory"] as const,
  queryFn: async (): Promise<ModelDirectoryResponse> => {
    const r = await fetch("/api/v1/models?view=directory");
    if (!r.ok) {
      throw new Error(`/api/v1/models returned ${r.status}`);
    }
    return (await r.json()) as ModelDirectoryResponse;
  },
  staleTime: 30_000,
});
