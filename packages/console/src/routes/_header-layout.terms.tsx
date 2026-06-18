// Public terms-of-service page. Rendered as markdown so the version
// shown to users is byte-for-byte the same string the
// dev.cocore.compute.exchangePolicy.termsUri points at, and the
// version stamp matches what gets snapshotted into a
// dev.cocore.compute.termsAcceptance record.

import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import Markdown from "react-markdown";

import { fontFamily } from "@/design-system/theme/typography.stylex";
import { termsContent } from "@/lib/terms-content.ts";

const styles = stylex.create({
  root: {
    paddingTop: "2rem",
    paddingBottom: "4rem",
    maxWidth: "780px",
    margin: "0 auto",
    fontFamily: fontFamily.sans,
    fontSize: "1rem",
    lineHeight: 1.6,
  },
});

export const Route = createFileRoute("/_header-layout/terms")({
  component: TermsPage,
  head: () => ({
    meta: [{ title: "Terms of Service · co/core" }],
  }),
});

function TermsPage() {
  return (
    <div {...stylex.props(styles.root)}>
      <Markdown>{termsContent.tos}</Markdown>
    </div>
  );
}
