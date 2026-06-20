import type { ApiDocsFixtures } from "@/lib/api-docs/fixture-defaults.ts";
import type { ApiDocsTagOption } from "@/lib/api-docs/types.ts";

import { appviewBaseUrl, consoleBaseUrlClient } from "@/lib/api-docs/discovery.ts";
import { getDefaultApiDocsFixtures } from "@/lib/api-docs/fixture-defaults.ts";
import { loadApiDocsFixtures } from "@/lib/api-docs/fixtures.ts";

let cachedAsyncFixtures: ApiDocsFixtures | null = null;

/** Env-backed fixtures for the docs route loader and example runner. */
export async function loadApiDocsFixturesAsync(): Promise<ApiDocsFixtures> {
  if (cachedAsyncFixtures) {
    return cachedAsyncFixtures;
  }

  cachedAsyncFixtures = {
    ...getDefaultApiDocsFixtures(),
    ...loadApiDocsFixtures(),
  };

  return cachedAsyncFixtures;
}

export type ApiDocsPageData = {
  fixtures: ApiDocsFixtures;
  tagOptions: Array<ApiDocsTagOption>;
  /** Public origins resolved on the server so client-rendered curl examples
   *  point at the real env (e.g. https://appview.cocore.dev) instead of the
   *  browser-side localhost fallback. */
  appviewBaseUrl: string;
  consoleBaseUrl: string;
  /** AppView service DID, resolved on the server (COCORE_APPVIEW_DID in prod). */
  appviewDid: string;
};

/** did:web for the AppView host. Prefers the configured DID; otherwise
 *  derives it from the public AppView origin (port encoded as %3A). */
function resolveAppviewDid(base: string): string {
  const configured = process.env["COCORE_APPVIEW_DID"]?.trim();
  if (configured) return configured;
  try {
    return `did:web:${new URL(base).host.replace(":", "%3A")}`;
  } catch {
    return "did:web:localhost%3A8081";
  }
}

let cachedPageData: ApiDocsPageData | null = null;

/** Fixtures for the /docs/api page loader. */
export async function loadApiDocsPageData(): Promise<ApiDocsPageData> {
  if (cachedPageData) {
    return cachedPageData;
  }
  const fixtures = await loadApiDocsFixturesAsync();
  const appview = appviewBaseUrl();
  cachedPageData = {
    fixtures,
    tagOptions: [],
    appviewBaseUrl: appview,
    consoleBaseUrl: consoleBaseUrlClient(),
    appviewDid: resolveAppviewDid(appview),
  };
  return cachedPageData;
}
