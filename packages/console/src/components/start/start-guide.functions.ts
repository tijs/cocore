import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

import {
  getStartGuideSeenAt,
  markStartGuideSeenIfNeeded as markStartGuideSeenInDb,
} from "@/lib/console-user-prefs.server.ts";
import { authMiddleware } from "@/middleware/auth.ts";

type MyStartGuideState = {
  startGuideSeenAt: string | null;
};

const myStartGuideStateServerFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    ({ context }): MyStartGuideState => ({
      startGuideSeenAt: getStartGuideSeenAt(context.did),
    }),
  );

export const markStartGuideSeenServerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(({ context }) => {
    markStartGuideSeenInDb(context.did);
  });

export const myStartGuideStateQueryOptions = queryOptions({
  queryKey: ["console-user-prefs", "start-guide"] as const,
  queryFn: myStartGuideStateServerFn,
  staleTime: 30_000,
});

export const markStartGuideSeenMutationOptions = mutationOptions({
  mutationFn: () => markStartGuideSeenServerFn(),
});
