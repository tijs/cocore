// Server-side helpers that proxy GitHub Releases for the cocore agent
// installer, so a fresh Mac running `curl … | sh` gets the latest tag
// and the release tarball from a stable cocore.dev URL.
//
// The two routes that consume this live next to each other:
//   * `routes/agent.version.ts`  — text/plain  ←  `latestTag()`
//   * `routes/agent.dl.ts`       — bin stream  ←  `streamAsset()`
//
// Auth: the repo is public, so anonymous requests work — but when
// `process.env.GITHUB_TOKEN` is set we send it first for the higher
// authenticated rate limit. If the authenticated request fails for any
// reason (expired token, GitHub auth-path incident — 2026-07-16 GitHub
// served 503s to ALL authenticated API calls while anonymous ones
// succeeded, which took the installer down), we retry anonymously
// before giving up.

const COCORE_REPO = "graze-social/cocore";

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

/** Fetch a GitHub API URL, preferring the authenticated path (better rate
 *  limits) but falling back to anonymous when the authed attempt fails —
 *  the repo is public, so anonymous is always a valid last resort. */
async function ghFetch(url: string, accept: string): Promise<Response> {
  const base: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cocore-console-release-proxy",
  };
  const t = process.env["GITHUB_TOKEN"];
  if (t) {
    try {
      const r = await fetch(url, {
        headers: { ...base, Authorization: `Bearer ${t}` },
        redirect: "follow",
      });
      // 404 is a real answer (release/asset genuinely absent) — retrying
      // anonymously can't improve on it. Anything else non-ok (401/403
      // token trouble, 5xx GitHub incident) is worth the anonymous retry.
      if (r.ok || r.status === 404) return r;
    } catch {
      // network-level failure — fall through to the anonymous attempt
    }
  }
  return fetch(url, { headers: base, redirect: "follow" });
}

interface ReleaseInfo {
  tag: string;
  assetUrl: string | null;
}

/** Resolve a tag (or "latest" if `tag` is null) and return the
 *  release info we need to point a downloader at. */
async function getRelease(tag: string | null, assetName: string): Promise<ReleaseInfo> {
  const url = tag
    ? `https://api.github.com/repos/${COCORE_REPO}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${COCORE_REPO}/releases/latest`;
  const r = await ghFetch(url, "application/vnd.github+json");
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
  const r = await ghFetch(release.assetUrl, "application/octet-stream");
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
