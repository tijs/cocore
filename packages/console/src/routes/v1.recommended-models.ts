// GET /v1/recommended-models
//
// The curated recommended-models rotation, served so the console and
// the menu-bar/tray app can fetch the latest set WITHOUT an app
// release. Mirrors the provider Rust catalog's "recommended" rotation.
//
// Response is a plain JSON array:
//   [{ id, minRamGb, blurb }, ...]
//
// Public; no auth (it's curated metadata, same posture as /agent/policy
// and /v1/models). The list lives in one place — src/lib/recommended-
// models.ts — so it can later be made env/remote-overridable without
// touching this shell.

import { createFileRoute } from "@tanstack/react-router";

import { RECOMMENDED_MODELS } from "@/lib/recommended-models.ts";

export const Route = createFileRoute("/v1/recommended-models")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(RECOMMENDED_MODELS), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        }),
    },
  },
});
