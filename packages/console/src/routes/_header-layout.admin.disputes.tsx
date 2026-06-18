import { createFileRoute } from "@tanstack/react-router";

import { DisputesAdmin } from "@/components/disputes/DisputesAdmin.tsx";
import { listPendingDisputesQueryOptions } from "@/components/disputes/disputes.functions.ts";
import { authMiddleware } from "@/middleware/auth.ts";

export const Route = createFileRoute("/_header-layout/admin/disputes")({
  server: {
    middleware: [authMiddleware],
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(listPendingDisputesQueryOptions),
  component: DisputesAdminPage,
  head: () => ({
    meta: [{ title: "Disputes · co/core admin" }],
  }),
});

function DisputesAdminPage() {
  return <DisputesAdmin />;
}
