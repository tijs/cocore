import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  type TermsState,
  acceptTerms,
  getActiveTermsStateEffect,
} from "@/lib/terms-acceptance.server.ts";
import { runTraced } from "@/lib/o11y.server.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { getAtprotoSessionForRequest } from "@/middleware/auth.server.ts";

const acceptInputSchema = z.object({
  policyUri: z.string().min(1).max(400),
  policyCid: z.string().min(1).max(200),
  termsVersion: z.string().min(1).max(32),
  termsUri: z.string().url(),
});

const getMyTermsStateServerFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<TermsState | null> => {
    const request = getRequest();
    const ctx = await getAtprotoSessionForRequest(request);
    if (!ctx) return null;
    return runTraced("terms.getActiveState", getActiveTermsStateEffect(ctx.oauthSession));
  },
);

export const getMyTermsStateQueryOptions = queryOptions({
  queryKey: ["terms", "my-state"] as const,
  queryFn: getMyTermsStateServerFn,
  // Treat the result as immediately stale so re-acceptance prompts
  // fire as soon as the active policy version bumps. The previous
  // 30s staleTime kept long-held tabs serving a cached
  // `{accepted: true}` from before the bump, so the user could
  // keep clicking around without ever seeing the new modal — which
  // is exactly the failure mode we hit on 2026-05-10.
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
});

const acceptTermsServerFn = createServerFn({ method: "POST" })
  .inputValidator(acceptInputSchema)
  .middleware([authMiddleware])
  .handler(({ context, data }) => {
    const request = getRequest();
    const userAgent = request.headers.get("user-agent") ?? undefined;
    return acceptTerms(context.oauthSession, {
      policyUri: data.policyUri,
      policyCid: data.policyCid,
      termsVersion: data.termsVersion,
      termsUri: data.termsUri,
      ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
    });
  });

export type AcceptTermsInput = z.infer<typeof acceptInputSchema>;

export const acceptTermsMutationOptions = mutationOptions({
  mutationFn: (variables: AcceptTermsInput) => acceptTermsServerFn({ data: variables }),
});
