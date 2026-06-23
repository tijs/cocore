// Playwright smoke-test config for the cocore console.
//
// Why these tests exist: in May 2026 a hand-written + AI-pair-coded
// rename of `middleware/auth.ts` got reverted by an AI follow-up
// PR, which silently broke the import-protection plugin's behavior
// for every signed-in route. Routes that 307'd to /login looked
// fine in unit tests + typecheck + the production build, then 500'd
// in the browser. CI had no signal.
//
// These tests assert the smallest set of guarantees that would have
// caught it:
//   * every public route renders 200 with expected text
//   * every auth-gated route redirects an anonymous browser to
//     /login (no plain 500, no infinite redirect)
//   * api endpoints under /api/* return the documented status codes
//     for unauthenticated callers
//
// We deliberately do NOT exercise signed-in flows here — those
// require a live ATProto OAuth round-trip we can't fake in CI
// without a paired test PDS. That's a follow-up.
//
// CI runs against `vite preview` (a static build) on port 4173, so
// the tests don't need network access to cocore.dev or any
// upstream services. Anything that hits an external host (bsky
// firehose, advisor, etc.) is mocked away by the lack of those env
// vars in CI.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["PLAYWRIGHT_PORT"] ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: process.env["CI"] ? 2 : undefined,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // Smoke tests; no need for screenshots/videos by default.
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Build then preview. The preview server reads the same routing
    // tree the production deploy uses; bugs that only show up in
    // the production bundle (like the import-protection class)
    // surface here.
    command: `aube run build && aube run preview -- --port ${PORT} --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
