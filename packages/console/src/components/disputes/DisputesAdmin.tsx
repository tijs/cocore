// Operator-only /admin/disputes dashboard.
//
// Lists rows from the pending_disputes SQLite table populated by
// the charge.dispute.created webhook bridge (PR #53). Each row
// gets a "Resolve…" action that opens a verdict-picker dialog and
// calls the resolveDispute server fn (PR #57's same logic, just
// invoked via TanStack server fn instead of the
// /api/internal/disputes/resolve HTTP endpoint).
//
// Status filtering is intentional: by default we show only the
// rows that need operator attention (`opened` + `no-settlement-match`).
// Toggle the "all" switch to see resolved + exchange-not-onboarded
// rows for audit.

import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  type PendingDisputeRow,
  type ResolveDisputeInput,
  listPendingDisputesQueryOptions,
  resolvePendingDisputeMutationOptions,
} from "@/components/disputes/disputes.functions.ts";
import { Alert } from "@/design-system/alert";
import { Button } from "@/design-system/button";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "@/design-system/dialog";
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
import { TextField } from "@/design-system/text-field";
import { fontFamily } from "@/design-system/theme/typography.stylex";
import { toasts } from "@/design-system/toast";
import { Body, Heading1, InlineCode, SmallBody } from "@/design-system/typography";

const styles = stylex.create({
  root: {
    paddingTop: "2rem",
    paddingBottom: "4rem",
  },
  mono: {
    fontFamily: fontFamily.mono,
  },
  empty: {
    padding: "2rem",
    textAlign: "center",
    opacity: 0.7,
  },
  uri: {
    fontFamily: fontFamily.mono,
    fontSize: "0.8125rem",
    overflowWrap: "anywhere",
  },
});

const COLUMNS = [
  { id: "id", label: "Dispute id" },
  { id: "pi", label: "Payment intent" },
  { id: "reason", label: "Reason" },
  { id: "status", label: "Status" },
  { id: "createdAt", label: "Created" },
  { id: "actions", label: "" },
];

const NEEDS_ATTENTION_STATUSES = new Set(["opened", "no-settlement-match"]);

interface ResolveDraft {
  row: PendingDisputeRow;
  verdict: ResolveDisputeInput["verdict"];
  rationale: string;
  refundAmountMinor: string;
}

function defaultDraft(row: PendingDisputeRow): ResolveDraft {
  return {
    row,
    verdict: "uphold-charge",
    rationale: "",
    refundAmountMinor: "",
  };
}

function shortDispute(id: string): string {
  return id.startsWith("du_") ? id.slice(0, 14) : id;
}

function shortPi(id: string): string {
  return id.startsWith("pi_") ? id.slice(0, 14) : id;
}

function fmtAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function DisputesAdmin() {
  const list = useQuery(listPendingDisputesQueryOptions);
  const resolve = useMutation(resolvePendingDisputeMutationOptions);
  const qc = useQueryClient();

  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<ResolveDraft | null>(null);

  const rows = useMemo<PendingDisputeRow[]>(() => {
    const all = list.data?.rows ?? [];
    if (showAll) return all;
    return all.filter((r) => NEEDS_ATTENTION_STATUSES.has(r.status));
  }, [list.data, showAll]);

  const onResolve = () => {
    if (!draft) return;
    if (!draft.row.disputeUri) {
      toasts.add(
        { title: "this row has no dispute_uri (status no-settlement-match)" },
        { timeout: 3000 },
      );
      return;
    }
    const isRefund = draft.verdict === "refund-full" || draft.verdict === "refund-partial";
    let refundAmountMinor: number | undefined;
    if (isRefund) {
      const n = Number(draft.refundAmountMinor);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        toasts.add(
          { title: `refund verdict requires a positive integer refundAmountMinor` },
          { timeout: 3000 },
        );
        return;
      }
      refundAmountMinor = n;
    }
    resolve.mutate(
      {
        disputeUri: draft.row.disputeUri,
        verdict: draft.verdict,
        ...(draft.rationale.trim() ? { rationale: draft.rationale.trim() } : {}),
        ...(refundAmountMinor !== undefined ? { refundAmountMinor } : {}),
      },
      {
        onSuccess: (r) => {
          toasts.add(
            {
              title: r.refundSettlementUri
                ? `Resolved with refund settlement at ${r.refundSettlementUri}`
                : "Resolved",
            },
            { timeout: 4000 },
          );
          setDraft(null);
          qc.invalidateQueries({ queryKey: listPendingDisputesQueryOptions.queryKey });
        },
        onError: (e) =>
          toasts.add(
            { title: e instanceof Error ? e.message : "resolve failed" },
            { timeout: 5000 },
          ),
      },
    );
  };

  return (
    <Page.Root style={styles.root}>
      <Page.Header>
        <Flex direction="column" gap="md">
          <Heading1>Disputes</Heading1>
          <SmallBody>
            Operator-only audit + resolution surface over <InlineCode>pending_disputes</InlineCode>—
            legacy dispute records kept for review.
          </SmallBody>
        </Flex>
        <Flex direction="row" gap="md" align="center">
          <Button variant="secondary" size="sm" onPress={() => setShowAll((v) => !v)}>
            {showAll ? "Hide resolved" : "Show all"}
          </Button>
        </Flex>
      </Page.Header>

      {list.isError ? (
        <Alert variant="critical" title="Could not load disputes">
          <Body>{list.error instanceof Error ? list.error.message : String(list.error)}</Body>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          <Body>No disputes {showAll ? "on file" : "pending operator review"}.</Body>
        </div>
      ) : (
        <Table aria-label="Pending disputes">
          <TableHeader columns={COLUMNS}>
            {(col) => <TableColumn>{col.label}</TableColumn>}
          </TableHeader>
          <TableBody items={rows}>
            {(row) => (
              <TableRow key={row.stripeDisputeId} columns={COLUMNS}>
                {(col) => {
                  switch (col.id) {
                    case "id":
                      return (
                        <TableCell>
                          <span {...stylex.props(styles.mono)}>
                            {shortDispute(row.stripeDisputeId)}
                          </span>
                        </TableCell>
                      );
                    case "pi":
                      return (
                        <TableCell>
                          <span {...stylex.props(styles.mono)}>{shortPi(row.paymentIntentId)}</span>
                        </TableCell>
                      );
                    case "reason":
                      return <TableCell>{row.stripeReason}</TableCell>;
                    case "status":
                      return <TableCell>{row.status}</TableCell>;
                    case "createdAt":
                      return <TableCell>{fmtAgo(row.createdAt)}</TableCell>;
                    case "actions":
                      return (
                        <TableCell>
                          {row.status === "opened" && row.disputeUri ? (
                            <Button
                              variant="primary"
                              size="sm"
                              onPress={() => setDraft(defaultDraft(row))}
                            >
                              Resolve…
                            </Button>
                          ) : null}
                        </TableCell>
                      );
                    default:
                      return <TableCell>—</TableCell>;
                  }
                }}
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog
        isOpen={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
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
        <DialogHeader>Resolve dispute</DialogHeader>
        <DialogBody>
          <DialogDescription>
            {draft ? (
              <>
                <span {...stylex.props(styles.mono)}>
                  {shortDispute(draft.row.stripeDisputeId)}
                </span>{" "}
                — Stripe reason <InlineCode>{draft.row.stripeReason}</InlineCode>.{" "}
                <span {...stylex.props(styles.uri)}>{draft.row.disputeUri ?? ""}</span>
              </>
            ) : null}
          </DialogDescription>
          {draft ? (
            <Flex direction="column" gap="md">
              <Flex direction="column" gap="sm">
                <SmallBody>Verdict</SmallBody>
                <Flex direction="row" gap="sm">
                  {(
                    ["uphold-charge", "refund-full", "refund-partial", "forfeit-payout"] as const
                  ).map((v) => (
                    <Button
                      key={v}
                      variant={draft.verdict === v ? "primary" : "secondary"}
                      size="sm"
                      onPress={() => setDraft({ ...draft, verdict: v })}
                    >
                      {v}
                    </Button>
                  ))}
                </Flex>
              </Flex>
              {(draft.verdict === "refund-full" || draft.verdict === "refund-partial") && (
                <TextField
                  label="Refund amount (minor units)"
                  value={draft.refundAmountMinor}
                  onChange={(v) => setDraft({ ...draft, refundAmountMinor: v })}
                  placeholder="e.g. 100 = $1.00"
                />
              )}
              <TextField
                label="Rationale (optional, public on the record)"
                value={draft.rationale}
                onChange={(v) => setDraft({ ...draft, rationale: v })}
                placeholder="Operator notes…"
              />
            </Flex>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Flex direction="row" gap="md">
            <Button
              variant="secondary"
              size="sm"
              onPress={() => setDraft(null)}
              isDisabled={resolve.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onPress={onResolve}
              isDisabled={resolve.isPending || !draft?.row.disputeUri}
            >
              {resolve.isPending ? "Resolving…" : "Resolve"}
            </Button>
          </Flex>
        </DialogFooter>
      </Dialog>
    </Page.Root>
  );
}
