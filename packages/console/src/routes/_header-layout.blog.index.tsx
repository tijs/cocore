// Public blog index. Lists every post compiled from
// `src/content/blog/*.mdx` newest-first. The post bodies are MDX files;
// see `src/lib/blog.ts` for how they're discovered.

import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Flex } from "@/design-system/flex";
import { Page } from "@/design-system/page";
import { uiColor } from "@/design-system/theme/color.stylex";
import { ui } from "@/design-system/theme/semantic-color.stylex";
import { gap, verticalSpace } from "@/design-system/theme/semantic-spacing.stylex";
import { fontFamily, fontSize, fontWeight } from "@/design-system/theme/typography.stylex";
import { Body, Heading1, Heading3, SmallBody } from "@/design-system/typography";
import { listBlogPosts } from "@/lib/blog.ts";

const styles = stylex.create({
  header: {
    marginBottom: 0,
    paddingTop: verticalSpace["6xl"],
  },
  root: {
    paddingBottom: verticalSpace["12xl"],
  },
  headingMono: {
    fontFamily: fontFamily.mono,
  },
  titlePrompt: {
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  intro: {
    marginBottom: verticalSpace["7xl"],
    marginTop: verticalSpace["xl"],
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: gap["7xl"],
  },
  postCard: {
    borderTopColor: uiColor.border1,
    borderTopStyle: "solid",
    borderTopWidth: {
      default: 1,
      ":first-child": 0,
    },
    paddingTop: {
      default: verticalSpace["6xl"],
      ":first-child": 0,
    },
    display: "flex",
    flexDirection: "column",
    gap: gap["2xl"],
  },
  postLink: {
    color: "inherit",
    textDecoration: "none",
    display: "flex",
    flexDirection: "column",
    gap: gap["xs"],
  },
  postHeading: {
    marginBottom: verticalSpace["md"],
    marginTop: 0,
  },
  postMeta: {
    fontSize: fontSize["xs"],
    fontWeight: fontWeight["normal"],
    letterSpacing: "0.05em",
    marginBottom: verticalSpace["lg"],
    textTransform: "uppercase",
  },
  postSummary: {
    marginBottom: 0,
    marginTop: verticalSpace["md"],
  },
});

export const Route = createFileRoute("/_header-layout/blog/")({
  component: BlogIndexPage,
  head: () => ({
    meta: [
      { title: "Blog · co/core" },
      {
        name: "description",
        content:
          "Notes from the co/core team on AT Protocol, decentralized compute, and verifiable receipts of work.",
      },
    ],
  }),
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

function BlogIndexPage() {
  const posts = listBlogPosts();

  return (
    <Page.Root variant="small" style={styles.root}>
      <Page.Header style={styles.header}>
        <Flex direction="column" gap="2xl">
          <Heading1 style={styles.headingMono}>
            <span {...stylex.props(styles.titlePrompt)}>~/</span>blog
          </Heading1>
          <Body style={[styles.intro, ui.textDim]}>
            Notes from the co/core team on AT Protocol, decentralized compute, and verifiable
            receipts of work.
          </Body>
        </Flex>
      </Page.Header>

      {posts.length === 0 ? (
        <Body style={ui.textDim}>No posts yet. Check back soon.</Body>
      ) : (
        <div {...stylex.props(styles.list)}>
          {posts.map((post) => (
            <article key={post.slug} {...stylex.props(styles.postCard)}>
              <Link
                to="/blog/$slug"
                params={{ slug: post.slug }}
                preload="intent"
                {...stylex.props(styles.postLink)}
              >
                <SmallBody style={[styles.postMeta, ui.textDim]}>{formatDate(post.date)}</SmallBody>
                <Heading3 style={styles.postHeading}>{post.title}</Heading3>
                <Body style={[styles.postSummary, ui.textDim]}>{post.summary}</Body>
              </Link>
            </article>
          ))}
        </div>
      )}
    </Page.Root>
  );
}
