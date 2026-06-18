"use client";

// Token-balance card for /account.
//
// Read-only, but built to answer "where did my tokens go?" at a
// glance:
//   * the current balance (hero number)
//   * lifetime roll-ups — total credited, total debited, and
//     patronage received — so a member sees the shape of their
//     account without adding up rows by hand
//   * a newest-first activity feed that can be sliced to credits,
//     debits, or just patronage rebates
//
// Mints (grant, refresh, patronage rebate) flow in as side effects of
// using the network; debits (receipt-out, treasury-fee) flow as side
// effects of dispatching jobs / serving as a provider. The feed is
// pulled newest-first so a fresh rebate is the first thing you see.

import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  getMyActivityQueryOptions,
  getMyBalanceQueryOptions,
} from "@/components/account/token-balance.functions.ts";
import { Alert } from "@/design-system/alert";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/design-system/card";
import { Flex } from "@/design-system/flex";
import { SegmentedControl, SegmentedControlItem } from "@/design-system/segmented-control";
import { uiColor } from "@/design-system/theme/color.stylex";
import { fontFamily, fontSize, fontWeight } from "@/design-system/theme/typography.stylex";
import { Body, Heading2, InlineCode, LabelText, SmallBody } from "@/design-system/typography";

const styles = stylex.create({
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
  balanceRow: {
    alignItems: "baseline",
    display: "flex",
    gap: "0.75rem",
  },
  balanceTokens: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize["3xl"],
  },
  balanceUnit: {
    color: uiColor.text1,
    fontSize: fontSize.sm,
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "0.75rem",
  },
  statTile: {
    border: `1px solid ${uiColor.border2}`,
    borderRadius: "0.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.75rem 0.875rem",
  },
  statValue: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.lg,
  },
  statValueCredit: {
    color: "rgb(38, 122, 70)",
  },
  statValueDebit: {
    color: "rgb(176, 60, 60)",
  },
  policyNote: {
    color: uiColor.text1,
    fontSize: fontSize.xs,
  },
  eventTable: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: "0.5rem 1rem",
    color: uiColor.text1,
    fontSize: fontSize.sm,
  },
  eventDelta: {
    fontFamily: fontFamily.mono,
    textAlign: "right",
  },
  eventDeltaCredit: {
    color: "rgb(38, 122, 70)",
  },
  eventDeltaDebit: {
    color: "rgb(176, 60, 60)",
  },
  eventKind: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    textTransform: "lowercase",
  },
});

const EVENT_LABELS: Record<string, string> = {
  grant: "onboarding grant",
  refresh: "weekly refresh",
  "receipt-in": "earned (job served)",
  "receipt-out": "spent (job dispatched)",
  "treasury-fee": "treasury fee",
  "patronage-in": "patronage rebate",
  "patronage-out": "rebate paid out",
};

type Filter = "all" | "credits" | "debits" | "patronage";

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "credits", label: "Credits" },
  { id: "debits", label: "Debits" },
  { id: "patronage", label: "Patronage" },
];

interface LedgerEvent {
  kind: string;
  tokensDelta: number;
  balanceAfter: number;
  createdAt: string;
}

/** Bucket an event for the slice-and-dice filter. Patronage is its
 *  own bucket (it is the thing the member most wants to single out),
 *  so a patronage-in is NOT also counted under "credits" in the
 *  filter — even though it is a credit by sign. */
function categoryOf(kind: string): Filter {
  if (kind === "patronage-in" || kind === "patronage-out") return "patronage";
  return kind === "receipt-out" ? "debits" : "credits";
}

function matchesFilter(ev: LedgerEvent, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "credits") return ev.tokensDelta >= 0 && categoryOf(ev.kind) !== "patronage";
  if (filter === "debits") return ev.tokensDelta < 0 && categoryOf(ev.kind) !== "patronage";
  return categoryOf(ev.kind) === "patronage";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const dMs = Date.now() - t;
  const m = Math.floor(dMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function TokenBalanceCard({ did }: { did: string | null }) {
  const balanceQ = useQuery({ ...getMyBalanceQueryOptions, enabled: Boolean(did) });
  const activityQ = useQuery({ ...getMyActivityQueryOptions, enabled: Boolean(did) });
  const [filter, setFilter] = useState<Filter>("all");

  // Read the feed straight off the query data inside the memo so the
  // dependency is the stable react-query array reference, not a fresh
  // `?? []` fallback that changes identity every render.
  const recent = activityQ.data?.recent;
  const filtered = useMemo(
    () => (recent ?? []).filter((ev) => matchesFilter(ev, filter)),
    [recent, filter],
  );

  if (!did) {
    return (
      <Card size="md">
        <CardHeader hasBorder>
          <CardTitle style={styles.cardTitleMono}>Token balance</CardTitle>
        </CardHeader>
        <CardBody>
          <SmallBody>Sign in to view your balance.</SmallBody>
        </CardBody>
      </Card>
    );
  }

  if (balanceQ.isLoading) {
    return (
      <Card size="md">
        <CardHeader hasBorder>
          <CardTitle style={styles.cardTitleMono}>Token balance</CardTitle>
        </CardHeader>
        <CardBody>
          <SmallBody>Loading…</SmallBody>
        </CardBody>
      </Card>
    );
  }

  if (balanceQ.isError || !balanceQ.data) {
    return (
      <Card size="md">
        <CardHeader hasBorder>
          <CardTitle style={styles.cardTitleMono}>Token balance</CardTitle>
        </CardHeader>
        <CardBody>
          <Alert variant="critical" title="Could not load balance">
            <Body>
              {balanceQ.error instanceof Error ? balanceQ.error.message : "Unknown error"}
            </Body>
          </Alert>
        </CardBody>
      </Card>
    );
  }

  const { balance, policy } = balanceQ.data;
  const summary = activityQ.data?.summary;
  const patronageReceived = summary?.byKind.find((k) => k.kind === "patronage-in")?.total ?? 0;

  return (
    <Card size="md">
      <CardHeader hasBorder>
        <CardTitle style={styles.cardTitleMono}>Token balance</CardTitle>
        <CardDescription style={styles.cardDescription}>
          The network refreshes active members weekly and redistributes a monthly patronage rebate
          from the treasury.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <Flex direction="column" gap="2xl">
          <div {...stylex.props(styles.balanceRow)}>
            <Heading2 style={styles.balanceTokens}>{formatNumber(balance)}</Heading2>
            <SmallBody style={styles.balanceUnit}>tokens</SmallBody>
          </div>

          {summary ? (
            <div {...stylex.props(styles.statGrid)}>
              <Stat label="credited (lifetime)" value={summary.totalCredited} tone="credit" />
              <Stat label="debited (lifetime)" value={summary.totalDebited} tone="debit" />
              <Stat label="patronage received" value={patronageReceived} tone="credit" />
            </div>
          ) : null}

          <SmallBody style={styles.policyNote}>
            Onboarding grant: <InlineCode>{formatNumber(policy.tokenGrant)}</InlineCode> tokens
            (issued once). Weekly refresh:{" "}
            <InlineCode>{formatNumber(policy.weeklyRefreshAmount)}</InlineCode> tokens (fires when
            you use the network). Admission floor:{" "}
            <InlineCode>{formatNumber(policy.tokenFloor)}</InlineCode> tokens.
          </SmallBody>

          <Flex direction="column" gap="lg">
            <SegmentedControl
              aria-label="Filter activity"
              size="sm"
              selectedKeys={new Set([filter])}
              onSelectionChange={(selection) => {
                const id = selection.values().next().value;
                if (typeof id === "string") setFilter(id as Filter);
              }}
            >
              {FILTERS.map((f) => (
                <SegmentedControlItem key={f.id} id={f.id}>
                  {f.label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>

            {activityQ.isLoading ? (
              <SmallBody>Loading activity…</SmallBody>
            ) : filtered.length > 0 ? (
              <div {...stylex.props(styles.eventTable)}>
                {filtered.slice(0, 50).map((ev, i) => (
                  <Row key={i} ev={ev} />
                ))}
              </div>
            ) : (recent?.length ?? 0) > 0 ? (
              <SmallBody>No {filter === "all" ? "" : filter} activity in this view.</SmallBody>
            ) : (
              <SmallBody>
                No activity yet. Dispatch a job from the API to see your first receipt-out event.
              </SmallBody>
            )}
          </Flex>
        </Flex>
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "credit" | "debit" }) {
  return (
    <div {...stylex.props(styles.statTile)}>
      <LabelText variant="secondary">{label}</LabelText>
      <span
        {...stylex.props(
          styles.statValue,
          tone === "credit" ? styles.statValueCredit : styles.statValueDebit,
        )}
      >
        {tone === "debit" && value > 0 ? "−" : ""}
        {formatNumber(value)}
      </span>
    </div>
  );
}

function Row({ ev }: { ev: LedgerEvent }) {
  const positive = ev.tokensDelta >= 0;
  const sign = positive ? "+" : "−";
  return (
    <>
      <SmallBody style={styles.eventKind}>{EVENT_LABELS[ev.kind] ?? ev.kind}</SmallBody>
      <SmallBody>{formatRelative(ev.createdAt)}</SmallBody>
      <SmallBody
        style={[styles.eventDelta, positive ? styles.eventDeltaCredit : styles.eventDeltaDebit]}
      >
        {sign}
        {formatNumber(Math.abs(ev.tokensDelta))}
      </SmallBody>
    </>
  );
}
