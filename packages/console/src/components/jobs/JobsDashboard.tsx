"use client";

import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { ReactElement } from "react";

import { getMyBalanceQueryOptions } from "@/components/account/token-balance.functions.ts";
import { CreateApiKeyButton } from "@/components/api-keys/CreateApiKeyButton.tsx";
import { listMyJobsQueryOptions } from "@/components/jobs/jobs.functions.ts";
import {
  emptyJobsRangeStats,
  filterRowsByRange,
  minorToMajorUsd,
  sortRequesterJobRowsForTable,
  type JobsTableSortKey,
  statsForVisibleRows,
  type JobsTimeRange,
  type RequesterJobRow,
} from "@/components/jobs/jobs.shared.ts";
import { formatTokens, usdMajorToTokens } from "@/lib/token-display.ts";
import { Alert } from "@/design-system/alert";
import { Badge } from "@/design-system/badge";
import { Button } from "@/design-system/button";
import { Card, CardBody } from "@/design-system/card";
import { CopyToClipboardButton } from "@/design-system/copy-to-clipboard-button";
import { EmptyState, EmptyStateTitle } from "@/design-system/empty-state";
import { Flex } from "@/design-system/flex";
import { Page } from "@/design-system/page/index.tsx";
import { SegmentedControl, SegmentedControlItem } from "@/design-system/segmented-control";
import { uiColor } from "@/design-system/theme/color.stylex";
import { breakpoints } from "@/design-system/theme/media-queries.stylex";
import { ui } from "@/design-system/theme/semantic-color.stylex";
import { gap, horizontalSpace, verticalSpace } from "@/design-system/theme/semantic-spacing.stylex";
import {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
} from "@/design-system/theme/typography.stylex";
import { Body, Heading1, InlineCode, LabelText, SmallBody } from "@/design-system/typography";
import { Text } from "@/design-system/typography/text";

const styles = stylex.create({
  header: {
    marginBottom: 0,
  },
  root: {
    display: "flex",
    flexDirection: "column",
    gap: verticalSpace["2xl"],
    fontFamily: fontFamily.mono,
    maxWidth: "1600px",
    marginLeft: "auto",
    marginRight: "auto",
  },
  titlePrompt: {
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  headingMono: {
    fontFamily: fontFamily.mono,
  },
  metaRow: {
    color: uiColor.text1,
    fontSize: fontSize.sm,
    gap: horizontalSpace.lg,
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    marginTop: verticalSpace.sm,
    lineHeight: lineHeight["lg"],
  },
  metaSep: {
    color: uiColor.border2,
  },
  statsGrid: {
    display: "grid",
    gap: gap["2xl"],
    gridTemplateColumns: {
      default: "1fr",
      [breakpoints.sm]: "repeat(2, 1fr)",
      [breakpoints.lg]: "repeat(4, 1fr)",
    },
  },
  statCard: {
    position: "relative",
  },
  statLabel: {
    fontSize: fontSize.xs,
    letterSpacing: "0.04em",
    textTransform: "lowercase",
  },
  statValue: {
    fontSize: fontSize["3xl"],
    fontVariantNumeric: "tabular-nums",
    fontWeight: fontWeight.medium,
    letterSpacing: "-0.02em",
    marginTop: verticalSpace.sm,
  },
  statFrac: {
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  statDelta: {
    color: uiColor.text1,
    fontSize: fontSize.xs,
    fontVariantNumeric: "tabular-nums",
    marginTop: verticalSpace.xs,
  },
  panel: {
    backgroundColor: uiColor.bg,
    borderColor: uiColor.border1,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    overflow: "hidden",
  },
  rangeBar: {
    alignItems: "center",
    borderBottomColor: uiColor.border1,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexWrap: "wrap",
    gap: horizontalSpace.lg,
    justifyContent: "space-between",
    paddingBlock: verticalSpace.md,
    paddingInline: horizontalSpace.lg,
  },
  tableWrap: {
    overflowX: "auto",
    width: "100%",
  },
  table: {
    backgroundColor: uiColor.bg,
    borderCollapse: "collapse",
    width: "100%",
    fontSize: fontSize.sm,
  },
  th: {
    borderBottomColor: uiColor.border1,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    color: uiColor.text1,
    fontWeight: fontWeight.medium,
    paddingBlock: verticalSpace.sm,
    paddingInline: horizontalSpace.md,
    textAlign: "left",
    textTransform: "lowercase",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottomColor: uiColor.border1,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    color: uiColor.text2,
    paddingBlock: verticalSpace.md,
    paddingInline: horizontalSpace.md,
    verticalAlign: "middle",
  },
  tdNum: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  rowClick: {
    cursor: "pointer",
  },
  rowExpanded: {
    backgroundColor: uiColor.bgSubtle,
  },
  detailCell: {
    backgroundColor: uiColor.bgSubtle,
    borderBottomColor: uiColor.border1,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    paddingBlock: verticalSpace.lg,
    // Tighter inline padding on narrow screens so long URIs have room to
    // wrap within the cell instead of forcing horizontal scroll.
    paddingInline: {
      default: horizontalSpace.lg,
      [breakpoints.sm]: horizontalSpace["2xl"],
    },
  },
  kvGrid: {
    columnGap: horizontalSpace.lg,
    display: "grid",
    fontSize: fontSize.sm,
    // Stack label above value on narrow screens; two-column from sm up.
    // `minmax(0, 1fr)` lets the value column shrink below its content
    // width so long URIs wrap instead of forcing horizontal scroll.
    gridTemplateColumns: {
      default: "1fr",
      [breakpoints.sm]: "120px minmax(0, 1fr)",
    },
    rowGap: {
      default: verticalSpace.sm,
      [breakpoints.sm]: verticalSpace.xs,
    },
    // maxWidth: "720px",
  },
  kvDt: {
    color: uiColor.text1,
  },
  kvDd: {
    color: uiColor.text2,
    margin: 0,
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  jobTitle: {
    color: uiColor.text2,
    fontWeight: fontWeight.medium,
  },
  jobSub: {
    color: uiColor.text1,
    fontSize: fontSize.xs,
    marginTop: verticalSpace.xs,
  },
  // Provider cell as a profile link (who ran the job). Muted to match the
  // table; brightens + underlines on hover.
  providerLink: {
    color: {
      default: uiColor.text2,
      ":hover": uiColor.text2,
    },
    fontSize: fontSize.sm,
    textDecorationLine: {
      default: "none",
      ":hover": "underline",
    },
  },
  metaRowDim: {
    color: uiColor.text1,
    fontSize: fontSize.sm,
  },
  detailLabel: {
    marginBottom: verticalSpace.sm,
  },
  uriBreak: {
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  uriValueRow: {
    // Let the code element shrink/wrap within the value column instead of
    // pushing the row wider than the available width.
    minWidth: 0,
  },
  copyAffordance: {
    flexShrink: 0,
  },
  thSortable: {
    cursor: "pointer",
    userSelect: "none",
  },
  sortControl: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    gap: horizontalSpace.xs,
    margin: 0,
    padding: 0,
    textTransform: "inherit",
    whiteSpace: "nowrap",
  },
  tdCreated: {
    color: uiColor.text1,
    fontSize: fontSize.xs,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  tdStatus: {
    whiteSpace: "nowrap",
    width: "1%",
  },
});

export function JobsDashboard(): ReactElement {
  const query = useQuery(listMyJobsQueryOptions);
  const balanceQ = useQuery(getMyBalanceQueryOptions);
  const tokenRate = balanceQ.data?.policy.averagePricePerMTok ?? 0;
  const row = query.data;
  const [range, setRange] = useState<JobsTimeRange>("30d");

  const allRows = row?.rows ?? [];
  const visible = filterRowsByRange(allRows, range, Date.now());

  const rangeStats = useMemo(() => statsForVisibleRows(visible), [visible]);
  const lifetimeStats = row?.lifetimeStats ?? emptyJobsRangeStats;
  const lifetimeCount = allRows.length;
  const hasAnyIndexedJobs = lifetimeCount > 0;
  const rangeEmptyButHasJobsElsewhere = hasAnyIndexedJobs && visible.length === 0;

  const terminal = rangeStats.completed + rangeStats.expired;
  const successPctStr = terminal > 0 ? ((rangeStats.completed / terminal) * 100).toFixed(1) : "0";

  const fetchedAtLabel =
    row != null && Number.isFinite(new Date(row.fetchedAt).getTime())
      ? `${new Date(row.fetchedAt).toLocaleString("en", { timeZone: "UTC" })} UTC`
      : null;

  return (
    <Page.Root style={styles.root}>
      {row != null && (row.jobsFetchError || row.receiptsFetchError) && (
        <Alert variant="warning">
          {[
            row.jobsFetchError ? `indexed jobs · ${row.jobsFetchError}` : null,
            row.receiptsFetchError ? `receipts · ${row.receiptsFetchError}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Alert>
      )}

      <Page.Header style={styles.header}>
        <Flex direction="column" gap="xl">
          <Heading1 style={styles.headingMono}>
            <span {...stylex.props(styles.titlePrompt)}>~/</span>jobs
          </Heading1>
          {query.isPending ? (
            <SmallBody style={styles.metaRowDim}>Loading indexed jobs…</SmallBody>
          ) : row != null ? (
            <div {...stylex.props(styles.metaRow)}>
              <span>
                <strong {...stylex.props(ui.text)}>{lifetimeCount}</strong> indexed in AppView
              </span>
              <span {...stylex.props(styles.metaSep)} aria-hidden="true">
                ·
              </span>
              <span>
                <strong {...stylex.props(ui.text)}>
                  {formatTokens(lifetimeStats.spendTokens)}
                </strong>{" "}
                tokens lifetime spend
              </span>
              <span {...stylex.props(styles.metaSep)} aria-hidden="true">
                ·
              </span>
              <span>
                <strong {...stylex.props(ui.text)}>{lifetimeStats.completed}</strong> completed
              </span>
              <span {...stylex.props(styles.metaSep)} aria-hidden="true">
                ·
              </span>
              <span>
                <strong {...stylex.props(ui.text)}>{lifetimeStats.pending}</strong> in progress
                {fetchedAtLabel ? (
                  <>
                    <span {...stylex.props(styles.metaSep)} aria-hidden="true">
                      ·
                    </span>
                    fetched {fetchedAtLabel}
                  </>
                ) : null}
              </span>
            </div>
          ) : (
            <SmallBody style={styles.metaRowDim}>Sign in to view jobs.</SmallBody>
          )}
        </Flex>
        <Flex direction="row" gap="md" align="center">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={row == null || visible.length === 0}
            onPress={() => {
              if (row != null) downloadJobsCsv(visible, row.did, row.fetchedAt, range);
            }}
          >
            Export CSV
          </Button>
          <CreateApiKeyButton />
        </Flex>
      </Page.Header>

      {row == null && query.isPending ? (
        <Body style={ui.textDim}>Fetching jobs…</Body>
      ) : row == null ? (
        <Body style={ui.textDim}>Sign in to view jobs.</Body>
      ) : (
        <>
          <div {...stylex.props(styles.statsGrid)}>
            <Card size="md" style={styles.statCard}>
              <CardBody>
                <Text weight="light" variant="secondary" style={styles.statLabel}>
                  Completed · {rangeLabelShort(range)}
                </Text>
                <div {...stylex.props(styles.statValue)}>{rangeStats.completed || 0}</div>
                <div {...stylex.props(styles.statDelta)}>
                  {rangeStats.pending} in progress · {rangeStats.expired} expired (no receipt)
                </div>
              </CardBody>
            </Card>
            <Card size="md" style={styles.statCard}>
              <CardBody>
                <Text weight="light" variant="secondary" style={styles.statLabel}>
                  Spend · {rangeLabelShort(range)}
                </Text>
                <div {...stylex.props(styles.statValue)}>
                  {formatTokens(rangeStats.spendTokens)}
                  <span {...stylex.props(styles.statFrac)}> tokens</span>
                </div>
                <div {...stylex.props(styles.statDelta)}>From indexed receipts only</div>
              </CardBody>
            </Card>
            <Card size="md" style={styles.statCard}>
              <CardBody>
                <Text weight="light" variant="secondary" style={styles.statLabel}>
                  In progress
                </Text>
                <div {...stylex.props(styles.statValue)}>{rangeStats.pending}</div>
                <div {...stylex.props(styles.statDelta)}>awaiting indexed receipt</div>
              </CardBody>
            </Card>
            <Card size="md" style={styles.statCard}>
              <CardBody>
                <Text weight="light" variant="secondary" style={styles.statLabel}>
                  Success · {rangeLabelShort(range)}
                </Text>
                <div {...stylex.props(styles.statValue)}>
                  {successPctStr}
                  <span {...stylex.props(styles.statFrac)}>%</span>
                </div>
                <div {...stylex.props(styles.statDelta)}>
                  {terminal > 0
                    ? "completed / (completed + expired) in range"
                    : "no completed or expired jobs in this range"}
                </div>
              </CardBody>
            </Card>
          </div>

          <div {...stylex.props(styles.panel)}>
            <div {...stylex.props(styles.rangeBar)}>
              <SegmentedControl
                aria-label="Jobs time range"
                size="sm"
                selectedKeys={new Set<JobsTimeRange>([range])}
                onSelectionChange={(keys) => {
                  const id = keys.values().next().value;
                  if (id === "today" || id === "7d" || id === "30d" || id === "all") {
                    setRange(id);
                  }
                }}
              >
                <SegmentedControlItem id="today">today</SegmentedControlItem>
                <SegmentedControlItem id="7d">7d</SegmentedControlItem>
                <SegmentedControlItem id="30d">30d</SegmentedControlItem>
                <SegmentedControlItem id="all">all</SegmentedControlItem>
              </SegmentedControl>
              <SmallBody style={styles.metaRowDim}>
                {visible.length} job{visible.length === 1 ? "" : "s"} · spend{" "}
                {formatTokens(rangeStats.spendTokens)} tokens
              </SmallBody>
            </div>

            {visible.length === 0 ? (
              <EmptyState>
                <EmptyStateTitle>
                  {!hasAnyIndexedJobs
                    ? "No jobs yet"
                    : rangeEmptyButHasJobsElsewhere
                      ? "No jobs in this time range"
                      : "No rows in this view"}
                </EmptyStateTitle>
              </EmptyState>
            ) : (
              <JobsTable rows={visible} tokenRate={tokenRate} />
            )}
          </div>
        </>
      )}
    </Page.Root>
  );
}

function rangeLabelShort(r: JobsTimeRange): string {
  if (r === "today") return "today";
  if (r === "7d") return "7d";
  if (r === "30d") return "30d";
  return "all time";
}

function fmtPriceTokens(amount: number, currency: string, tokenRate: number): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  const major = minorToMajorUsd(amount, currency);
  if (!Number.isFinite(major)) return "—";
  const c = currency.toUpperCase();
  // Non-USD/EUR/GBP receipts skip the conversion table — fall back
  // to the raw lexicon amount + currency tag rather than coerce.
  if (c !== "USD" && c !== "EUR" && c !== "GBP") {
    return `${major} ${currency}`;
  }
  return `${formatTokens(usdMajorToTokens(major, tokenRate))} tk`;
}

function formatDuration(started: string | null, completed: string | null): string {
  if (!started || !completed) return "—";
  const ms = Date.parse(completed) - Date.parse(started);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 120) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  if (min < 120) return `${min}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

function formatCreatedCell(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return `${new Date(t).toLocaleString("en-GB", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} UTC`;
}

function abbrevDid(did: string): string {
  const t = did.trim();
  if (t.length <= 28) return t;
  return `${t.slice(0, 16)}…${t.slice(-8)}`;
}

function csvEscape(cell: string): string {
  return `"${cell.replace(/"/g, '""')}"`;
}

function downloadJobsCsv(
  rows: RequesterJobRow[],
  did: string,
  fetchedAt: string,
  range: JobsTimeRange,
): void {
  const lines: string[] = [];
  lines.push(
    [
      "job_uri",
      "rkey",
      "model",
      "status",
      "provider_did",
      "receipt_uri",
      "created_at",
      "expires_at",
      "started_at",
      "completed_at",
      "charged_amount_minor",
      "charged_currency",
      "ceiling_amount_minor",
      "ceiling_currency",
      "tokens_in",
      "tokens_out",
    ].join(","),
  );
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.jobUri),
        csvEscape(r.jobRkey),
        csvEscape(r.model),
        csvEscape(r.status),
        csvEscape(r.providerDid ?? ""),
        csvEscape(r.receiptUri ?? ""),
        csvEscape(r.createdAt),
        csvEscape(r.expiresAt),
        csvEscape(r.startedAt ?? ""),
        csvEscape(r.completedAt ?? ""),
        csvEscape(r.charged ? String(r.charged.amount) : ""),
        csvEscape(r.charged?.currency ?? ""),
        csvEscape(String(r.priceCeiling.amount)),
        csvEscape(r.priceCeiling.currency),
        csvEscape(r.tokensIn != null ? String(r.tokensIn) : ""),
        csvEscape(r.tokensOut != null ? String(r.tokensOut) : ""),
      ].join(","),
    );
  }
  lines.push([csvEscape("meta"), csvEscape("did"), csvEscape(did)].join(","));
  lines.push([csvEscape("meta"), csvEscape("fetchedAt"), csvEscape(fetchedAt)].join(","));
  lines.push([csvEscape("meta"), csvEscape("range"), csvEscape(range)].join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cocore-jobs-${range}-${(fetchedAt || "export").slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function statusBadge(status: RequesterJobRow["status"]): ReactElement {
  if (status === "completed") {
    return (
      <Badge variant="success" size="sm">
        completed
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="warning" size="sm">
        pending
      </Badge>
    );
  }
  return (
    <Badge variant="critical" size="sm">
      expired
    </Badge>
  );
}

function jobsSortAriaLabel(key: JobsTableSortKey, dir: "asc" | "desc"): string {
  if (key === "created") {
    return dir === "desc"
      ? "Created: newest first. Activate to sort oldest first."
      : "Created: oldest first. Activate to sort newest first.";
  }
  if (key === "duration") {
    return dir === "desc"
      ? "Duration: longest first. Activate to sort shortest first."
      : "Duration: shortest first. Activate to sort longest first.";
  }
  return dir === "desc"
    ? "Price: high to low. Activate to sort low to high."
    : "Price: low to high. Activate to sort high to low.";
}

function jobsSortButtonAriaLabel(
  key: JobsTableSortKey,
  active: boolean,
  dir: "asc" | "desc",
): string {
  if (!active) {
    if (key === "created") return "Sort by created, newest first.";
    if (key === "duration") return "Sort by duration, longest first.";
    return "Sort by price, high to low within each currency.";
  }
  return jobsSortAriaLabel(key, dir);
}

function JobsTableSortHeader({
  label,
  columnKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  columnKey: JobsTableSortKey;
  activeKey: JobsTableSortKey;
  dir: "asc" | "desc";
  onSort: (k: JobsTableSortKey) => void;
}): ReactElement {
  const active = activeKey === columnKey;
  return (
    <th
      {...stylex.props(styles.th, styles.thSortable, columnKey === "price" && styles.tdNum)}
      aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : undefined}
    >
      <button
        type="button"
        {...stylex.props(styles.sortControl)}
        aria-label={jobsSortButtonAriaLabel(columnKey, active, dir)}
        onClick={(e) => {
          e.stopPropagation();
          onSort(columnKey);
        }}
      >
        {label}
        {active ? (
          dir === "desc" ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronUp size={14} aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}

function JobsTable({
  rows,
  tokenRate,
}: {
  rows: RequesterJobRow[];
  tokenRate: number;
}): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: JobsTableSortKey; dir: "asc" | "desc" }>({
    key: "created",
    dir: "desc",
  });

  const sortedRows = useMemo(
    () => sortRequesterJobRowsForTable(rows, sort.key, sort.dir),
    [rows, sort.key, sort.dir],
  );

  const onSortHeader = (key: JobsTableSortKey) => {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" },
    );
  };

  return (
    <div {...stylex.props(styles.tableWrap)}>
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            <th {...stylex.props(styles.th)}>job</th>
            <JobsTableSortHeader
              label="created"
              columnKey="created"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSortHeader}
            />
            <th {...stylex.props(styles.th)}>provider</th>
            <JobsTableSortHeader
              label="duration"
              columnKey="duration"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSortHeader}
            />
            <th {...stylex.props(styles.th, styles.tdStatus)}>status</th>
            <JobsTableSortHeader
              label="price"
              columnKey="price"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSortHeader}
            />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => {
            const isOpen = expanded === r.jobUri;
            return (
              <Fragment key={r.jobUri}>
                <tr
                  {...stylex.props(styles.rowClick, isOpen && styles.rowExpanded)}
                  onClick={() => setExpanded(isOpen ? null : r.jobUri)}
                >
                  <td {...stylex.props(styles.td)}>
                    <Flex direction="row" gap="sm" align="center">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <div>
                        <div {...stylex.props(styles.jobTitle)}>{r.model}</div>
                        <div {...stylex.props(styles.jobSub)}>
                          <InlineCode>{r.jobRkey}</InlineCode> · {r.inputCommitmentShort}…
                        </div>
                      </div>
                    </Flex>
                  </td>
                  <td {...stylex.props(styles.td, styles.tdCreated)}>
                    {formatCreatedCell(r.createdAt)}
                  </td>
                  <td {...stylex.props(styles.td)}>
                    {r.providerDid ? (
                      <RouterLink
                        to="/u/$identifier"
                        params={{ identifier: r.providerHandle ?? r.providerDid }}
                        {...stylex.props(styles.providerLink)}
                        title={r.providerDisplayName ?? r.providerHandle ?? r.providerDid}
                        // The row toggles its detail panel on click; let the
                        // profile link navigate instead of expanding.
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.providerHandle ? (
                          `@${r.providerHandle}`
                        ) : (
                          <InlineCode>{abbrevDid(r.providerDid)}</InlineCode>
                        )}
                      </RouterLink>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td {...stylex.props(styles.td)}>{formatDuration(r.startedAt, r.completedAt)}</td>
                  <td {...stylex.props(styles.td, styles.tdStatus)}>{statusBadge(r.status)}</td>
                  <td {...stylex.props(styles.td, styles.tdNum)}>
                    {r.charged
                      ? fmtPriceTokens(r.charged.amount, r.charged.currency, tokenRate)
                      : fmtPriceTokens(r.priceCeiling.amount, r.priceCeiling.currency, tokenRate)}
                    {!r.charged ? <div {...stylex.props(styles.jobSub)}>ceiling</div> : null}
                  </td>
                </tr>
                {isOpen ? (
                  <tr>
                    <td colSpan={6} {...stylex.props(styles.detailCell)}>
                      <LabelText variant="secondary" style={styles.detailLabel}>
                        Details
                      </LabelText>
                      <dl {...stylex.props(styles.kvGrid)}>
                        <dt {...stylex.props(styles.kvDt)}>job uri</dt>
                        <dd {...stylex.props(styles.kvDd)}>
                          <Flex direction="row" gap="sm" align="center" style={styles.uriValueRow}>
                            <InlineCode style={styles.uriBreak}>{r.jobUri}</InlineCode>
                            <CopyToClipboardButton
                              text={r.jobUri}
                              size="sm"
                              style={styles.copyAffordance}
                            />
                          </Flex>
                        </dd>
                        {r.receiptUri ? (
                          <>
                            <dt {...stylex.props(styles.kvDt)}>receipt</dt>
                            <dd {...stylex.props(styles.kvDd)}>
                              <Flex
                                direction="row"
                                gap="sm"
                                align="center"
                                style={styles.uriValueRow}
                              >
                                <InlineCode style={styles.uriBreak}>{r.receiptUri}</InlineCode>
                                <CopyToClipboardButton
                                  text={r.receiptUri}
                                  size="sm"
                                  style={styles.copyAffordance}
                                />
                              </Flex>
                            </dd>
                          </>
                        ) : null}
                        <dt {...stylex.props(styles.kvDt)}>created</dt>
                        <dd {...stylex.props(styles.kvDd)}>{r.createdAt}</dd>
                        <dt {...stylex.props(styles.kvDt)}>expires</dt>
                        <dd {...stylex.props(styles.kvDd)}>{r.expiresAt}</dd>
                        {r.startedAt ? (
                          <>
                            <dt {...stylex.props(styles.kvDt)}>started</dt>
                            <dd {...stylex.props(styles.kvDd)}>{r.startedAt}</dd>
                          </>
                        ) : null}
                        {r.completedAt ? (
                          <>
                            <dt {...stylex.props(styles.kvDt)}>completed</dt>
                            <dd {...stylex.props(styles.kvDd)}>{r.completedAt}</dd>
                          </>
                        ) : null}
                        {r.tokensIn != null && r.tokensOut != null ? (
                          <>
                            <dt {...stylex.props(styles.kvDt)}>i/o tokens</dt>
                            <dd {...stylex.props(styles.kvDd)}>
                              {r.tokensIn} in · {r.tokensOut} out
                            </dd>
                          </>
                        ) : null}
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
