// GET /v1/models
//
// The canonical OpenAI model-list endpoint. Defaults to the OpenAI
// list shape (`{object:"list", data:[{id, object:"model", …}]}`) so an
// unmodified OpenAI client populates its model picker from whatever
// providers currently advertise on the network.
//
// cocore's richer views are opt-in query params:
//   * `?view=directory` — full per-machine detail + activity windows
//   * `?view=summary`   — lean {modelId, machineCount, price} rows
//
// Public; no auth. The handler is shared with the legacy
// `/api/v1/models` mount.

import { createFileRoute } from "@tanstack/react-router";

import { handleModelsDirectory } from "@/lib/openai-routes.server.ts";

export const Route = createFileRoute("/v1/models")({
  server: {
    handlers: {
      GET: ({ request }) => handleModelsDirectory(request),
    },
  },
});
