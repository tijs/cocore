// Server fn for the public /models page loader.
//
// The route's loader can't import `model-directory.server.ts` directly
// — TanStack Start's import-protection plugin refuses to pull
// `.server.ts` modules into the client bundle. createServerFn wraps
// the call so the server-side runtime keeps the implementation in
// scope while the client only sees the fetch-shaped wrapper.

import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

import { type ModelDirectoryResponse, buildModelDirectory } from "@/lib/model-directory.server.ts";

const loadModelDirectoryServerFn = createServerFn({ method: "GET" }).handler(
  (): Promise<ModelDirectoryResponse> => buildModelDirectory(),
);

export const modelDirectoryRouteQueryOptions = queryOptions({
  queryKey: ["models", "directory", "ssr"] as const,
  queryFn: loadModelDirectoryServerFn,
  staleTime: 30_000,
});
