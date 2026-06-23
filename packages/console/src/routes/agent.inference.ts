// Backward-compat alias for the old curl-pipe-sh URL:
//
//   curl -fsSL https://cocore.dev/agent/inference | sh
//
// v0.6.0 collapsed stub vs. inference into a single install path
// (see the doc-comment at the top of `agent-install.sh` for the
// rationale — TL;DR: the inference build's libpython load command
// pointed at a brew path that didn't exist on most users' Macs and
// dyld aborted the binary at startup). The script served at
// `/agent` now does everything the inference variant used to do.
//
// We keep `/agent/inference` returning the same script so curl
// commands cached in users' shell history, blog posts, README
// screenshots, etc. keep working. Old URL, new behavior.

import { createFileRoute } from "@tanstack/react-router";

import installer from "../../agent-install.sh?raw";

export const Route = createFileRoute("/agent/inference")({
  server: {
    handlers: {
      GET: () =>
        new Response(installer, {
          status: 200,
          headers: {
            "content-type": "application/x-sh; charset=utf-8",
            "cache-control": "no-store",
            "content-disposition": 'inline; filename="cocore-install.sh"',
          },
        }),
    },
  },
});
