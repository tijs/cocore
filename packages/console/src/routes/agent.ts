// Serves the cocore agent installer at `/agent` so users can run:
//
//   curl -fsSL https://cocore.dev/agent | sh
//
// The script (sibling file `agent-install.sh`) downloads the latest
// macOS arm64 release from https://github.com/graze-social/cocore/releases,
// installs the binary to `~/.local/bin/cocore`, sets up the
// LaunchAgent (suspended until pairing), and prints the next step:
// `cocore agent pair`.

import { createFileRoute } from "@tanstack/react-router";

// Bundled at build time as a string. Vite's `?raw` query reads the
// file verbatim — no template-literal escaping needed for `${…}` /
// `\n` etc, so this stays a real bash file you can run directly.
import installer from "../../agent-install.sh?raw";

export const Route = createFileRoute("/agent")({
  server: {
    handlers: {
      GET: () =>
        new Response(installer, {
          status: 200,
          headers: {
            // x-shellscript so curl + sh treat it as a script. We
            // also disable framework-level caching so a redeploy
            // takes effect immediately.
            "content-type": "application/x-sh; charset=utf-8",
            "cache-control": "no-store",
            // Convenience: if a human curls without piping, they
            // see something they can read.
            "content-disposition": 'inline; filename="cocore-install.sh"',
          },
        }),
    },
  },
});
