import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { TermsAcceptanceGate } from "@/components/terms/TermsAcceptanceGate.tsx";
import { getMyTermsStateQueryOptions } from "@/components/terms/terms.functions.ts";
import { Skeleton } from "@/design-system/skeleton";
import { authMiddleware } from "@/middleware/auth.ts";
import { sanitizeAuthRedirectTarget } from "@/utils/auth-redirect.ts";

// `getRequest` lives under `@tanstack/react-start/server` which the
// import-protection plugin (correctly) refuses to import from a
// route file. Wrap it in a server fn so the route can call a normal
// async function and get the current page URL back.
const currentPageHrefServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  return new URL(getRequest().url).href;
});

const searchSchema = z.object({
  redirect: z.string().optional(),
});

const DEFAULT_RETURN = "/machines";

function safeReturnAfterTerms(redirect: string | undefined, href: string): string {
  const base = sanitizeAuthRedirectTarget(redirect, href);
  try {
    const parsed = new URL(base, href);
    if (parsed.pathname === "/accept-terms" || parsed.pathname.startsWith("/accept-terms/")) {
      return DEFAULT_RETURN;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_RETURN;
  }
}

function splitPathForRouter(
  href: string,
  pathWithSearch: string,
): { to: string; search?: Record<string, string> } {
  const url = new URL(pathWithSearch, href);
  const search: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    search[key] = value;
  });
  return {
    to: url.pathname,
    search: Object.keys(search).length > 0 ? search : undefined,
  };
}

function navigateToInternalPath(
  navigate: ReturnType<typeof useNavigate>,
  pageHref: string,
  pathWithSearch: string,
) {
  const { to, search } = splitPathForRouter(pageHref, pathWithSearch);
  void navigate({ to, search, replace: true });
}

export const Route = createFileRoute("/_header-layout/accept-terms")({
  validateSearch: searchSchema,
  server: {
    middleware: [authMiddleware],
  },
  loader: async ({ context }) => {
    const [, pageHref] = await Promise.all([
      context.queryClient.ensureQueryData(getMyTermsStateQueryOptions),
      currentPageHrefServerFn(),
    ]);
    return { pageHref };
  },
  component: AcceptTermsPage,
  head: () => ({
    meta: [{ title: "Accept terms · co/core console" }],
  }),
});

function AcceptTermsPage() {
  const { pageHref } = Route.useLoaderData();
  const { redirect: redirectParam } = Route.useSearch();
  const navigate = useNavigate();
  const termsQ = useQuery(getMyTermsStateQueryOptions);
  const termsState = termsQ.data ?? null;
  const returnTo = safeReturnAfterTerms(redirectParam, pageHref);

  if (termsQ.isPending) {
    return (
      <Skeleton variant="rectangle" height="12rem" aria-label="Loading terms state" aria-busy />
    );
  }

  if (termsState === null || termsState.activePolicy === null) {
    return null;
  }

  // if (termsState.accepted) {
  //   const loc = splitPathForRouter(pageHref, returnTo);
  //   return <Navigate {...loc} replace />;
  // }

  return (
    <TermsAcceptanceGate
      state={{ ...termsState, activePolicy: termsState.activePolicy }}
      onAccepted={() => navigateToInternalPath(navigate, pageHref, returnTo)}
    />
  );
}
