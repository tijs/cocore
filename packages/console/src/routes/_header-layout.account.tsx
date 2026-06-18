import { createFileRoute } from "@tanstack/react-router";

import { AccountSettings } from "@/components/account/AccountSettings.tsx";
import { listMyApiKeysQueryOptions } from "@/components/api-keys/api-keys.functions.ts";
import { authMiddleware } from "@/middleware/auth.ts";

export const Route = createFileRoute("/_header-layout/account")({
  server: {
    middleware: [authMiddleware],
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(listMyApiKeysQueryOptions);
  },
  component: AccountPage,
  head: () => ({
    meta: [{ title: "Account · co/core console" }],
  }),
});

function AccountPage() {
  return <AccountSettings />;
}
