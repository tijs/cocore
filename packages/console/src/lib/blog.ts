// Blog post registry built from .mdx files under `src/content/blog/`.
//
// Vite resolves `import.meta.glob` at build time on both the SSR and
// browser bundles, so this works as plain shared code (no `.server.ts`
// suffix) and is safe to import from route components.
//
// Slugs are derived from the filename (e.g. `hello-world.mdx` →
// `hello-world`). Authors put title/summary/date in YAML frontmatter at
// the top of each file; `remark-mdx-frontmatter` exposes that as a
// named `frontmatter` export on the compiled module.

import type { ComponentType } from "react";
import type { MDXProps } from "mdx/types";

export interface BlogFrontmatter {
  title: string;
  summary: string;
  date: string;
  author?: string;
}

export interface BlogPostModule {
  frontmatter: BlogFrontmatter;
  default: ComponentType<MDXProps>;
}

export interface BlogPostMeta extends BlogFrontmatter {
  slug: string;
}

export interface BlogPost extends BlogPostMeta {
  Component: ComponentType<MDXProps>;
}

const postModules = import.meta.glob<BlogPostModule>("../content/blog/*.mdx", {
  eager: true,
});

function slugFromPath(path: string): string {
  // path looks like "../content/blog/hello-world.mdx"
  const file = path.split("/").pop() ?? "";
  return file.replace(/\.mdx$/, "");
}

const postsBySlug: Record<string, BlogPost> = Object.fromEntries(
  Object.entries(postModules).map(([path, mod]) => {
    const slug = slugFromPath(path);
    return [
      slug,
      {
        slug,
        ...mod.frontmatter,
        Component: mod.default,
      },
    ] satisfies [string, BlogPost];
  }),
);

const sortedPosts: ReadonlyArray<BlogPost> = Object.values(postsBySlug).sort((a, b) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
);

/** All posts, sorted newest-first. */
export function listBlogPosts(): ReadonlyArray<BlogPostMeta> {
  return sortedPosts.map(({ Component: _component, ...meta }) => meta);
}

/** Look up a single post by slug, or `null` if no such post exists. */
export function getBlogPost(slug: string): BlogPost | null {
  return postsBySlug[slug] ?? null;
}

/**
 * Look up just the serializable metadata for a post by slug.
 *
 * Use this from route loaders: TanStack Start dehydrates loader data
 * into the SSR'd HTML, and the MDX `Component` field on `BlogPost` is
 * a React function that seroval can't serialize. Loaders should return
 * the meta and let the component look the body up by slug.
 */
export function getBlogPostMeta(slug: string): BlogPostMeta | null {
  const post = postsBySlug[slug];
  if (post == null) return null;
  const { Component: _component, ...meta } = post;
  return meta;
}
