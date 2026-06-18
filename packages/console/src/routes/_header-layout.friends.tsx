import { createFileRoute } from "@tanstack/react-router";

import { FriendsPage } from "@/components/friends/FriendsPage.tsx";
import {
  friendsDiscoverNewestFirstPageQueryOptions,
  friendsDiscoverNewestProvidersFirstPageQueryOptions,
  friendsDiscoverRecentFirstPageQueryOptions,
  friendsDiscoverRecentProvidersFirstPageQueryOptions,
  listMyFriendsQueryOptions,
} from "@/components/friends/friends.functions.ts";
import { authMiddleware } from "@/middleware/auth.ts";

export const Route = createFileRoute("/_header-layout/friends")({
  server: {
    middleware: [authMiddleware],
  },
  loader: async ({ context }) => {
    const qc = context.queryClient;
    void qc.prefetchQuery(friendsDiscoverNewestFirstPageQueryOptions);
    void qc.prefetchQuery(friendsDiscoverRecentProvidersFirstPageQueryOptions);
    void qc.prefetchQuery(friendsDiscoverNewestProvidersFirstPageQueryOptions);
    await Promise.all([
      qc.ensureQueryData(listMyFriendsQueryOptions),
      qc.ensureQueryData(friendsDiscoverRecentFirstPageQueryOptions),
    ]);
  },
  component: FriendsPage,
  head: () => ({
    meta: [
      { title: "Friends · co/core console" },
      {
        name: "description",
        content:
          "Manage the trusted DIDs that the friends-only chat-completions endpoint will route to.",
      },
    ],
  }),
});
