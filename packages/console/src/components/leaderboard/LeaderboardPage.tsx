"use client";

import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { Avatar } from "@/design-system/avatar";
import { Alert } from "@/design-system/alert";
import { Card, CardDescription, CardHeader, CardTitle } from "@/design-system/card";
import { Flex } from "@/design-system/flex";
import { Page } from "@/design-system/page/index.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@/design-system/table";
import { uiColor } from "@/design-system/theme/color.stylex";
import { breakpoints } from "@/design-system/theme/media-queries.stylex";
import { verticalSpace, horizontalSpace } from "@/design-system/theme/semantic-spacing.stylex";
import {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
} from "@/design-system/theme/typography.stylex";
import { Heading1, SmallBody } from "@/design-system/typography";
import { Text } from "@/design-system/typography/text";

import {
  leaderboardQueryOptions,
  type LeaderboardRow,
} from "@/components/leaderboard/leaderboard.functions.ts";
import { formatTokens } from "@/lib/token-display.ts";

const COLUMNS: { id: "rank" | "account" | "amount"; name: string; width?: number }[] = [
  { id: "rank", name: "#", width: 64 },
  { id: "account", name: "Account" },
  { id: "amount", name: "Tokens", width: 140 },
];

const styles = stylex.create({
  header: {
    marginBottom: 0,
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
    lineHeight: lineHeight.lg,
    marginTop: verticalSpace.sm,
  },
  cardTitle: {
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
  // Each table scrolls horizontally inside its card rather than
  // pushing the whole page wide on small screens.
  tableWrap: {
    overflowX: "auto",
    width: "100%",
  },
  table: {
    tableLayout: "fixed",
    width: "100%",
  },
  rankColumn: {
    width: 64,
  },
  /** Align `#` with card title inset on flush tables. */
  rankHeaderCell: {
    paddingLeft: horizontalSpace.lg,
  },
  /** Match card md `--card-x-padding` for rank numbers. */
  rankCell: {
    paddingLeft: horizontalSpace["3xl"],
  },
  accountColumn: {
    minWidth: 0,
    width: "100%",
  },
  amountColumn: {
    width: 140,
  },
  card: {
    minWidth: 0,
    width: "100%",
  },
  cardHeaderFlush: {
    marginBottom: 0,
  },
  rank: {
    color: uiColor.text1,
    fontVariantNumeric: "tabular-nums",
  },
  rankTop: {
    color: uiColor.text2,
    fontWeight: fontWeight.medium,
  },
  accountLink: {
    alignItems: "center",
    color: uiColor.text2,
    cursor: "pointer",
    display: "flex",
    gap: "0.625rem",
    minWidth: 0,
    textDecorationLine: {
      default: "none",
      ":hover": "underline",
    },
  },
  accountText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  accountName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  accountHandle: {
    color: uiColor.text1,
    fontSize: fontSize.xs,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  amount: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: fontWeight.medium,
  },
  emptyCell: {
    color: uiColor.text1,
    paddingBottom: "2rem",
    paddingTop: "2rem",
    textAlign: "center",
  },
  grid: {
    display: "grid",
    gap: "1.5rem",
    gridTemplateColumns: {
      default: "1fr",
      [breakpoints.lg]: "repeat(3, minmax(0, 1fr))",
    },
  },
});

function linkIdentifier(row: LeaderboardRow): string {
  const h = row.handle?.trim();
  return h && h.length > 0 ? h : row.did;
}

function accountLabel(row: LeaderboardRow): string {
  return row.displayName?.trim() || row.handle?.trim() || row.did;
}

function LeaderboardTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: LeaderboardRow[];
}): ReactElement {
  const bodyItems =
    rows.length === 0 ? [{ rank: 0, did: "__empty__", amount: 0 } as LeaderboardRow] : rows;
  return (
    <Card size="md" style={styles.card}>
      <CardHeader hasBorder style={styles.cardHeaderFlush}>
        <CardTitle style={styles.cardTitle}>{title}</CardTitle>
        <CardDescription style={styles.cardDescription}>{description}</CardDescription>
      </CardHeader>
      <div {...stylex.props(styles.tableWrap)}>
        <Table aria-label={title} size="sm" style={styles.table}>
          <TableHeader columns={COLUMNS}>
            {(column) => (
              <TableColumn
                isRowHeader={column.id === "account"}
                width={column.id === "account" ? undefined : column.width}
                headerContentStyle={column.id === "rank" ? styles.rankHeaderCell : undefined}
                style={
                  column.id === "rank"
                    ? styles.rankColumn
                    : column.id === "account"
                      ? styles.accountColumn
                      : styles.amountColumn
                }
                hasEllipsis={column.id === "account"}
              >
                {column.name}
              </TableColumn>
            )}
          </TableHeader>
          <TableBody items={bodyItems}>
            {(row) => {
              if (row.did === "__empty__") {
                return (
                  <TableRow columns={[{ id: "empty" }]} id="__empty__">
                    {() => (
                      <TableCell colSpan={3} style={styles.emptyCell}>
                        No activity yet
                      </TableCell>
                    )}
                  </TableRow>
                );
              }
              return (
                <TableRow columns={COLUMNS} id={row.did} textValue={accountLabel(row)}>
                  {(column) => {
                    if (column.id === "rank") {
                      return (
                        <TableCell contentStyle={styles.rankCell}>
                          <span {...stylex.props(styles.rank, row.rank <= 3 && styles.rankTop)}>
                            {row.rank}
                          </span>
                        </TableCell>
                      );
                    }
                    if (column.id === "account") {
                      return (
                        <TableCell hasEllipsis>
                          <RouterLink
                            to="/u/$identifier"
                            params={{ identifier: linkIdentifier(row) }}
                            preload="intent"
                            {...stylex.props(styles.accountLink)}
                          >
                            <Avatar
                              src={row.avatarUrl ?? undefined}
                              size="sm"
                              alt={accountLabel(row)}
                              fallback={(accountLabel(row)[0] ?? "?").toUpperCase()}
                            />
                            <span {...stylex.props(styles.accountText)}>
                              <span {...stylex.props(styles.accountName)}>
                                {row.displayName?.trim() || row.handle?.trim() || "—"}
                              </span>
                              <span {...stylex.props(styles.accountHandle)}>
                                {row.handle?.trim() ? `@${row.handle.trim()}` : row.did}
                              </span>
                            </span>
                          </RouterLink>
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell>
                        <span {...stylex.props(styles.amount)}>{formatTokens(row.amount)}</span>
                      </TableCell>
                    );
                  }}
                </TableRow>
              );
            }}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

export function LeaderboardPage(): ReactElement {
  const query = useQuery(leaderboardQueryOptions({ limit: 20 }));
  const data = query.data;

  return (
    <Page.Root variant="large" style={styles.root}>
      <Page.Header style={styles.header}>
        <Flex direction="column" gap="xl">
          <Heading1 style={styles.headingMono}>
            <span {...stylex.props(styles.titlePrompt)}>~/</span>
            leaderboard
          </Heading1>
          <div {...stylex.props(styles.metaRow)}>
            The biggest wallets, earners, and spenders across the cooperative — ranked from the
            token ledger. Tokens are the unit of account; system accounts (treasury, autoresponder)
            are excluded.
          </div>
        </Flex>
      </Page.Header>

      {query.isError ? (
        <Alert variant="critical" title="Couldn't load the leaderboard">
          <SmallBody>
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </SmallBody>
        </Alert>
      ) : null}

      <div {...stylex.props(styles.grid)}>
        <LeaderboardTable
          title="Largest wallets"
          description="current token balance"
          rows={data?.topBalances ?? []}
        />
        <LeaderboardTable
          title="Top earners"
          description="tokens earned serving compute"
          rows={data?.topEarners ?? []}
        />
        <LeaderboardTable
          title="Top spenders"
          description="tokens spent requesting compute"
          rows={data?.topSpenders ?? []}
        />
      </div>

      {data ? (
        <Text size="xs" variant="secondary">
          updated {new Date(data.generatedAt).toLocaleString()}
        </Text>
      ) : null}
    </Page.Root>
  );
}
