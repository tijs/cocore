import { createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { LeaderboardPage } from "@/components/leaderboard/LeaderboardPage.tsx";
import { leaderboardQueryOptions } from "@/components/leaderboard/leaderboard.functions.ts";

export const Route = createFileRoute("/_header-layout/leaderboard")({
  // Public, read-only view — no auth middleware. Prefetch the ranked
  // board so the page paints with data on first load.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(leaderboardQueryOptions({ limit: 20 })),
  component: LeaderboardRoute,
  head: () => ({
    meta: [{ title: "Leaderboard · co/core console" }],
  }),
});

function LeaderboardRoute(): ReactElement {
  return <LeaderboardPage />;
}
