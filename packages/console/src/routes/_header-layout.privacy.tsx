// Public privacy-policy page. Same provenance as /terms.

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

export const Route = createFileRoute("/_header-layout/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [{ title: "Privacy Policy · co/core" }],
  }),
});

function PrivacyPage() {
  return (
    <div {...stylex.props(styles.root)}>
      <Markdown>{termsContent.privacy}</Markdown>
    </div>
  );
}
