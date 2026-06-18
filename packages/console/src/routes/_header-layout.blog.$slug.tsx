// Single blog post page. The post body is an MDX module compiled by
// @mdx-js/rollup; see `src/lib/blog.ts` for how slugs map to modules
// and `vite.config.ts` for the MDX plugin configuration.

import type { MDXComponents } from "mdx/types";

import * as stylex from "@stylexjs/stylex";
import { MDXProvider } from "@mdx-js/react";
import { createFileRoute, createLink, Link, notFound } from "@tanstack/react-router";

import { Page } from "@/design-system/page";
import { uiColor } from "@/design-system/theme/color.stylex";
import { ui } from "@/design-system/theme/semantic-color.stylex";
import { fontFamily, fontSize, fontWeight } from "@/design-system/theme/typography.stylex";
import { gap, verticalSpace } from "@/design-system/theme/semantic-spacing.stylex";
import {
  Blockquote,
  Body,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  InlineCode,
  ListItem,
  OrderedList,
  Pre,
  SmallBody,
  UnorderedList,
} from "@/design-system/typography";
import { Text } from "@/design-system/typography/text";
import { Link as DSLink } from "@/design-system/link";
import { getBlogPost, getBlogPostMeta } from "@/lib/blog.ts";
import { Flex } from "@/design-system/flex";

const LinkLink = createLink(DSLink);

const styles = stylex.create({
  root: {
    paddingBottom: verticalSpace["12xl"],
    display: "flex",
    flexDirection: "column",
    gap: gap["7xl"],
  },
  headingMono: {
    fontFamily: fontFamily.mono,
  },
  titlePrompt: {
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  meta: {
    fontSize: fontSize["xs"],
    fontWeight: fontWeight["normal"],
    letterSpacing: "0.05em",
    marginBottom: verticalSpace["lg"],
    textTransform: "uppercase",
  },
  italic: {
    fontStyle: "italic",
  },
  h2: {
    marginBottom: verticalSpace["3xl"],
    marginTop: verticalSpace["7xl"],
  },
  h3: {
    marginBottom: verticalSpace["4xl"],
    marginTop: verticalSpace["7xl"],
  },
  h4: {
    marginBottom: verticalSpace["7xl"],
    marginTop: verticalSpace["7xl"],
  },
  h5: {
    marginBottom: verticalSpace["7xl"],
    marginTop: verticalSpace["7xl"],
  },
  paragraph: {
    marginBottom: verticalSpace["4xl"],
    marginTop: verticalSpace["4xl"],
  },
  backLink: {
    marginTop: verticalSpace["9xl"],
  },
  article: {
    display: "flex",
    flexDirection: "column",
    gap: gap["2xl"],
  },
  header: {
    paddingTop: verticalSpace["6xl"],
    display: "flex",
    flexDirection: "column",
    gap: gap["5xl"],
  },
});

// Map MDX HTML element types to the design-system typography. Mirrors the
// react-markdown setup in `design-system/markdown-content/index.tsx`, but
// typed for `@mdx-js/react`'s `MDXComponents` rather than react-markdown's
// `Components`.
const mdxComponents: MDXComponents = {
  h1: (props) => <Heading1 {...props} />,
  h2: (props) => <Heading2 style={styles.h2} {...props} />,
  h3: (props) => <Heading3 style={styles.h3} {...props} />,
  h4: (props) => <Heading4 style={styles.h4} {...props} />,
  h5: (props) => <Heading5 style={styles.h5} {...props} />,
  p: (props) => <Body style={styles.paragraph} {...props} />,
  a: ({ href, children, ...rest }) => (
    <DSLink href={href} {...rest}>
      {children}
    </DSLink>
  ),
  ul: (props) => <UnorderedList {...props} />,
  ol: (props) => <OrderedList {...props} />,
  li: (props) => <ListItem {...props} />,
  pre: (props) => <Pre {...props} />,
  code: (props) => <InlineCode {...props} />,
  blockquote: (props) => <Blockquote {...props} />,
  strong: ({ children }) => <Text weight="semibold">{children}</Text>,
  em: ({ children }) => <em {...stylex.props(styles.italic)}>{children}</em>,
};

export const Route = createFileRoute("/_header-layout/blog/$slug")({
  // Only return serializable metadata from the loader — the MDX
  // component function would fail SSR dehydration (seroval can't
  // serialize functions). The component itself looks the post body up
  // by slug from the same module registry, which exists on both the
  // server and the client.
  loader: ({ params }) => {
    const meta = getBlogPostMeta(params.slug);
    if (meta == null) throw notFound();
    return { meta };
  },
  component: BlogPostPage,
  notFoundComponent: BlogPostNotFound,
  head: ({ loaderData }) =>
    loaderData != null
      ? {
          meta: [
            { title: `${loaderData.meta.title} · co/core blog` },
            { name: "description", content: loaderData.meta.summary },
          ],
        }
      : {
          meta: [{ title: "Post not found · co/core blog" }],
        },
});

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function BlogPostPage() {
  const { meta } = Route.useLoaderData();
  const post = getBlogPost(meta.slug);
  if (post == null) return <BlogPostNotFound />;
  const PostBody = post.Component;

  return (
    <Page.Root variant="small">
      <article {...stylex.props(styles.root)}>
        <header {...stylex.props(styles.header)}>
          <Heading1 style={[styles.headingMono]}>
            <span {...stylex.props(styles.titlePrompt)}>~/blog/</span>
            {meta.slug}
          </Heading1>
          <SmallBody style={[styles.meta, ui.textDim]}>
            {formatDate(meta.date)}
            {meta.author ? ` · ${meta.author}` : ""}
          </SmallBody>
        </header>
        <Flex direction="column" gap="sm">
          <MDXProvider components={mdxComponents}>
            <PostBody />
          </MDXProvider>
          <SmallBody style={styles.backLink}>
            <LinkLink to="/blog" preload="intent">
              ← Back to all posts
            </LinkLink>
          </SmallBody>
        </Flex>
      </article>
    </Page.Root>
  );
}

function BlogPostNotFound() {
  return (
    <Page.Root style={styles.root}>
      <Heading1>Post not found</Heading1>
      <Body style={ui.textDim}>
        That blog post doesn't exist (or it moved).{" "}
        <Link to="/blog" preload="intent">
          Browse all posts
        </Link>
        .
      </Body>
    </Page.Root>
  );
}
