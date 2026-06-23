import { describe, expect, it } from "vitest";

import { canonicalConsoleRedirectUrl } from "./legacy-host-redirect.ts";

describe("canonicalConsoleRedirectUrl", () => {
  it("redirects the legacy console host to the canonical apex, preserving path + query", () => {
    expect(
      canonicalConsoleRedirectUrl("https://console.cocore.dev/machines?tab=fleet", null, null),
    ).toBe("https://cocore.dev/machines?tab=fleet");
  });

  it("preserves the root path", () => {
    expect(canonicalConsoleRedirectUrl("https://console.cocore.dev/", null, null)).toBe(
      "https://cocore.dev/",
    );
  });

  it("returns null when already on the canonical apex", () => {
    expect(canonicalConsoleRedirectUrl("https://cocore.dev/machines", null, null)).toBeNull();
  });

  it("returns null for localhost dev", () => {
    expect(canonicalConsoleRedirectUrl("http://localhost:3000/start", null, null)).toBeNull();
  });

  it("returns null for Railway preview hosts", () => {
    expect(
      canonicalConsoleRedirectUrl("https://client-cocore-pr-81.up.railway.app/", null, null),
    ).toBeNull();
  });

  it("prefers the Host header over the URL host", () => {
    // Behind a proxy the URL host can be an internal address; the Host
    // header carries the real public hostname.
    expect(
      canonicalConsoleRedirectUrl("http://10.0.0.5:8080/account", "console.cocore.dev", null),
    ).toBe("https://cocore.dev/account");
  });

  it("prefers x-forwarded-host over the Host header", () => {
    expect(
      canonicalConsoleRedirectUrl(
        "http://10.0.0.5:8080/account",
        "internal.railway",
        "console.cocore.dev",
      ),
    ).toBe("https://cocore.dev/account");
  });

  it("takes the first value from a comma-separated x-forwarded-host", () => {
    expect(
      canonicalConsoleRedirectUrl("http://10.0.0.5/x", null, "console.cocore.dev, proxy.internal"),
    ).toBe("https://cocore.dev/x");
  });

  it("is case-insensitive on the hostname", () => {
    expect(canonicalConsoleRedirectUrl("https://CONSOLE.COCORE.DEV/blog", null, null)).toBe(
      "https://cocore.dev/blog",
    );
  });

  it("ignores a port on the legacy host", () => {
    expect(canonicalConsoleRedirectUrl("https://console.cocore.dev:443/jobs", null, null)).toBe(
      "https://cocore.dev/jobs",
    );
  });

  it("does not match an unrelated host that merely contains the legacy host", () => {
    expect(
      canonicalConsoleRedirectUrl("https://console.cocore.dev.evil.example/x", null, null),
    ).toBeNull();
  });
});
