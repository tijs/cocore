// GET /api/v1/models
//
// Public-read model directory. Defaults to the canonical OpenAI list
// shape (`{object:"list", data:[…]}`) so OpenAI clients populate their
// model picker; `?view=directory` returns cocore's full per-machine
// aggregate and `?view=summary` the lean rows. See the canonical
// `/v1/models` mount for the full contract; both routes call the same
// handler in `@/lib/openai-routes.server.ts`.

import { createFileRoute } from "@tanstack/react-router";

import { handleModelsDirectory } from "@/lib/openai-routes.server.ts";

export const Route = createFileRoute("/api/v1/models")({
  server: {
    handlers: {
      GET: ({ request }) => handleModelsDirectory(request),
    },
  },
});
