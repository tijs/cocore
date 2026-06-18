// Server-side syntax highlighting via Shiki.
//
// Single shared highlighter is created lazily on first call and
// reused across requests — Shiki's bundle is heavy and we don't
// want to re-load themes/grammars per request.

import { Effect, Either } from "effect";
import {
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
  createHighlighter,
} from "shiki";

import { normalizeHighlightLang } from "@/lib/highlight-code.shared.ts";

const PRELOADED_LANGS: BundledLanguage[] = [
  "python",
  "typescript",
  "java",
  "go",
  "csharp",
  "bash",
  "json",
];
const PRELOADED_THEMES: BundledTheme[] = ["github-dark-default"];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise == null) {
    highlighterPromise = createHighlighter({
      themes: PRELOADED_THEMES,
      langs: PRELOADED_LANGS,
    });
  }
  return highlighterPromise;
}

function getHighlighterEffect(): Effect.Effect<Highlighter, unknown> {
  return Effect.async((resume) => {
    void getHighlighter().then(
      (h) => resume(Effect.succeed(h)),
      (e) => resume(Effect.fail(e)),
    );
  });
}

function loadLanguageEffect(highlighter: Highlighter, lang: string): Effect.Effect<void, unknown> {
  if (highlighter.getLoadedLanguages().includes(lang)) {
    return Effect.succeed(undefined);
  }
  return Effect.async((resume) => {
    void highlighter.loadLanguage(lang as BundledLanguage).then(
      () => resume(Effect.succeed(undefined)),
      (e) => resume(Effect.fail(e)),
    );
  });
}

/** Resolve a markdown language tag to a loaded Shiki grammar, falling
 *  back to `text` when the tag is unknown or unsupported. */
function resolveLanguageEffect(
  highlighter: Highlighter,
  rawLang: string,
): Effect.Effect<string, unknown> {
  const lang = normalizeHighlightLang(rawLang);
  return Effect.gen(function* () {
    const either = yield* Effect.either(loadLanguageEffect(highlighter, lang));
    if (Either.isLeft(either)) {
      yield* loadLanguageEffect(highlighter, "text");
      return "text";
    }
    return lang;
  });
}

function loadThemeEffect(
  highlighter: Highlighter,
  theme: BundledTheme,
): Effect.Effect<void, unknown> {
  if (highlighter.getLoadedThemes().includes(theme)) {
    return Effect.succeed(undefined);
  }
  return Effect.async((resume) => {
    void highlighter.loadTheme(theme).then(
      () => resume(Effect.succeed(undefined)),
      (e) => resume(Effect.fail(e)),
    );
  });
}

export interface HighlightCodeInput {
  code: string;
  lang: string;
  theme?: BundledTheme;
}

/** Effectful variant of `codeToHtml`. Returns Shiki's `<pre>...</pre>`
 *  HTML with inline-styled tokens. The `<pre>` is augmented with a
 *  small set of inline styles so the result drops in cleanly without
 *  global CSS. */
export const highlightCodeEffect = (input: HighlightCodeInput): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const theme = input.theme ?? "github-dark-default";
    const highlighter = yield* getHighlighterEffect();
    const lang = yield* resolveLanguageEffect(highlighter, input.lang);
    yield* loadThemeEffect(highlighter, theme);

    return highlighter.codeToHtml(input.code, {
      lang,
      theme,
      transformers: [
        {
          pre(node) {
            const existing = String(node.properties.style ?? "");
            node.properties.style =
              `${existing};margin:0;padding:1rem 1.25rem;border-radius:0.5rem;` +
              `font-size:0.8125rem;line-height:1.5;overflow-x:auto;` +
              `font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;`;
          },
        },
      ],
    });
  });
