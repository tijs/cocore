import { createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { JobsDashboard } from "@/components/jobs/JobsDashboard.tsx";
import { listMyJobsQueryOptions } from "@/components/jobs/jobs.functions.ts";
import { authMiddleware } from "@/middleware/auth.ts";

export const Route = createFileRoute("/_header-layout/jobs")({
  server: {
    middleware: [authMiddleware],
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(listMyJobsQueryOptions),
  component: JobsPage,
  head: () => ({
    meta: [{ title: "Jobs · co/core console" }],
  }),
});

function JobsPage(): ReactElement {
  return <JobsDashboard />;
}
