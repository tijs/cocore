// Type declaration for MDX modules processed by @mdx-js/rollup.
// `frontmatter` is exposed as a named export by remark-mdx-frontmatter.

declare module "*.mdx" {
  import type { MDXProps } from "mdx/types";
  import type { ComponentType } from "react";

  /** Frontmatter shape shared across all blog posts. Keep in sync with `lib/blog.ts`. */
  export interface BlogFrontmatter {
    title: string;
    summary: string;
    date: string;
    author?: string;
  }

  export const frontmatter: BlogFrontmatter;
  const MDXComponent: ComponentType<MDXProps>;
  export default MDXComponent;
}
