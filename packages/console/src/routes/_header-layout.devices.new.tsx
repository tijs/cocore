// /devices/new — the page the headless `cocore agent pair` command
// points the user's browser at.
//
//   /devices/new                 — the user types a code from the agent
//   /devices/new?code=XXXXXXXX   — code prefilled (the agent opened
//                                  this URL via `xdg-open`)
//
// Auth-gated: only an OAuth-signed-in user can approve a pair. The
// approval pulls the user's StoredSession out of the SQLite OAuth
// store, flattens it into a ProviderSession, and hands it to the
// pair-store via dev.cocore.devicePair.confirm. The agent polls
// dev.cocore.devicePair.poll, picks up the session, and persists it
// to ~/.cocore/session.json.

import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";

import { PairConfirm } from "@/components/PairConfirm.tsx";
import { Page } from "@/design-system/page/index.tsx";
import { verticalSpace } from "@/design-system/theme/semantic-spacing.stylex";
import { Body, Heading1, InlineCode } from "@/design-system/typography";
import { authMiddleware } from "@/middleware/auth.ts";

const styles = stylex.create({
  main: {
    display: "flex",
    flexDirection: "column",
    gap: verticalSpace["6xl"],
    paddingTop: "2rem",
    paddingBottom: "4rem",
  },
});

export const Route = createFileRoute("/_header-layout/devices/new")({
  validateSearch: (search: Record<string, unknown>): { code: string } => ({
    code: typeof search.code === "string" ? search.code.trim().toUpperCase() : "",
  }),
  server: {
    middleware: [authMiddleware],
  },
  component: NewDevicePage,
  head: () => ({
    meta: [{ title: "Pair a machine · co/core console" }],
  }),
});

function NewDevicePage() {
  const { code } = Route.useSearch();
  return (
    <Page.Root>
      <main {...stylex.props(styles.main)}>
        <Heading1>Pair a new provider machine</Heading1>
        <Body>
          Enter the 8-character code shown by your <InlineCode>cocore agent pair</InlineCode>{" "}
          command. Make sure you signed in with the ATProto identity you want the machine to publish
          receipts under.
        </Body>
        <PairConfirm initialCode={code} />
      </main>
    </Page.Root>
  );
}
