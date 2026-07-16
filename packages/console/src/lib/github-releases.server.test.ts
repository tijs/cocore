// Regression tests for the GitHub release proxy's anonymous fallback.
// 2026-07-16: GitHub served 503s to all AUTHENTICATED API calls while
// anonymous ones succeeded, which took `/agent/version` (and every
// installer download) down because the proxy required a token and never
// retried without one.

import { afterEach, describe, expect, it, vi } from "vitest";

import { latestTag, ReleaseProxyError } from "./github-releases.server.ts";

function releaseJson(tag: string): Response {
  return new Response(JSON.stringify({ tag_name: tag, assets: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("latestTag", () => {
  it("falls back to an anonymous request when the authenticated one fails", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github_pat_test");
    const calls: Array<string | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string>)?.["Authorization"];
        calls.push(auth);
        return auth
          ? new Response("<html>degraded</html>", { status: 503 })
          : releaseJson("v9.9.9");
      }),
    );
    await expect(latestTag()).resolves.toBe("v9.9.9");
    expect(calls).toEqual(["Bearer github_pat_test", undefined]);
  });

  it("uses the authenticated response when it succeeds", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github_pat_test");
    const fetchMock = vi.fn(async () => releaseJson("v1.2.3"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(latestTag()).resolves.toBe("v1.2.3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("works with no token at all (repo is public)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)?.["Authorization"]).toBeUndefined();
      return releaseJson("v0.9.50");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(latestTag()).resolves.toBe("v0.9.50");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an authenticated 404 anonymously — it's a real answer", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github_pat_test");
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await latestTag().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReleaseProxyError);
    expect((err as ReleaseProxyError).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries anonymously when the authenticated fetch throws", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github_pat_test");
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (first) {
          first = false;
          throw new TypeError("fetch failed");
        }
        return releaseJson("v2.0.0");
      }),
    );
    await expect(latestTag()).resolves.toBe("v2.0.0");
  });
});
