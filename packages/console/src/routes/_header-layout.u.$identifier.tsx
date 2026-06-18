import { createFileRoute, notFound } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { ProfilePage } from "@/components/profile/ProfilePage.tsx";
import { profilePageQueryOptions } from "@/components/profile/profile.functions.ts";

export const Route = createFileRoute("/_header-layout/u/$identifier")({
  // No auth middleware — profile pages are public. The Friend
  // button on the page is the only friend-requiring affordance and
  // it gates itself on session presence.
  loader: async ({ context, params }) => {
    const { queryClient } = context as { queryClient: QueryClient };
    const bundle = await queryClient.ensureQueryData(profilePageQueryOptions(params.identifier));
    if (!bundle) throw notFound();
    return { bundle };
  },
  component: ProfileRoutePage,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.bundle?.profile
          ? `${loaderData.bundle.profile.displayName ?? loaderData.bundle.resolved.handle ?? loaderData.bundle.resolved.did} · co/core`
          : "Profile · co/core",
      },
    ],
  }),
});

function ProfileRoutePage() {
  const { identifier } = Route.useParams();
  return <ProfilePage identifier={identifier} />;
}
