"use client";

// /friends — manage the friend set that constrains the
// `/api/v1/private/chat/completions` endpoint's provider routing.
// Three sections:
//
//   1. Add a friend by handle/DID — direct lookup for when you know
//      who you're looking for.
//   2. Discover cocore members — paginated card grid sourced from the
//      AppView's listAccounts directory. Filterable by recent activity
//      vs. newest signup, and "providers only" for narrowing to
//      operators. (Lives in `DiscoverFriendsCard.tsx` so the
//      page-level component stays manageable.)
//   3. Your friends — current friend set with Remove buttons.

import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { UserHandleAutocomplete } from "@/components/UserHandleAutocomplete.tsx";
import { DiscoverFriendsCard } from "@/components/friends/DiscoverFriendsCard.tsx";
import {
  addFriendMutationOptions,
  listMyFriendsQueryOptions,
  lookupActorMutationOptions,
  removeFriendMutationOptions,
  type ListedFriend,
} from "@/components/friends/friends.functions.ts";
import {
  incomingFriendsQueryOptions,
  type IncomingFriend,
} from "@/components/profile/profile.functions.ts";
import { getSessionQueryOptions } from "@/integrations/auth/session.functions.ts";
import type { AppviewAccountSummary } from "@/integrations/appview/appview.server.ts";
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
} from "@/design-system/alert-dialog/index.tsx";
import { Alert } from "@/design-system/alert";
import { Avatar } from "@/design-system/avatar";
import { Badge } from "@/design-system/badge";
import { Button } from "@/design-system/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/design-system/card";
import { Flex } from "@/design-system/flex";
import { Page } from "@/design-system/page";
import { uiColor } from "@/design-system/theme/color.stylex";
import { gap as gapSpace, verticalSpace } from "@/design-system/theme/semantic-spacing.stylex";
import {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
} from "@/design-system/theme/typography.stylex";
import { toasts } from "@/design-system/toast";
import { Body, Heading1, InlineCode, SmallBody } from "@/design-system/typography";

const styles = stylex.create({
  header: {
    marginBottom: 0,
  },
  headingMono: {
    fontFamily: fontFamily.mono,
  },
  titlePrompt: {
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  metaRow: {
    color: uiColor.text1,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    marginTop: verticalSpace.sm,
    lineHeight: lineHeight["lg"],
  },
  cardTitleMono: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: uiColor.text2,
    textTransform: "lowercase",
  },
  cardDescription: {
    fontSize: fontSize.xs,
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  sections: {
    display: "flex",
    flexDirection: "column",
    gap: verticalSpace["2xl"],
  },
  previewRow: {
    alignItems: "center",
    display: "flex",
    gap: gapSpace["md"],
    flex: 1,
    minWidth: 0,
  },
  previewMeta: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: gapSpace.xxs,
  },
  didText: {
    color: uiColor.text1,
    fontFamily: fontFamily.mono,
    fontSize: "0.75rem",
    overflowWrap: "anywhere",
  },
  friendRow: {
    alignItems: "center",
    display: "flex",
    gap: gapSpace["md"],
    paddingBlock: gapSpace["xs"],
    flexWrap: "wrap",
  },
  friendRowLink: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: gapSpace["xl"],
    color: "inherit",
    textDecoration: "none",
  },
  friendIdentity: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: gapSpace.lg,
    textDecoration: "none",
  },
  identityHandleLine: {
    opacity: 0.75,
  },
  emptyState: {
    color: uiColor.text1,
    fontSize: fontSize.sm,
    paddingBlock: gapSpace["md"],
  },
  countBadge: {
    fontWeight: fontWeight.normal,
    marginInlineStart: gapSpace["xs"],
  },
  /** Right column on incoming rows — lines up with the Remove control on “Your friends”. */
  friendRowMeta: {
    alignSelf: "center",
    flexShrink: 0,
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  root: {
    display: "flex",
    flexDirection: "column",
    fontFamily: fontFamily.mono,
    gap: verticalSpace["2xl"],
    marginLeft: "auto",
    marginRight: "auto",
    maxWidth: "1600px",
    paddingBottom: verticalSpace["12xl"],
    width: "100%",
  },
});

interface PreviewActor {
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

type AddFriendCandidate =
  | { kind: "preview"; data: PreviewActor }
  | { kind: "discover"; data: AppviewAccountSummary };

function addCandidateHandleForToast(candidate: AddFriendCandidate): string | null {
  if (candidate.kind === "preview") return candidate.data.handle;
  const h = candidate.data.handle?.trim();
  return h && h.length > 0 ? h : null;
}

function directoryPickAsSummary(did: string, committedDisplay: string): AppviewAccountSummary {
  const t = committedDisplay.trim();
  const handle = t.startsWith("did:") ? null : t.length > 0 ? t : null;
  return {
    did,
    handle,
    displayName: null,
    avatarUrl: null,
    joinedAt: "",
    lastActivityAt: "",
    providerCount: 0,
    isProvider: false,
  };
}

export function FriendsPage() {
  const queryClient = useQueryClient();
  const friendsQuery = useQuery(listMyFriendsQueryOptions);

  const lookupMut = useMutation(lookupActorMutationOptions);
  const addMut = useMutation(addFriendMutationOptions);
  const removeMut = useMutation(removeFriendMutationOptions);

  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<PreviewActor | null>(null);
  const [lookupNotFound, setLookupNotFound] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ rkey: string; handle: string | null } | null>(
    null,
  );

  const friends: ListedFriend[] = friendsQuery.data ?? [];
  const friendedDids = new Set(friends.map((f) => f.subject));

  // "Who has trusted me with work?" — DIDs that have published a
  // `dev.cocore.account.friend` record naming the viewer's DID as
  // subject. Only fetched when the session is loaded so we don't
  // race the auth boundary.
  const sessionQuery = useQuery(getSessionQueryOptions);
  const viewerDid = sessionQuery.data?.user?.did ?? null;
  const incomingFriendsQuery = useQuery({
    ...incomingFriendsQueryOptions(viewerDid ?? ""),
    enabled: viewerDid !== null,
  });
  const incoming: IncomingFriend[] = incomingFriendsQuery.data ?? [];

  const runLookup = async (raw: string) => {
    setPreview(null);
    setLookupNotFound(false);
    const q = raw.trim();
    if (q.length === 0) return;
    const result = await lookupMut.mutateAsync({ query: q });
    if (!result) {
      setLookupNotFound(true);
      return;
    }
    setPreview(result);
  };

  const commitAddFriend = async (candidate: AddFriendCandidate) => {
    const payload =
      candidate.kind === "preview"
        ? { subject: candidate.data.did, subjectHandle: candidate.data.handle }
        : {
            subject: candidate.data.did,
            subjectHandle: candidate.data.handle ?? undefined,
          };
    const out = await addMut.mutateAsync(payload);
    const toastHandle = addCandidateHandleForToast(candidate);
    toasts.add(
      {
        title: out.created
          ? toastHandle
            ? `Added @${toastHandle} as a friend`
            : "Added friend"
          : toastHandle
            ? `@${toastHandle} is already a friend`
            : "Already a friend",
        variant: out.created ? "success" : "neuthral",
      },
      { timeout: 2400 },
    );
    if (candidate.kind === "preview" || candidate.kind === "discover") {
      setQuery("");
      setPreview(null);
      setLookupNotFound(false);
    }
    await queryClient.invalidateQueries({ queryKey: listMyFriendsQueryOptions.queryKey });
    await queryClient.invalidateQueries({ queryKey: ["friends", "discover"] });
    await queryClient.invalidateQueries({ queryKey: ["cocore-directory-typeahead"] });
  };

  const removeFriend = async (rkey: string, handle: string | null) => {
    await removeMut.mutateAsync({ rkey });
    toasts.add(
      { title: handle ? `Removed @${handle}` : "Removed friend", variant: "success" },
      { timeout: 2400 },
    );
    await queryClient.invalidateQueries({ queryKey: listMyFriendsQueryOptions.queryKey });
    await queryClient.invalidateQueries({ queryKey: ["friends", "discover"] });
    await queryClient.invalidateQueries({ queryKey: ["cocore-directory-typeahead"] });
  };

  const confirmRemoveFriend = async () => {
    if (!removeTarget) return;
    const { rkey, handle } = removeTarget;
    await removeFriend(rkey, handle);
    setRemoveTarget(null);
  };

  const friendLinkIdentifier = (displayHandle: string | null | undefined, did: string): string => {
    const h = displayHandle?.trim();
    return h && h.length > 0 ? h : did;
  };

  const friendIdentity = (
    displayName: string | null,
    displayHandle: string | null,
    footnote?: ReactNode,
  ) => {
    const handle = displayHandle?.trim() ?? "";
    const hasHandle = handle.length > 0;
    const dn = displayName?.trim() ?? "";
    const primary = dn.length > 0 ? dn : hasHandle ? `@${handle}` : "Unknown account";
    const handleLine = dn.length > 0 && hasHandle ? `@${handle}` : null;
    return (
      <div {...stylex.props(styles.friendIdentity)}>
        <Body>{primary}</Body>
        {handleLine ? <SmallBody style={styles.identityHandleLine}>{handleLine}</SmallBody> : null}
        {footnote}
      </div>
    );
  };

  return (
    <Page.Root variant="large" style={styles.root}>
      <Page.Header style={styles.header}>
        <Flex direction="column" gap="xl">
          <Heading1 style={styles.headingMono}>
            <span {...stylex.props(styles.titlePrompt)}>~/</span>friends
          </Heading1>
          <div {...stylex.props(styles.metaRow)}>
            DIDs you trust enough to handle private compute jobs. The friends-only chat-completions
            endpoint (<InlineCode>/api/v1/private/chat/completions</InlineCode>) only routes to
            providers run by these DIDs.
          </div>
        </Flex>
      </Page.Header>

      <div {...stylex.props(styles.sections)}>
        <Flex direction="column" gap="2xl">
          <Card size="md">
            <CardHeader hasBorder>
              <CardTitle style={styles.cardTitleMono}>Add a friend</CardTitle>
            </CardHeader>
            <CardBody>
              <Flex direction="column" gap="md">
                <UserHandleAutocomplete
                  ariaLabel="Handle"
                  placeholder="alice.bsky.social or did:plc:…"
                  source="cocore"
                  value={query}
                  isDisabled={lookupMut.isPending || addMut.isPending}
                  onValueChange={(v) => {
                    setQuery(v);
                    if (lookupNotFound) setLookupNotFound(false);
                  }}
                  onSelect={(committed, meta) => {
                    if (meta?.cocoreSubjectDid) {
                      void commitAddFriend({
                        kind: "discover",
                        data: directoryPickAsSummary(meta.cocoreSubjectDid, committed),
                      });
                      return;
                    }
                    void runLookup(committed);
                  }}
                />

                {lookupNotFound ? (
                  <Alert variant="warning" title="Not found">
                    No bsky-indexed account matches that handle or DID.
                  </Alert>
                ) : null}

                {preview ? (
                  <Card size="sm">
                    <CardBody>
                      <Flex direction="row" gap="md" align="center">
                        <div {...stylex.props(styles.previewRow)}>
                          <Avatar
                            src={preview.avatarUrl ?? undefined}
                            alt={preview.handle}
                            fallback={preview.handle[0]?.toUpperCase() ?? "?"}
                          />
                          <div {...stylex.props(styles.previewMeta)}>
                            <Body>
                              {preview.displayName ? `${preview.displayName} ` : ""}
                              <span style={{ opacity: 0.7 }}>@{preview.handle}</span>
                            </Body>
                            <span {...stylex.props(styles.didText)}>{preview.did}</span>
                          </div>
                        </div>
                        {friendedDids.has(preview.did) ? (
                          <Badge variant="success">Already friended</Badge>
                        ) : (
                          <Button
                            variant="primary"
                            onPress={() => void commitAddFriend({ kind: "preview", data: preview })}
                          >
                            Friend
                          </Button>
                        )}
                      </Flex>
                    </CardBody>
                  </Card>
                ) : null}
              </Flex>
            </CardBody>
          </Card>
        </Flex>

        <Flex direction="column" gap="2xl">
          <DiscoverFriendsCard
            onFriendIntent={(account) => void commitAddFriend({ kind: "discover", data: account })}
          />
        </Flex>

        <Flex direction="column" gap="2xl">
          <Card size="md">
            <CardHeader hasBorder>
              <CardTitle style={styles.cardTitleMono}>
                Your friends
                <span {...stylex.props(styles.countBadge)}>
                  <Badge variant="default">{friends.length}</Badge>
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody>
              {friendsQuery.isLoading ? (
                <SmallBody>Loading…</SmallBody>
              ) : friends.length === 0 ? (
                <div {...stylex.props(styles.emptyState)}>You haven't friended anyone yet.</div>
              ) : (
                <Flex direction="column" gap="sm">
                  {friends.map((f) => (
                    <div {...stylex.props(styles.friendRow)} key={f.rkey}>
                      <Link
                        to="/u/$identifier"
                        params={{
                          identifier: friendLinkIdentifier(f.displayHandle, f.subject),
                        }}
                        preload="intent"
                        {...stylex.props(styles.friendRowLink)}
                      >
                        <Avatar
                          src={f.avatarUrl ?? undefined}
                          size="lg"
                          alt={
                            f.displayName?.trim() || f.displayHandle || f.subjectHandle || f.subject
                          }
                          fallback={(
                            f.displayHandle?.trim()?.[0] ??
                            f.subjectHandle?.[0] ??
                            f.subject[0] ??
                            "?"
                          ).toUpperCase()}
                        />
                        {friendIdentity(
                          f.displayName,
                          f.displayHandle,
                          f.note ? <SmallBody>{f.note}</SmallBody> : null,
                        )}
                      </Link>
                      <Button
                        variant="tertiary"
                        onPress={() =>
                          setRemoveTarget({
                            rkey: f.rkey,
                            handle: f.displayHandle ?? f.subjectHandle ?? null,
                          })
                        }
                        isDisabled={removeMut.isPending}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </Flex>
              )}
            </CardBody>
          </Card>
        </Flex>

        {viewerDid && incoming.length > 0 ? (
          <Flex direction="column" gap="2xl">
            <Card size="md">
              <CardHeader hasBorder>
                <CardTitle style={styles.cardTitleMono}>
                  Trusted by{" "}
                  <span {...stylex.props(styles.countBadge)}>
                    <Badge variant="default">{incoming.length}</Badge>
                  </span>
                </CardTitle>
                <CardDescription style={styles.cardDescription}>
                  These DIDs have friended you. Their private chat-completions calls can route to
                  machines you operate — a one-way trust they extended to you. Friending is
                  asymmetric: you haven't friended them back unless you do so explicitly above.
                </CardDescription>
              </CardHeader>
              <CardBody>
                <Flex direction="column" gap="sm">
                  {incoming.map((f) => (
                    <div {...stylex.props(styles.friendRow)} key={f.friender}>
                      <Link
                        to="/u/$identifier"
                        params={{
                          identifier: friendLinkIdentifier(f.displayHandle, f.friender),
                        }}
                        preload="intent"
                        {...stylex.props(styles.friendRowLink)}
                      >
                        <Avatar
                          src={f.avatarUrl ?? undefined}
                          size="lg"
                          alt={
                            f.displayName?.trim() ||
                            f.displayHandle ||
                            f.frienderHandle ||
                            f.friender
                          }
                          fallback={(
                            f.displayHandle?.trim()?.[0] ??
                            f.frienderHandle?.[0] ??
                            f.friender[0] ??
                            "?"
                          ).toUpperCase()}
                        />
                        {friendIdentity(f.displayName, f.displayHandle, null)}
                      </Link>
                      <div {...stylex.props(styles.friendRowMeta)}>
                        <SmallBody variant="secondary">
                          Friended you on {f.createdAt.slice(0, 10)}
                        </SmallBody>
                      </div>
                    </div>
                  ))}
                </Flex>
              </CardBody>
            </Card>
          </Flex>
        ) : null}
      </div>

      <AlertDialog
        isOpen={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        trigger={
          <button
            type="button"
            style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
            tabIndex={-1}
            aria-hidden
          />
        }
      >
        <AlertDialogHeader>Remove this friend?</AlertDialogHeader>
        <AlertDialogDescription>
          {removeTarget ? (
            <Flex direction="column" gap="6xl">
              <Body>
                {removeTarget.handle
                  ? `Stop trusting @${removeTarget.handle} for private compute routing?`
                  : "Stop trusting this DID for private compute routing?"}
              </Body>
              <SmallBody>
                The friends-only endpoint will no longer consider machines they operate when
                dispatching your jobs. They are not notified when you remove them.
              </SmallBody>
            </Flex>
          ) : null}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <Flex direction="row" gap="md">
            <AlertDialogCancelButton isDisabled={removeMut.isPending}>
              Cancel
            </AlertDialogCancelButton>
            <Button
              variant="critical"
              isDisabled={removeMut.isPending}
              onPress={() => void confirmRemoveFriend()}
            >
              {removeMut.isPending ? "Removing…" : "Remove"}
            </Button>
          </Flex>
        </AlertDialogFooter>
      </AlertDialog>
    </Page.Root>
  );
}
