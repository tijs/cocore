import * as stylex from "@stylexjs/stylex";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { docsStyles } from "@/components/docs/docs-page.stylex.tsx";
import { DocsTopbar } from "@/components/docs/docs-topbar.tsx";
import { enforceCanonicalConsoleHost } from "@/lib/legacy-host-redirect.ts";

export const Route = createFileRoute("/_docs-header-layout")({
  beforeLoad: async () => {
    await enforceCanonicalConsoleHost();
  },
  component: DocsHeaderLayoutRoute,
});

function DocsHeaderLayoutRoute() {
  return (
    <div {...stylex.props(docsStyles.page)}>
      <DocsTopbar />
      <Outlet />
    </div>
  );
}
