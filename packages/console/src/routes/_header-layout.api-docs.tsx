// Public API docs page. No auth gate — anyone considering signing
// up can browse the surface; the snippets reference the user's API
// key as a placeholder (`cocore-...`) so the page itself never
// renders a real key.

import { createFileRoute } from "@tanstack/react-router";

import { ApiDocsPage } from "@/components/api-docs/ApiDocsPage.tsx";

export const Route = createFileRoute("/_header-layout/api-docs")({
  head: () => ({
    meta: [
      { title: "API · co/core" },
      {
        name: "description",
        content:
          "OpenAI-compatible chat completions API for co/core. Drop-in replacement: change two strings in your existing OpenAI SDK code.",
      },
    ],
  }),
  component: ApiDocsPage,
});
