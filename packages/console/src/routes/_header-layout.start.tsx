import { createFileRoute } from "@tanstack/react-router";

import { listMyApiKeysQueryOptions } from "@/components/api-keys/api-keys.functions.ts";
import { listMyMachinesQueryOptions } from "@/components/machines/machines.functions.ts";
import {
  markStartGuideSeenServerFn,
  myStartGuideStateQueryOptions,
} from "@/components/start/start-guide.functions.ts";
import { StartGuide } from "@/components/start/StartGuide.tsx";
import { authMiddleware } from "@/middleware/auth.ts";

export const Route = createFileRoute("/_header-layout/start")({
  server: {
    middleware: [authMiddleware],
  },
  loader: async ({ context }) => {
    await markStartGuideSeenServerFn();
    await context.queryClient.invalidateQueries({
      queryKey: myStartGuideStateQueryOptions.queryKey,
    });
    await Promise.all([
      context.queryClient.ensureQueryData(myStartGuideStateQueryOptions),
      context.queryClient.ensureQueryData(listMyMachinesQueryOptions),
      context.queryClient.ensureQueryData(listMyApiKeysQueryOptions),
    ]);
  },
  component: StartPage,
  head: () => ({
    meta: [{ title: "Getting started · co/core console" }],
  }),
});

function StartPage() {
  return <StartGuide />;
}
