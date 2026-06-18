// Server-side helpers that proxy GitHub Releases for the cocore agent
// installer. The cocore repo is private, so an anonymous
// `curl https://api.github.com/...` returns 404 — but the console
// runs with a `GITHUB_TOKEN` env var that has `repo` access, so the
// console can hand both the latest tag and the release tarball back
// to a fresh Mac running `curl … | sh`.
//
// The two routes that consume this live next to each other:
//   * `routes/agent.version.ts`  — text/plain  ←  `latestTag()`
//   * `routes/agent.dl.ts`       — bin stream  ←  `streamAsset()`
//
// Token: `process.env.GITHUB_TOKEN`. We deliberately don't fall
// back silently — if the env var is missing the routes return 503
// with a clear message, since silent failure would just give the
// installer the same 404 the public path produces.

const COCORE_REPO = "DGaffney/cocore";

const DEFAULT_ASSET_NAME = "cocore-mac-arm64.tar.gz";

export class ReleaseProxyError extends Error {
  readonly status: number;
  readonly userMessage: string;
  constructor(status: number, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.status = status;
    this.userMessage = userMessage;
    if (cause) (this as { cause?: unknown }).cause = cause;
    this.name = "ReleaseProxyError";
  }
}

function token(): string {
  const t = process.env["GITHUB_TOKEN"];
  if (!t) {
    throw new ReleaseProxyError(
      503,
      "GITHUB_TOKEN env var not set on the console service; agent installer is offline",
    );
  }
  return t;
}

interface ReleaseInfo {
  tag: string;
  assetUrl: string | null;
}

/** Resolve a tag (or "latest" if `tag` is null) and return the
 *  release info we need to point a downloader at. */
async function getRelease(tag: string | null, assetName: string): Promise<ReleaseInfo> {
  const auth = token();
  const url = tag
    ? `https://api.github.com/repos/${COCORE_REPO}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${COCORE_REPO}/releases/latest`;
  const r = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${auth}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cocore-console-release-proxy",
    },
  });
  if (r.status === 404) {
    throw new ReleaseProxyError(
      404,
      tag ? `release ${tag} not found` : "no published releases yet",
    );
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new ReleaseProxyError(502, `github api ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = (await r.json()) as {
    tag_name?: string;
    assets?: Array<{ name: string; url: string }>;
  };
  if (typeof j.tag_name !== "string") {
    throw new ReleaseProxyError(502, "github api returned no tag_name");
  }
  const asset = j.assets?.find((a) => a.name === assetName);
  return {
    tag: j.tag_name,
    assetUrl: asset?.url ?? null,
  };
}

/** Stream the binary release asset back to the caller. v0.6.0
 *  ships a single tarball (`cocore-mac-arm64.tar.gz`); the
 *  `variant` parameter is accepted for backward-compat with v0.5.x
 *  callers but ignored. We hit the asset's API URL with
 *  `Accept: application/octet-stream` so GitHub serves the bytes
 *  directly rather than a signed redirect to S3 that the installer
 *  would have to follow without auth. */
export async function streamAsset(
  tag: string | null,
  assetName: string = DEFAULT_ASSET_NAME,
): Promise<Response> {
  const release = await getRelease(tag, assetName);
  if (!release.assetUrl) {
    throw new ReleaseProxyError(404, `release ${release.tag} has no ${assetName} asset`);
  }
  const r = await fetch(release.assetUrl, {
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cocore-console-release-proxy",
    },
    redirect: "follow",
  });
  if (!r.ok || !r.body) {
    const body = await r.text().catch(() => "");
    throw new ReleaseProxyError(502, `github asset ${r.status}: ${body.slice(0, 200)}`);
  }
  return new Response(r.body, {
    status: 200,
    headers: {
      "content-type": assetName.endsWith(".zip") ? "application/zip" : "application/gzip",
      "cache-control": "public, max-age=300",
      "content-disposition": `attachment; filename="${assetName}"`,
      // Tell the client which tag they actually got, useful when
      // they didn't pin one.
      "x-cocore-release": release.tag,
    },
  });
}

/** Resolve only the tag — for `/agent/version`. */
export async function latestTag(): Promise<string> {
  return (await getRelease(null, DEFAULT_ASSET_NAME)).tag;
}
