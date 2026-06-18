/** Normalize markdown / snippet language tags to Shiki identifiers. */
const LANG_ALIASES: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cs: "csharp",
  "c#": "csharp",
  csharp: "csharp",
  go: "go",
  golang: "go",
  html: "html",
  java: "java",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  kotlin: "kotlin",
  kt: "kotlin",
  md: "markdown",
  markdown: "markdown",
  php: "php",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  sh: "bash",
  shell: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  yaml: "yaml",
  yml: "yaml",
};

export function normalizeHighlightLang(raw: string | null | undefined): string {
  if (raw == null || raw.trim() === "") return "text";
  const key = raw.trim().toLowerCase();
  return LANG_ALIASES[key] ?? key;
}
