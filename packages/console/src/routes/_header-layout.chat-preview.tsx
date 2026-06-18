// TEMP (do not commit): unauthenticated preview of ChatPage for
// visual iteration — ATProto OAuth rejects app passwords, so the
// screenshot harness can't sign in for real.
import { createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { ChatPage } from "@/components/chat/ChatPage.tsx";
import { modelDirectoryRouteQueryOptions } from "@/components/models/models.functions.ts";

export const Route = createFileRoute("/_header-layout/chat-preview")({
  loader: ({ context }) => context.queryClient.ensureQueryData(modelDirectoryRouteQueryOptions),
  component: ChatPreviewRoute,
});

function ChatPreviewRoute(): ReactElement {
  return <ChatPage />;
}
