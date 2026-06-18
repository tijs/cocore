// Client-safe wrapper for the marketing snapshot.
//
// TanStack Start's import-protection plugin won't let a route file
// (`_header-layout.index.tsx`) import a `.server.ts` module directly,
// even when only the route loader uses it. Wrapping the server call
// in `createServerFn` keeps the implementation server-side while
// letting the route import a fetch-shaped client.

import { createServerFn } from "@tanstack/react-start";

import {
  type MarketingSnapshot,
  getMarketingSnapshotCached,
} from "@/lib/marketing-snapshot.server.ts";

// Re-export the snapshot type from this client-safe wrapper so route
// files can type their loader data without importing the `.server.ts`
// module directly (which the import-protection plugin forbids).
export type { MarketingSnapshot };

export const loadMarketingSnapshotServerFn = createServerFn({ method: "GET" }).handler(
  (): Promise<MarketingSnapshot> => getMarketingSnapshotCached(),
);
