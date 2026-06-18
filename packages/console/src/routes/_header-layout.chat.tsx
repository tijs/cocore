import { createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { ChatPage } from "@/components/chat/ChatPage.tsx";
import { modelDirectoryRouteQueryOptions } from "@/components/models/models.functions.ts";
import { authMiddleware } from "@/middleware/auth.ts";

export const Route = createFileRoute("/_header-layout/chat")({
  server: {
    middleware: [authMiddleware],
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(modelDirectoryRouteQueryOptions),
  component: ChatRoute,
  head: () => ({
    meta: [{ title: "Chat · co/core console" }],
  }),
});

function ChatRoute(): ReactElement {
  return <ChatPage />;
}
