"use client";

// Public profile page at /u/$identifier. Renders everything a viewer
// needs to know about a cocore member: avatar, display name, handle,
// DID, bio, signup date, last activity, machines they operate,
// activity counts, and Follow / Unfollow when the viewer is signed in.
// The browser title comes from the route `head()` — no duplicate path
// breadcrumb in `Page.Header`.
//
// One AppView round-trip per page load (`getProfile`); the incoming-
// friends list (DIDs who friended you) is fetched lazily under
// "People who trust you" if the viewer is on their own profile —
// the inbound direction, not your own outgoing trust set. Friend
// mutations invalidate the
// listMyFriends query so the follow state flips immediately.
//
// Sparklines + heatmap use `profile.weekSeries` from AppView
// (`indexed_at` buckets, UTC Monday weeks).

import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addFriendMutationOptions,
  listMyFriendsQueryOptions,
  removeFriendMutationOptions,
} from "@/components/friends/friends.functions.ts";
import {
  incomingFriendsQueryOptions,
  profilePageQueryOptions,
} from "@/components/profile/profile.functions.ts";
import { ProfileSparkline } from "@/components/profile/ProfileSparkline.tsx";
import { Avatar } from "@/design-system/avatar";
import { Badge } from "@/design-system/badge";
import { Button } from "@/design-system/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardHeaderAction,
  CardTitle,
} from "@/design-system/card";
import { Flex } from "@/design-system/flex";
import { Page } from "@/design-system/page";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@/design-system/table";
import { primaryColor, successColor, uiColor } from "@/design-system/theme/color.stylex";
import { breakpoints } from "@/design-system/theme/media-queries.stylex";
import { radius } from "@/design-system/theme/radius.stylex";
import {
  gap as gapSpace,
  horizontalSpace,
  size,
  verticalSpace,
} from "@/design-system/theme/semantic-spacing.stylex";
import { fontFamily, fontSize, fontWeight } from "@/design-system/theme/typography.stylex";
import { toasts } from "@/design-system/toast";
import { Heading1, InlineCode } from "@/design-system/typography";
import { formatTokensCompact } from "@/lib/token-display.ts";
import { formatLatencyMs } from "@/lib/latency-display.ts";
import type {
  AppviewProfilePagePayload,
  AppviewProfileWeekSeries,
} from "@/integrations/appview/appview.server.ts";
import { getSessionQueryOptions } from "@/integrations/auth/session.functions.ts";
import { getMyBalanceQueryOptions } from "@/components/account/token-balance.functions.ts";
import { Goober } from "@/components/Goober.tsx";
import { Link } from "@tanstack/react-router";

const styles = stylex.create({
  pageHeader: {
    paddingBottom: verticalSpace["6xl"],
  },
  avatar: {
    height: size["7xl"],
    width: size["7xl"],
  },
  titlePrompt: {
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  headingMono: { fontFamily: fontFamily.mono },
  cardTitleMono: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: uiColor.text2,
    textTransform: "lowercase",
    fontFamily: fontFamily.mono,
  },
  cardDescription: {
    fontSize: fontSize.xs,
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  sections: {
    display: "flex",
    flexDirection: "column",
    gap: verticalSpace["xl"],
    minWidth: 0,
    width: "100%",
  },
  balanceLabel: {
    color: uiColor.text1,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
  },
  balanceRow: {
    alignItems: "baseline",
    display: "flex",
    flexWrap: "wrap",
    gap: horizontalSpace.md,
    marginTop: verticalSpace.xs,
  },
  balanceBig: {
    color: uiColor.text2,
    fontFamily: fontFamily.mono,
    fontSize: fontSize["4xl"],
    fontVariantNumeric: "tabular-nums",
    fontWeight: fontWeight.medium,
  },
  balanceUnit: {
    color: uiColor.text1,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.lg,
  },
  balanceLink: {
    color: primaryColor.text2,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    marginLeft: "auto",
  },
  // Relative wrapper so a goobie can hang off the card's edge.
  gooberWrap: {
    position: "relative",
  },
  // Cloud goobie floating off the top-right of the balance card.
  balanceGoober: {
    top: "-2.6rem",
    right: "1.25rem",
    opacity: 0.95,
  },
  breadcrumb: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    color: uiColor.text1,
    marginBottom: verticalSpace["3xl"],
    letterSpacing: "0.02em",
  },
  profileHeroRow: {
    display: "flex",
    flexDirection: {
      default: "column",
      [breakpoints.md]: "row",
    },
    gap: gapSpace["2xl"],
    alignItems: {
      default: "stretch",
      [breakpoints.md]: "flex-start",
    },
    justifyContent: "space-between",
  },
  profileMain: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: gapSpace["2xl"],
    minWidth: 0,
    flex: 1,
  },
  profileActions: {
    flexShrink: 0,
    alignSelf: {
      default: "stretch",
      [breakpoints.md]: "flex-start",
    },
  },
  avatarWrap: {
    position: "relative",
    flexShrink: 0,
  },
  onlineDot: {
    position: "absolute",
    bottom: "0.15rem",
    right: "0.15rem",
    width: "0.65rem",
    height: "0.65rem",
    borderRadius: radius.full,
    backgroundColor: successColor.solid1,
    borderColor: uiColor.bg,
    borderStyle: "solid",
    borderWidth: 2,
    boxSizing: "border-box",
  },
  heroColumn: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: gapSpace.md,
    flex: 1,
  },
  nameTitleRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: gapSpace.md,
    rowGap: gapSpace.sm,
  },
  displayNameHero: {
    fontFamily: fontFamily.mono,
    fontWeight: fontWeight["semibold"],
    fontSize: fontSize["2xl"],
    color: uiColor.text2,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  },
  handleHero: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.base,
    color: uiColor.text1,
  },
  bioHero: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    color: uiColor.text2,
    lineHeight: 1.55,
    maxWidth: "42rem",
  },
  metaRowHero: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: gapSpace.lg,
    rowGap: gapSpace.sm,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    color: uiColor.text1,
    paddingTop: gapSpace.sm,
  },
  metaSep: {
    color: uiColor.border2,
    userSelect: "none",
  },
  activeRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: gapSpace.sm,
  },
  activeDot: {
    width: "0.45rem",
    height: "0.45rem",
    borderRadius: radius.full,
    backgroundColor: successColor.solid1,
    flexShrink: 0,
  },
  didMetaRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: gapSpace.sm,
    minWidth: 0,
    flexWrap: "wrap",
  },
  didSnippet: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: {
      default: "14rem",
      [breakpoints.sm]: "22rem",
    },
  },
  metricsRow: {
    display: "flex",
    flexDirection: {
      default: "column",
      [breakpoints.lg]: "row",
    },
    marginTop: verticalSpace["4xl"],
    paddingTop: verticalSpace["4xl"],
    borderTopColor: uiColor.border1,
    borderTopStyle: "solid",
    borderTopWidth: 1,
  },
  metricCell: {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    flex: {
      default: "none",
      [breakpoints.lg]: 1,
    },
    minHeight: 0,
    minWidth: 0,
    paddingBlock: verticalSpace.lg,
    paddingInline: gapSpace.lg,
    borderBottomColor: uiColor.border1,
    borderBottomStyle: {
      default: "solid",
      [breakpoints.lg]: "none",
    },
    borderBottomWidth: {
      default: 1,
      [breakpoints.lg]: 0,
    },
    borderLeftColor: uiColor.border1,
    borderLeftStyle: {
      default: "none",
      [breakpoints.lg]: "solid",
    },
    borderLeftWidth: {
      default: 0,
      [breakpoints.lg]: 1,
    },
  },
  metricCellFirst: {
    borderLeftWidth: {
      default: 0,
      [breakpoints.lg]: 0,
    },
    borderLeftStyle: {
      default: "none",
      [breakpoints.lg]: "none",
    },
  },
  metricTitle: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    color: uiColor.text1,
    textTransform: "lowercase",
    letterSpacing: "0.04em",
    marginBottom: gapSpace.sm,
  },
  metricValue: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize["2xl"],
    fontWeight: fontWeight.medium,
    color: uiColor.text2,
    lineHeight: 1.15,
  },
  metricSub: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    color: uiColor.text1,
    flexGrow: 1,
    marginTop: gapSpace.xs,
    minHeight: "1rem",
  },
  heatmapSection: {
    marginTop: verticalSpace["4xl"],
    paddingTop: verticalSpace["4xl"],
    borderTopColor: uiColor.border1,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    minWidth: 0,
    width: "100%",
  },
  heatmapHead: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: gapSpace.lg,
    marginBottom: gapSpace.lg,
  },
  heatmapGrid: {
    boxSizing: "border-box",
    display: "grid",
    gap: gapSpace.xs,
    gridTemplateColumns: "repeat(52, minmax(0, 1fr))",
    minWidth: 0,
    paddingBottom: gapSpace.sm,
    width: "100%",
  },
  heatmapCellBase: {
    aspectRatio: "1",
    borderRadius: radius.sm,
    minHeight: 0,
    minWidth: 0,
    width: "100%",
  },
  heatmapIx0: {
    backgroundColor: uiColor.component2,
  },
  heatmapIx1: {
    backgroundColor: successColor.component3,
  },
  heatmapIx2: {
    backgroundColor: successColor.component2,
  },
  heatmapIx3: {
    backgroundColor: successColor.solid2,
  },
  heatmapIx4: {
    backgroundColor: successColor.solid1,
  },
  heatmapLegend: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: gapSpace.sm,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    color: uiColor.text1,
  },
  heatmapLegendSwatch1: {
    width: "0.875rem",
    height: "0.875rem",
    borderRadius: radius.sm,
    backgroundColor: uiColor.component2,
  },
  heatmapLegendSwatch2: {
    width: "0.875rem",
    height: "0.875rem",
    borderRadius: radius.sm,
    backgroundColor: successColor.component3,
  },
  heatmapLegendSwatch3: {
    width: "0.875rem",
    height: "0.875rem",
    borderRadius: radius.sm,
    backgroundColor: successColor.component2,
  },
  heatmapLegendSwatch4: {
    width: "0.875rem",
    height: "0.875rem",
    borderRadius: radius.sm,
    backgroundColor: successColor.solid1,
  },
  identityRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: gapSpace["lg"],
    flexWrap: "wrap",
  },
  listIdentity: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: gapSpace.xxs,
    flex: 1,
  },
  machinesCardHeaderFlush: {
    marginBottom: 0,
  },
  machinesNavLink: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    color: uiColor.text1,
    textDecoration: {
      default: "none",
      ":hover": "underline",
    },
  },
  machineTableWrap: {
    overflowX: "auto",
    paddingBottom: verticalSpace["3xl"],
    width: "100%",
  },
  /** First column header: match `Card` md `--card-x-padding` and default sm table leading inset. */
  profileMachineLeadHeaderCell: {
    paddingLeft: horizontalSpace["lg"],
  },
  /** First column body: same horizontal start as header + card title row. */
  profileMachineLeadRowCell: {
    minHeight: size["3xl"],
    paddingBottom: verticalSpace.xs,
    paddingLeft: horizontalSpace["3xl"],
    paddingRight: horizontalSpace.md,
    paddingTop: verticalSpace.xs,
  },
  profileMachinesTable: {
    minWidth: "1052px",
    width: "100%",
  },
  profileMachineCellBase: {
    paddingInline: horizontalSpace.md,
    paddingBlock: verticalSpace.xs,
    minHeight: size["3xl"],
  },
  profileMachineCellStack: {
    alignItems: "flex-start",
    flexDirection: "column",
    justifyContent: "center",
  },
  profileMachineCellRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  machineNamePrimary: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: uiColor.text2,
  },
  machineNameLink: {
    color: { default: primaryColor.text2, ":hover": primaryColor.text1 },
    textDecoration: "none",
  },
  machineNameMeta: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    color: uiColor.text1,
    marginTop: gapSpace.xxs,
  },
  machineSpecPrimary: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: uiColor.text2,
  },
  machineSpecMeta: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    color: uiColor.text1,
    marginTop: gapSpace.xxs,
  },
  machineStatusRow: {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    gap: gapSpace.sm,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    color: uiColor.text2,
  },
  machineStatusDot: {
    borderRadius: radius.full,
    flexShrink: 0,
    height: 7,
    width: 7,
  },
  machineStatusRunning: {
    backgroundColor: successColor.solid1,
    boxShadow: `0 0 0 3px ${successColor.bgSubtle}`,
  },
  machineStatusIdle: {
    backgroundColor: primaryColor.solid2,
  },
  machineStatusPaused: {
    backgroundColor: uiColor.solid2,
  },
  modelPillRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: gapSpace.xs,
    maxWidth: "100%",
  },
  modelPill: {
    borderColor: uiColor.border1,
    borderRadius: radius.sm,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: uiColor.component1,
    color: uiColor.text2,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    maxWidth: "11rem",
    overflow: "hidden",
    paddingBlock: gapSpace.xxs,
    paddingInline: gapSpace.sm,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  utilRow: {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    gap: gapSpace.sm,
    justifyContent: "flex-start",
  },
  utilTrack: {
    backgroundColor: uiColor.component2,
    borderRadius: radius.full,
    flexShrink: 0,
    height: 4,
    overflow: "hidden",
    width: "3.5rem",
  },
  utilBar: {
    backgroundColor: successColor.solid1,
    borderRadius: radius.full,
    height: "100%",
  },
  tableDash: {
    color: uiColor.text1,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
  },
  emptyState: {
    color: uiColor.text1,
    fontSize: fontSize.sm,
    paddingBlock: gapSpace["md"],
  },
  mutedSecondaryLine: {
    opacity: 0.75,
  },
  pageRoot: {
    maxWidth: "1200px",
    width: "100%",
    paddingTop: verticalSpace["8xl"],
    paddingBottom: verticalSpace["12xl"],
  },
});

const HEATMAP_LEVEL_STYLES = [
  styles.heatmapIx0,
  styles.heatmapIx1,
  styles.heatmapIx2,
  styles.heatmapIx3,
  styles.heatmapIx4,
];

type ProfileMachineRow = AppviewProfilePagePayload["machines"][number];

const PROFILE_MACHINE_COLUMNS: Array<{
  id: string;
  label: string;
  width: number;
}> = [
  { id: "machine", label: "machine", width: 240 },
  { id: "spec", label: "gpu / spec", width: 148 },
  { id: "status", label: "status", width: 104 },
  { id: "models", label: "models served", width: 280 },
  { id: "util", label: "util · 24h", width: 112 },
  { id: "jobs", label: "jobs today", width: 80 },
  { id: "tokens", label: "tokens · 24h", width: 88 },
];

function profileMachineStatus(m: ProfileMachineRow): {
  label: string;
  tone: "running" | "idle" | "paused";
} {
  if (m.active === true) return { label: "running", tone: "running" };
  if (m.active === false) return { label: "paused", tone: "paused" };
  return { label: "idle", tone: "idle" };
}

function modelTailLabel(modelId: string): string {
  const tail = modelId.split("/").pop() ?? modelId;
  return tail.length > 32 ? `${tail.slice(0, 29)}…` : tail;
}

function heatmapLevel(combined: number, maxCombined: number): 0 | 1 | 2 | 3 | 4 {
  if (combined <= 0 || maxCombined <= 0) return 0;
  const r = combined / maxCombined;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

const PROFILE_WEEK_BUCKET_COUNT = 52;

function padWeekNumbers(a: unknown): number[] {
  if (!Array.isArray(a)) return Array.from({ length: PROFILE_WEEK_BUCKET_COUNT }, () => 0);
  const nums = a.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0));
  if (nums.length === PROFILE_WEEK_BUCKET_COUNT) return nums;
  if (nums.length > PROFILE_WEEK_BUCKET_COUNT) return nums.slice(0, PROFILE_WEEK_BUCKET_COUNT);
  return [...nums, ...Array(PROFILE_WEEK_BUCKET_COUNT - nums.length).fill(0)];
}

/** AppView should always send 52 buckets; coerce so sparklines + heatmap never disappear on partial JSON. */
function coerceProfileWeekSeries(
  raw: AppviewProfileWeekSeries | null | undefined,
): AppviewProfileWeekSeries {
  if (!raw) {
    return {
      oldestWeekStart: "",
      jobsDispatched: padWeekNumbers(undefined),
      receiptsServed: padWeekNumbers(undefined),
      machinesIndexedCumulative: padWeekNumbers(undefined),
      tokensIndexed: padWeekNumbers(undefined),
      trustedByNew: padWeekNumbers(undefined),
    };
  }
  return {
    oldestWeekStart: typeof raw.oldestWeekStart === "string" ? raw.oldestWeekStart : "",
    jobsDispatched: padWeekNumbers(raw.jobsDispatched),
    receiptsServed: padWeekNumbers(raw.receiptsServed),
    machinesIndexedCumulative: padWeekNumbers(raw.machinesIndexedCumulative),
    tokensIndexed: padWeekNumbers(raw.tokensIndexed),
    trustedByNew: padWeekNumbers(raw.trustedByNew),
  };
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(t));
}

function formatJoinedCalendar(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(t),
  );
}

function isActiveWithinMs(iso: string | null, withinMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < withinMs;
}

export function ProfilePage({ identifier }: { identifier: string }) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery(profilePageQueryOptions(identifier));
  const sessionQuery = useQuery(getSessionQueryOptions);
  const friendsQuery = useQuery(listMyFriendsQueryOptions);
  const addMut = useMutation(addFriendMutationOptions);
  const removeMut = useMutation(removeFriendMutationOptions);

  const bundle = profileQuery.data;
  const profile = bundle?.profile ?? null;
  const resolved = bundle?.resolved ?? null;
  const viewerDid = sessionQuery.data?.user?.did ?? null;
  const isSelf = viewerDid !== null && resolved !== null && resolved.did === viewerDid;
  const friends = friendsQuery.data ?? [];
  const existingFriend = friends.find((f) => f.subject === resolved?.did) ?? null;

  // Incoming-friends list — only fetched when viewing your own
  // profile, to keep the "Trusted by you" surface scoped to the
  // viewer. (Other people's incoming friends are public via
  // listIncomingFriends but we don't surface them on their profile
  // page yet; first we want to see how the social signal feels.)
  const incomingFriendsQuery = useQuery({
    ...incomingFriendsQueryOptions(resolved?.did ?? ""),
    enabled: isSelf && resolved !== null,
  });

  // Spendable ledger balance — only the account owner can read their
  // own balance, so it's fetched (and shown) on your own profile only.
  const balanceQuery = useQuery({ ...getMyBalanceQueryOptions, enabled: isSelf });

  const onFriend = async (): Promise<void> => {
    if (!resolved) return;
    const handle = profile?.handle ?? resolved.handle ?? null;
    const out = await addMut.mutateAsync({
      subject: resolved.did,
      subjectHandle: handle,
    });
    toasts.add(
      {
        title: out.created
          ? handle
            ? `Now following @${handle}`
            : "Now following"
          : "Already following",
        variant: out.created ? "success" : "neuthral",
      },
      { timeout: 2400 },
    );
    await queryClient.invalidateQueries({ queryKey: listMyFriendsQueryOptions.queryKey });
  };

  const onUnfriend = async (): Promise<void> => {
    if (!existingFriend) return;
    await removeMut.mutateAsync({ rkey: existingFriend.rkey });
    const handle = profile?.handle ?? resolved?.handle ?? null;
    toasts.add(
      {
        title: handle ? `Unfollowed @${handle}` : "Unfollowed",
        variant: "success",
      },
      { timeout: 2400 },
    );
    await queryClient.invalidateQueries({ queryKey: listMyFriendsQueryOptions.queryKey });
  };

  if (!bundle || !resolved) {
    return (
      <Page.Root>
        <Page.Header>
          <Heading1 style={styles.headingMono}>profile</Heading1>
        </Page.Header>
        <div {...stylex.props(styles.emptyState)}>
          Could not resolve <InlineCode>{identifier}</InlineCode> to a co/core account.
        </div>
      </Page.Root>
    );
  }

  const display = profile?.displayName ?? profile?.handle ?? resolved.handle ?? resolved.did;
  const handle = profile?.handle ?? resolved.handle ?? null;
  const joinedFormatted = formatJoinedCalendar(profile?.joinedAt ?? null);
  const lastActive = profile?.lastActivityAt ?? null;
  const machines = profile?.machines ?? [];
  const totalMc = machines.length;
  const runningMc = machines.filter((m) => m.active === true).length;
  const pausedMc = machines.filter((m) => m.active === false).length;
  const idleMc = machines.filter((m) => m.active !== true && m.active !== false).length;
  const onlineMc = machines.filter((m) => m.active !== false).length;
  const showOnlineDot =
    isActiveWithinMs(lastActive, 48 * 60 * 60 * 1000) ||
    (totalMc > 0 && machines.some((m) => m.active !== false));

  let chartWeeks: AppviewProfileWeekSeries | null = null;
  if (profile) {
    chartWeeks = coerceProfileWeekSeries(profile.weekSeries);
  }
  const tokensApprox4Weeks =
    chartWeeks === null
      ? 0
      : chartWeeks.tokensIndexed.slice(-4).reduce((a: number, b: number) => a + b, 0);
  const jobsWeekDelta =
    chartWeeks === null
      ? 0
      : (chartWeeks.jobsDispatched[51] ?? 0) - (chartWeeks.jobsDispatched[50] ?? 0);
  const machinesWeekDelta =
    chartWeeks === null
      ? 0
      : (chartWeeks.machinesIndexedCumulative[51] ?? 0) -
        (chartWeeks.machinesIndexedCumulative[50] ?? 0);
  const combinedWeekly: number[] =
    chartWeeks === null
      ? []
      : chartWeeks.jobsDispatched.map(
          (j: number, i: number) => j + (chartWeeks.receiptsServed[i] ?? 0),
        );
  const maxCombinedWeekly = combinedWeekly.length > 0 ? Math.max(1, ...combinedWeekly) : 1;

  return (
    <Page.Root variant="small" style={styles.pageRoot}>
      <Page.Header style={styles.pageHeader}>
        <Flex direction="column" gap="xl">
          <Heading1 style={styles.headingMono}>
            <span {...stylex.props(styles.titlePrompt)}>~/</span>u/{resolved.handle ?? resolved.did}
          </Heading1>
        </Flex>
      </Page.Header>
      <div {...stylex.props(styles.sections)}>
        {isSelf ? (
          <div {...stylex.props(styles.gooberWrap)}>
            <Card size="md">
              <CardBody>
                <div {...stylex.props(styles.balanceLabel)}>balance</div>
                <div {...stylex.props(styles.balanceRow)}>
                  <span {...stylex.props(styles.balanceBig)}>
                    {balanceQuery.data ? formatTokensCompact(balanceQuery.data.balance) : "—"}
                  </span>
                  <span {...stylex.props(styles.balanceUnit)}>CC</span>
                  <Link to="/account" preload="intent" {...stylex.props(styles.balanceLink)}>
                    balance log →
                  </Link>
                </div>
              </CardBody>
            </Card>
            <Goober name="cloud" size={92} style={styles.balanceGoober} />
          </div>
        ) : null}
        <Card size="lg">
          <CardBody>
            <div {...stylex.props(styles.profileHeroRow)}>
              <div {...stylex.props(styles.profileMain)}>
                <div {...stylex.props(styles.avatarWrap)}>
                  <Avatar
                    src={profile?.avatarUrl ?? undefined}
                    alt={resolved.handle ?? resolved.did}
                    fallback={(display[0] ?? "?").toUpperCase()}
                    size="xl"
                    style={styles.avatar}
                  />
                  {showOnlineDot ? (
                    <span
                      {...stylex.props(styles.onlineDot)}
                      aria-label="Recently active on the network"
                    />
                  ) : null}
                </div>
                <div {...stylex.props(styles.heroColumn)}>
                  <div {...stylex.props(styles.nameTitleRow)}>
                    <Heading1 style={styles.displayNameHero}>{display}</Heading1>
                    {profile && profile.machines.length > 0 ? (
                      <Badge variant="success" size="sm">
                        * provider
                      </Badge>
                    ) : null}
                  </div>
                  {handle ? <div {...stylex.props(styles.handleHero)}>{`@${handle}`}</div> : null}
                  {profile?.bio ? <div {...stylex.props(styles.bioHero)}>{profile.bio}</div> : null}
                  <div {...stylex.props(styles.metaRowHero)}>
                    {lastActive ? (
                      <>
                        <span {...stylex.props(styles.activeRow)}>
                          <span {...stylex.props(styles.activeDot)} aria-hidden />
                          <span>{`active ${relativeTime(lastActive)}`}</span>
                        </span>
                        <span {...stylex.props(styles.metaSep)} aria-hidden>
                          ·
                        </span>
                      </>
                    ) : null}
                    {joinedFormatted ? (
                      <>
                        <span>{`joined ${joinedFormatted}`}</span>
                        <span {...stylex.props(styles.metaSep)} aria-hidden>
                          ·
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              {isSelf ? null : sessionQuery.data ? (
                <div {...stylex.props(styles.profileActions)}>
                  {existingFriend ? (
                    <Button
                      variant="tertiary"
                      onPress={() => void onUnfriend()}
                      isDisabled={removeMut.isPending}
                    >
                      {removeMut.isPending ? "Unfollowing…" : "Unfollow"}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onPress={() => void onFriend()}
                      isDisabled={addMut.isPending}
                    >
                      {addMut.isPending ? "Following…" : "Follow"}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>

            {profile && chartWeeks ? (
              <>
                <div {...stylex.props(styles.metricsRow)}>
                  <div {...stylex.props(styles.metricCell, styles.metricCellFirst)}>
                    <div {...stylex.props(styles.metricTitle)}>jobs dispatched</div>
                    <div {...stylex.props(styles.metricValue)}>{profile.jobCount}</div>
                    <div {...stylex.props(styles.metricSub)}>
                      {`${jobsWeekDelta >= 0 ? "+" : ""}${jobsWeekDelta} vs prior week (indexed)`}
                    </div>
                    <ProfileSparkline
                      title="Jobs indexed per week (UTC Monday buckets, oldest → newest)"
                      values={chartWeeks.jobsDispatched}
                    />
                  </div>
                  <div {...stylex.props(styles.metricCell)}>
                    <div {...stylex.props(styles.metricTitle)}>receipts served</div>
                    <div {...stylex.props(styles.metricValue)}>{profile.receiptCount}</div>
                    <div {...stylex.props(styles.metricSub)}>
                      {`${chartWeeks.receiptsServed[51]} indexed last week · ${profile.receiptCount} lifetime`}
                    </div>
                    <ProfileSparkline
                      title="Receipts indexed per week on this provider repo"
                      values={chartWeeks.receiptsServed}
                    />
                  </div>
                  <div {...stylex.props(styles.metricCell)}>
                    <div {...stylex.props(styles.metricTitle)}>machines online</div>
                    <div {...stylex.props(styles.metricValue)}>
                      {totalMc > 0 ? `${onlineMc} / ${totalMc}` : "—"}
                    </div>
                    <div {...stylex.props(styles.metricSub)}>
                      {totalMc > 0
                        ? `${runningMc} running · ${idleMc} idle${pausedMc > 0 ? ` · ${pausedMc} paused` : ""}`
                        : "no machines indexed"}
                      {totalMc > 0 ? (
                        <span> · machines +{machinesWeekDelta} vs prior week</span>
                      ) : null}
                    </div>
                    <ProfileSparkline
                      title="Cumulative provider rows indexed through each week"
                      values={chartWeeks.machinesIndexedCumulative}
                    />
                  </div>
                  <div {...stylex.props(styles.metricCell)}>
                    <div {...stylex.props(styles.metricTitle)}>tokens · ~4w</div>
                    <div {...stylex.props(styles.metricValue)}>
                      {tokensApprox4Weeks > 0 ? formatTokensCompact(tokensApprox4Weeks) : "—"}
                    </div>
                    <div {...stylex.props(styles.metricSub)}>
                      {`${formatTokensCompact(chartWeeks.tokensIndexed[51] ?? 0)} indexed last week · rolling 4w sum`}
                    </div>
                    <ProfileSparkline
                      title="Receipt tokens (in+out) indexed per week"
                      values={chartWeeks.tokensIndexed}
                      variant="success"
                    />
                  </div>
                  <div {...stylex.props(styles.metricCell)}>
                    <div {...stylex.props(styles.metricTitle)}>trusted by</div>
                    <div {...stylex.props(styles.metricValue)}>{profile.incomingFriendsCount}</div>
                    <div {...stylex.props(styles.metricSub)}>
                      {`${chartWeeks.trustedByNew[51]} new follows indexed last week`}
                    </div>
                    <ProfileSparkline
                      title="Inbound friend records indexed per week"
                      values={chartWeeks.trustedByNew}
                      variant="success"
                    />
                  </div>
                  <div {...stylex.props(styles.metricCell)}>
                    <div {...stylex.props(styles.metricTitle)}>latency · p50</div>
                    <div {...stylex.props(styles.metricValue)}>
                      {profile.latency && profile.latency.p50Ms !== null
                        ? formatLatencyMs(profile.latency.p50Ms)
                        : "—"}
                    </div>
                    <div {...stylex.props(styles.metricSub)}>
                      {profile.latency && profile.latency.sampleCount > 0
                        ? `${profile.latency.p95Ms !== null ? `p95 ${formatLatencyMs(profile.latency.p95Ms)} · ` : ""}last ${profile.latency.sampleCount} receipt${profile.latency.sampleCount === 1 ? "" : "s"}`
                        : "no timed receipts yet"}
                    </div>
                  </div>
                </div>

                <div
                  {...stylex.props(styles.heatmapSection)}
                  role="region"
                  aria-label="Jobs plus receipts indexed per week (52 weeks)"
                >
                  <div {...stylex.props(styles.heatmapHead)}>
                    <div {...stylex.props(styles.cardTitleMono)}>activity · last 52 weeks</div>
                    <div {...stylex.props(styles.heatmapLegend)}>
                      <span>less</span>
                      <span {...stylex.props(styles.heatmapLegendSwatch1)} />
                      <span {...stylex.props(styles.heatmapLegendSwatch2)} />
                      <span {...stylex.props(styles.heatmapLegendSwatch3)} />
                      <span {...stylex.props(styles.heatmapLegendSwatch4)} />
                      <span>more</span>
                    </div>
                  </div>
                  <div {...stylex.props(styles.heatmapGrid)} aria-hidden>
                    {combinedWeekly.map((c: number, i: number) => {
                      const lv = heatmapLevel(c, maxCombinedWeekly);
                      return (
                        <div
                          {...stylex.props(styles.heatmapCellBase, HEATMAP_LEVEL_STYLES[lv])}
                          key={i}
                        />
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </CardBody>
        </Card>

        {profile && profile.machines.length > 0 ? (
          <Card size="md">
            <CardHeader hasBorder style={styles.machinesCardHeaderFlush}>
              <CardTitle style={styles.cardTitleMono}>machines</CardTitle>
              <CardHeaderAction>
                <Link to="/machines" preload="intent" {...stylex.props(styles.machinesNavLink)}>
                  all machines →
                </Link>
              </CardHeaderAction>
              <CardDescription style={styles.cardDescription}>
                {`${totalMc} indexed · ${runningMc} running · ${idleMc} idle · ${pausedMc} paused`}
              </CardDescription>
            </CardHeader>
            <div {...stylex.props(styles.machineTableWrap)}>
              <Table
                aria-label="Machines indexed for this provider"
                size="sm"
                style={styles.profileMachinesTable}
              >
                <TableHeader columns={PROFILE_MACHINE_COLUMNS}>
                  {(col) => (
                    <TableColumn
                      isRowHeader={col.id === "machine"}
                      headerContentStyle={
                        col.id === "machine" ? styles.profileMachineLeadHeaderCell : undefined
                      }
                      width={col.width}
                    >
                      {col.label}
                    </TableColumn>
                  )}
                </TableHeader>
                <TableBody items={profile.machines}>
                  {(m) => {
                    const status = profileMachineStatus(m);
                    const specTitle = m.chip?.trim() || null;
                    const specRam = m.ramGB != null ? `${m.ramGB} GB` : null;
                    const showSpec = specTitle !== null || specRam !== null;
                    return (
                      <TableRow
                        columns={PROFILE_MACHINE_COLUMNS}
                        id={m.rkey}
                        textValue={`${m.machineLabel ?? m.rkey} ${m.rkey}`}
                      >
                        {(col) => {
                          if (col.id === "machine") {
                            const title = m.machineLabel?.trim() || m.rkey;
                            return (
                              <TableCell
                                contentStyle={[
                                  styles.profileMachineLeadRowCell,
                                  styles.profileMachineCellStack,
                                ]}
                              >
                                {isSelf ? (
                                  <Link
                                    to="/machines/$rkey"
                                    params={{ rkey: m.rkey }}
                                    preload="intent"
                                    {...stylex.props(
                                      styles.machineNamePrimary,
                                      styles.machineNameLink,
                                    )}
                                  >
                                    {title}
                                  </Link>
                                ) : (
                                  <div {...stylex.props(styles.machineNamePrimary)}>{title}</div>
                                )}
                                {m.machineLabel ? (
                                  <div {...stylex.props(styles.machineNameMeta)}>{m.rkey}</div>
                                ) : null}
                              </TableCell>
                            );
                          }
                          if (col.id === "spec") {
                            if (!showSpec) {
                              return (
                                <TableCell
                                  contentStyle={[
                                    styles.profileMachineCellBase,
                                    styles.profileMachineCellRow,
                                  ]}
                                >
                                  <span {...stylex.props(styles.tableDash)}>—</span>
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell
                                contentStyle={[
                                  styles.profileMachineCellBase,
                                  styles.profileMachineCellStack,
                                ]}
                              >
                                {specTitle ? (
                                  <div {...stylex.props(styles.machineSpecPrimary)}>
                                    {specTitle}
                                  </div>
                                ) : null}
                                {specRam ? (
                                  <div {...stylex.props(styles.machineSpecMeta)}>{specRam}</div>
                                ) : null}
                              </TableCell>
                            );
                          }
                          if (col.id === "status") {
                            return (
                              <TableCell
                                contentStyle={[
                                  styles.profileMachineCellBase,
                                  styles.profileMachineCellRow,
                                ]}
                              >
                                <div {...stylex.props(styles.machineStatusRow)}>
                                  <span
                                    aria-hidden
                                    {...stylex.props(
                                      styles.machineStatusDot,
                                      status.tone === "running" && styles.machineStatusRunning,
                                      status.tone === "idle" && styles.machineStatusIdle,
                                      status.tone === "paused" && styles.machineStatusPaused,
                                    )}
                                  />
                                  {status.label}
                                </div>
                              </TableCell>
                            );
                          }
                          if (col.id === "models") {
                            if (m.supportedModels.length === 0) {
                              return (
                                <TableCell
                                  contentStyle={[
                                    styles.profileMachineCellBase,
                                    styles.profileMachineCellRow,
                                  ]}
                                >
                                  <span {...stylex.props(styles.tableDash)}>—</span>
                                </TableCell>
                              );
                            }
                            const vis = m.supportedModels.slice(0, 3);
                            const rest = m.supportedModels.length - vis.length;
                            return (
                              <TableCell
                                contentStyle={[
                                  styles.profileMachineCellBase,
                                  styles.profileMachineCellRow,
                                ]}
                              >
                                <div {...stylex.props(styles.modelPillRow)}>
                                  {vis.map((mod) => (
                                    <span {...stylex.props(styles.modelPill)} key={mod} title={mod}>
                                      {modelTailLabel(mod)}
                                    </span>
                                  ))}
                                  {rest > 0 ? (
                                    <span {...stylex.props(styles.modelPill)}>{`+${rest}`}</span>
                                  ) : null}
                                </div>
                              </TableCell>
                            );
                          }
                          if (col.id === "util") {
                            return (
                              <TableCell
                                contentStyle={[
                                  styles.profileMachineCellBase,
                                  styles.profileMachineCellRow,
                                ]}
                              >
                                <div {...stylex.props(styles.utilRow)}>
                                  <div {...stylex.props(styles.utilTrack)} aria-hidden>
                                    <div
                                      {...stylex.props(styles.utilBar)}
                                      style={{ width: "0%" }}
                                    />
                                  </div>
                                  <span {...stylex.props(styles.tableDash)}>—</span>
                                </div>
                              </TableCell>
                            );
                          }
                          if (col.id === "jobs" || col.id === "tokens") {
                            return (
                              <TableCell
                                contentStyle={[
                                  styles.profileMachineCellBase,
                                  styles.profileMachineCellRow,
                                ]}
                              >
                                <span {...stylex.props(styles.tableDash)}>—</span>
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell
                              contentStyle={[
                                styles.profileMachineCellBase,
                                styles.profileMachineCellRow,
                              ]}
                            />
                          );
                        }}
                      </TableRow>
                    );
                  }}
                </TableBody>
              </Table>
            </div>
          </Card>
        ) : null}

        {isSelf && incomingFriendsQuery.data && incomingFriendsQuery.data.length > 0 ? (
          <Card size="md">
            <CardHeader hasBorder>
              <CardTitle style={styles.cardTitleMono}>People who trust you</CardTitle>
              <CardDescription style={styles.cardDescription}>
                {incomingFriendsQuery.data.length} member
                {incomingFriendsQuery.data.length === 1 ? "" : "s"} follow you. Their private
                chat-completions calls can route to your machines.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <Flex direction="row" align="center" gap="sm" wrap>
                {incomingFriendsQuery.data.slice(0, 8).map((f) => (
                  <Avatar
                    key={f.friender}
                    src={f.avatarUrl ?? undefined}
                    alt={f.displayName?.trim() || f.displayHandle || f.friender}
                    fallback={((f.displayHandle ?? f.friender)[0] ?? "?").toUpperCase()}
                    size="sm"
                  />
                ))}
                <Link to="/friends" preload="intent" {...stylex.props(styles.machinesNavLink)}>
                  view on friends →
                </Link>
              </Flex>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </Page.Root>
  );
}
