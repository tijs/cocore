import { createFileRoute } from "@tanstack/react-router";

import { ExplorerPage } from "@/components/explorer/ExplorerPage.tsx";
import { explorerGraphQueryOptions } from "@/components/explorer/explorer.functions.ts";

export const Route = createFileRoute("/_header-layout/explore")({
  loader: async ({ context }) => {
    // Warm the network graph so the page paints with data on first
    // render. The graph is the whole point of this route, so we wait.
    await context.queryClient.ensureQueryData(explorerGraphQueryOptions);
  },
  component: ExplorerPage,
  head: () => ({
    meta: [{ title: "Explorer · co/core console" }],
  }),
});
