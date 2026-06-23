import { createFileRoute, notFound } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { MachineDetail } from "@/components/machines/MachineDetail.tsx";
import { myMachineDetailQueryOptions } from "@/components/machines/machines.functions.ts";
import { authMiddleware } from "@/middleware/auth.ts";

export const Route = createFileRoute("/_header-layout/machines/$rkey")({
  server: {
    middleware: [authMiddleware],
  },
  loader: async ({ context, params }) => {
    const { queryClient } = context as { queryClient: QueryClient };
    // The detail server fn resolves the machine ONLY from provider records
    // owned by the caller's DID, so an rkey that isn't theirs comes back
    // with machine: null — turn that into a 404 here.
    const payload = await queryClient.ensureQueryData(myMachineDetailQueryOptions(params.rkey));
    if (!payload.machine) throw notFound();
    return { alias: payload.machine.alias };
  },
  component: MachineDetailPage,
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.alias ?? "Machine"} · co/core console` }],
  }),
});

function MachineDetailPage() {
  const { rkey } = Route.useParams();
  return <MachineDetail rkey={rkey} />;
}
