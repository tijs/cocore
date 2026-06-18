# Launch-day ledger runbook

Operational guide for keeping the cocore token ledger consistent at
launch and beyond. Everything below is a curl-pipe-jq one-liner an
operator can run from any shell.

## Setup

Both endpoints below need `COCORE_INTERNAL_API_KEY` and live on the
services container.

```bash
export COCORE_INTERNAL_API_KEY="<the production key on Railway>"
export SERVICES="https://services.cocore.dev"
```

## Reconciliation — every-N-minutes check

The single most important operation: a structured audit of the
ledger.

```bash
curl -sS -H "Authorization: Bearer $COCORE_INTERNAL_API_KEY" \
  "$SERVICES/xrpc/dev.cocore.admin.reconcile" | jq '.report.ok'
```

Returns `true` when every invariant holds:

1. **Conservation.** `sum(token_event.tokens_delta) ==
   sum(grant + refresh deltas)`. Receipts and patronage net to zero
   across participants; only mints add to the total.
2. **Per-DID cache integrity.** Every `token_balance.tokens` equals
   `SUM(token_event.tokens_delta)` for that DID. If a write was
   dropped or a cache was stomped, the drift surfaces here.
3. **Non-negative balances.** The CHECK constraint should never let
   us see negatives; this is a belt-and-suspenders check.
4. **Idempotency table sizes.** `processed_receipt` and
   `processed_period` row counts — sanity number.
5. **System total.** `SUM(token_balance.tokens) == totalMints`.

On `false`, the report includes a `balanceCacheDrifts` array
pointing at the exact DIDs and the magnitude of the drift.

## Reconciliation — repair drift

```bash
curl -sS -X POST -H "Authorization: Bearer $COCORE_INTERNAL_API_KEY" \
  "$SERVICES/xrpc/dev.cocore.admin.reconcile" | jq '.'
```

POST does the same audit AND rebuilds the `token_balance.tokens`
cache from the audit log (canonical) when drift is detected. The
response includes a `rebuilt: { changed: N }` block when a rebuild
ran. A follow-up reconcile inside the same response confirms the
fix.

When does drift happen?

- A pre-fix bug in `applyReceipt` left snapshot-and-overwrite
  collisions on self-loop receipts. Fixed in #114. The drift on
  receipts dispatched *before* #114 deployed is recoverable with
  this POST.
- A process crash mid-transaction is *not* a drift source — every
  balance-changing operation runs inside a single sqlite txn that
  either fully commits or fully rolls back.

## Per-DID balance check

```bash
curl -sS "$SERVICES/xrpc/dev.cocore.exchange.getBalance?did=did:plc:..." | jq '.'
```

Returns the balance + the active policy. Use this to verify a
specific user's grant landed, refresh fired, or after a manual
fix.

## Per-DID event log

```bash
curl -sS "$SERVICES/xrpc/dev.cocore.exchange.listEvents?did=did:plc:...&limit=100" | jq '.events[]'
```

Returns the full audit trail for one DID, ordered oldest-first.
Every balance-changing operation lands here. `tokensDelta` sums to
the current balance.

## Patronage distribution

The monthly rebate runs automatically via the scheduler in
`services/main.ts`. To trigger it manually (out-of-cycle):

```bash
curl -sS -X POST -H "Authorization: Bearer $COCORE_INTERNAL_API_KEY" \
  "$SERVICES/xrpc/dev.cocore.exchange.distributePatronage" \
  -H "Content-Type: application/json" \
  -d '{"start":"2026-05-01T00:00:00Z","end":"2026-06-01T00:00:00Z"}'
```

Idempotent on the `(start, end)` window — running it twice for the
same period is a no-op.

## Concurrency notes

- The services container is single-process, single-Node. All ledger
  ops happen synchronously (better-sqlite3 is sync).
  Two parallel HTTP requests serialize at the JS event-loop level.
- Every balance-changing operation runs inside
  `db.transaction(...)`. A crash mid-txn rolls the txn back; the
  audit log can't drift.
- Multiple `services` containers running against the same SQLite
  file would corrupt — never do this. Railway runs exactly one
  instance.

## What to do if `reconcile` returns `ok: false` and you don't trust the repair

1. Snapshot the ledger DB:
   ```bash
   railway run --service services 'cp /data/token-ledger.sqlite /data/token-ledger.sqlite.bak'
   ```
2. Pull a copy locally for forensic inspection (DM ops for help).
3. The audit log is canonical. Even if the cache is wrong, we can
   reconstruct every balance from `token_event`.

## Wipe (nuclear option)

```bash
curl -sS -X POST -H "Authorization: Bearer $COCORE_INTERNAL_API_KEY" \
  "$SERVICES/xrpc/dev.cocore.admin.wipe"
```

Requires `COCORE_ALLOW_WIPE=1` on the services container. Drops
every row from `token_balance`, `token_event`, `processed_receipt`,
`processed_period`. Use only for a deliberate cutover.
