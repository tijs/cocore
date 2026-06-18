import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";
import { Effect } from "effect";
import { createElement } from "react";
import satori, { type Font } from "satori";

import { SITE_MARKETING_DESCRIPTION, OG_CARD_SITE_LABEL } from "@/lib/site-marketing.shared.ts";
import { OG_HEIGHT, OG_WIDTH, rootOgTokens } from "@/og/root-og.tokens.ts";

import faviconSvg from "../../public/favicon.svg?raw";

/**
 * Satori does not reliably paint `<img src="data:image/svg+xml,...">` (SVG
 * styles, data-URI parsing). Rasterize once with Resvg and feed a PNG data URL.
 */
let logoPngDataUrlCache: string | null = null;

function logoPngDataUrl(): string {
  if (logoPngDataUrlCache != null) {
    return logoPngDataUrlCache;
  }
  const resvg = new Resvg(faviconSvg, {
    fitTo: {
      mode: "width",
      value: 224,
    },
  });
  const png = resvg.render().asPng();
  logoPngDataUrlCache = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  return logoPngDataUrlCache;
}

/** Latin TTFs (OFL) — Satori does not accept woff2; files live under `public/og-fonts` for prod + dev. */
function readOgFontTtf(filename: string): ArrayBuffer {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "public", "og-fonts", filename),
    join(cwd, "dist", "client", "og-fonts", filename),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const buf = readFileSync(path);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  }
  throw new Error(`OG font not found: ${filename} (tried ${candidates.join(", ")})`);
}

function ogFonts(): Font[] {
  return [
    {
      name: "Space Grotesk",
      data: readOgFontTtf("space-grotesk-latin-700-normal.ttf"),
      weight: 700,
      style: "normal",
    },
    {
      name: "Space Mono",
      data: readOgFontTtf("space-mono-latin-400-normal.ttf"),
      weight: 400,
      style: "normal",
    },
  ];
}

function rootOgElement() {
  const t = rootOgTokens;
  return createElement(
    "div",
    {
      style: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: "flex",
        backgroundColor: t.canvasBg,
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
        boxSizing: "border-box",
      },
    },
    createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: t.cardBg,
          borderRadius: 16,
          border: `2px solid ${t.border}`,
          padding: 72,
          boxSizing: "border-box",
          justifyContent: "center",
        },
      },
      createElement(
        "div",
        {
          style: {
            fontFamily: "Space Mono",
            fontSize: 22,
            fontWeight: 400,
            color: t.eyebrow,
            letterSpacing: "0.04em",
            textTransform: "uppercase" as const,
            marginBottom: 36,
            alignSelf: "flex-start",
          },
        },
        OG_CARD_SITE_LABEL,
      ),
      createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 36,
            marginBottom: 28,
          },
        },
        createElement("img", {
          src: logoPngDataUrl(),
          width: 112,
          height: 112,
          alt: "",
        }),
        createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            },
          },
          createElement(
            "div",
            {
              style: {
                fontFamily: "Space Grotesk",
                fontSize: 96,
                fontWeight: 700,
                color: t.title,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
              },
            },
            "co/core",
          ),
        ),
      ),
      createElement(
        "div",
        {
          style: {
            fontFamily: "Space Mono",
            fontSize: 28,
            fontWeight: 400,
            color: t.tagline,
            lineHeight: 1.45,
            maxWidth: 980,
          },
        },
        SITE_MARKETING_DESCRIPTION,
      ),
    ),
  );
}

export const renderRootOgPngEffect = Effect.gen(function* () {
  const fonts = yield* Effect.sync(() => ogFonts());
  const svg = yield* Effect.tryPromise({
    try: () =>
      satori(rootOgElement(), {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        fonts,
      }),
    catch: (e) => new Error(`satori: ${String(e)}`, { cause: e }),
  });
  const png = yield* Effect.sync(() => {
    const resvg = new Resvg(svg, {
      fitTo: {
        mode: "width",
        value: OG_WIDTH,
      },
    });
    return new Uint8Array(resvg.render().asPng());
  });
  return png;
});
