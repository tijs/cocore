// Serves the cocore agent uninstaller at `/agent/uninstall`. Use:
//
//   curl -fsSL https://cocore.dev/agent/uninstall | sh
//
// Removes the LaunchAgent, the binary, the ~/.cocore state dir
// (including the Python venv), and any mlx-community model caches
// under ~/.cache/huggingface/hub. Does NOT touch PDS records or
// console-side state — those are owned by the user identity, not
// the machine install.
//
// See `packages/console/agent-uninstall.sh` for the script body
// and the supported env knobs (dry-run, keep-venv, keep-hf-cache).

import { createFileRoute } from "@tanstack/react-router";

import installer from "../../agent-uninstall.sh?raw";

export const Route = createFileRoute("/agent/uninstall")({
  server: {
    handlers: {
      GET: () =>
        new Response(installer, {
          status: 200,
          headers: {
            "content-type": "application/x-sh; charset=utf-8",
            "cache-control": "no-store",
            "content-disposition": 'inline; filename="cocore-uninstall.sh"',
          },
        }),
    },
  },
});
