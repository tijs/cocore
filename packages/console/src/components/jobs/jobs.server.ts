import type { AppviewIndexedRecord } from "@/integrations/appview/appview.server.ts";
import { parseTimeMs, type RequesterJobRow } from "@/components/jobs/jobs.shared.ts";
import type { JobRecord, ReceiptRecord } from "@cocore/sdk/types";

function bestReceiptByJobUri(
  receiptRows: AppviewIndexedRecord[],
): Map<string, AppviewIndexedRecord> {
  const m = new Map<string, AppviewIndexedRecord>();
  for (const row of receiptRows) {
    const body = row.body as unknown as ReceiptRecord;
    const jobUri = body.job?.uri;
    if (!jobUri) continue;
    const prev = m.get(jobUri);
    if (!prev) {
      m.set(jobUri, row);
      continue;
    }
    const prevBody = prev.body as unknown as ReceiptRecord;
    const curDone = parseTimeMs(body.completedAt);
    const prevDone = parseTimeMs(prevBody.completedAt);
    if (curDone != null && prevDone != null && curDone > prevDone) {
      m.set(jobUri, row);
    } else if (curDone != null && prevDone == null) {
      m.set(jobUri, row);
    }
  }
  return m;
}

function asJobRecord(body: unknown): JobRecord | null {
  if (!body || typeof body !== "object") return null;
  const j = body as JobRecord;
  if (
    typeof j.model !== "string" ||
    typeof j.createdAt !== "string" ||
    typeof j.expiresAt !== "string" ||
    typeof j.inputCommitment !== "string"
  ) {
    return null;
  }
  const pc = j.priceCeiling;
  if (
    !pc ||
    typeof pc.amount !== "number" ||
    !Number.isFinite(pc.amount) ||
    typeof pc.currency !== "string"
  ) {
    return null;
  }
  return j;
}

export function buildRequesterJobRows(
  jobRows: AppviewIndexedRecord[],
  receiptRows: AppviewIndexedRecord[],
  nowMs: number,
): RequesterJobRow[] {
  const byJob = bestReceiptByJobUri(receiptRows);
  const out: RequesterJobRow[] = [];
  for (const jr of jobRows) {
    const job = asJobRecord(jr.body);
    if (!job) continue;
    const rec = byJob.get(jr.uri);
    const recBody = rec ? (rec.body as unknown as ReceiptRecord) : null;
    const completed = !!recBody;
    const expMs = parseTimeMs(job.expiresAt);
    const expired = !completed && expMs != null && expMs < nowMs;
    const status: RequesterJobRow["status"] = completed
      ? "completed"
      : expired
        ? "expired"
        : "pending";
    out.push({
      jobUri: jr.uri,
      jobRkey: jr.rkey,
      model: job.model,
      inputCommitmentShort: job.inputCommitment.slice(0, 8),
      createdAt: job.createdAt,
      expiresAt: job.expiresAt,
      priceCeiling: job.priceCeiling,
      status,
      providerDid: rec ? rec.repo : null,
      // Resolved to a handle by the jobs server fn after this pure transform.
      providerHandle: null,
      providerDisplayName: null,
      receiptUri: rec?.uri ?? null,
      startedAt: recBody?.startedAt ?? null,
      completedAt: recBody?.completedAt ?? null,
      charged: recBody?.price ?? null,
      tokensIn: recBody?.tokens?.in ?? null,
      tokensOut: recBody?.tokens?.out ?? null,
    });
  }
  return out;
}
