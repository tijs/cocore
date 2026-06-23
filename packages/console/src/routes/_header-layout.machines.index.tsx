import { createFileRoute, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { listMyApiKeysQueryOptions } from "@/components/api-keys/api-keys.functions.ts";
import { MachinesDashboard } from "@/components/machines/MachinesDashboard.tsx";
import { listMyMachinesQueryOptions } from "@/components/machines/machines.functions.ts";
import { myStartGuideStateQueryOptions } from "@/components/start/start-guide.functions.ts";
import { authMiddleware } from "@/middleware/auth.ts";

export const Route = createFileRoute("/_header-layout/machines/")({
  server: {
    middleware: [authMiddleware],
  },
  beforeLoad: async ({ context }) => {
    const { queryClient } = context as { queryClient: QueryClient };
    const [machinesPayload, keysPayload, prefs] = await Promise.all([
      queryClient.ensureQueryData(listMyMachinesQueryOptions),
      queryClient.ensureQueryData(listMyApiKeysQueryOptions),
      queryClient.ensureQueryData(myStartGuideStateQueryOptions),
    ]);

    if (
      machinesPayload.machines.length === 0 &&
      keysPayload.keys.length === 0 &&
      prefs.startGuideSeenAt === null
    ) {
      throw redirect({ to: "/start", replace: true });
    }
  },
  component: MachinesPage,
  head: () => ({
    meta: [{ title: "Machines · co/core console" }],
  }),
});

function MachinesPage() {
  return <MachinesDashboard />;
}
