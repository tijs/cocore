# ADR 0001 — Making the central `services` resilient

Status: accepted (phased). Last updated 2026-06-15.

## Why this exists

`services` is the only always-on, cooperative-wide component. If it stops
serving, the console can't read anything (XRPC timeouts), settlement stalls,
and the network looks dead — even though every provider's PDS still holds the
source of truth. We had two outages in one day from this single component:

- A transient npm blip during the boot-time install failed a deploy.
- The `aube deploy` Dockerfile "fix" crash-looped on a lockfile-parse error;
  the AppView never bound `:8081`, so every XRPC timed out. It reached prod
  because nothing gates a non-serving deploy and CI never boots the image.

"We can't be down when we announce to the world" is the bar. This ADR is the
plan to hit it.

## What `services` is today (the risk)

One Node process (`infra/services/src/main.ts`) runs **all** of:

- AppView **read API** (`:8081`) — what the console calls; the hot path.
- **Exchange** + settlement reconcile loop (writer).
- **Bridge** (`:8080`) — publish/admin + `/healthz`.
- **Indexer** + relay firehose consumer (writer).

State is **SQLite** — `appview.db` (a *cache*, rebuildable from the firehose
per the core invariants) and `token-ledger.sqlite` (derived from settlement
records, which are authoritative on the exchange's PDS). Both live on **one
Railway volume**, single replica.

Failure modes that follow from that shape:

1. **No deploy gate** — a non-serving deploy replaces a healthy one.
2. **Single process** — an unhandled error in *any* subsystem kills the read
   API for everyone.
3. **Single replica + single-writer SQLite-on-a-volume** — can't run >1
   instance, so any restart (or volume hiccup) is a full read outage.
4. **No external monitoring** — we learned of the outage from a user.

## Decision — phased hardening

### Phase 1 — stop bad deploys (shipped)

- **Health-gated deploys.** `/healthz` now answers on **both** ports (bridge
  `:8080` and appview `:8081`); `infra/services/railway.json` sets
  `healthcheckPath=/healthz` + `restartPolicyType=ON_FAILURE`. A deploy that
  never binds its port never goes live, and Railway holds the prior one.
  (Enable the healthcheck **after** the both-ports `/healthz` deploy is live,
  so the probe never fails a healthy deploy that lacks it.)
- **CI container smoke test.** CI now `docker build`s the services image,
  **boots it**, and probes `/healthz` — catching build-fine/crash-at-startup
  deploys (the `aube deploy` failure mode) before merge.
- **Preview-deploy discipline.** Any `infra/` or Dockerfile change goes
  through a Railway preview deploy before `main`. No exceptions — both
  outages would have been caught here.

### Phase 2 — survive a fault that slips through (shipped: crash guards)

- **Process crash isolation** — `unhandledRejection`/`uncaughtException`
  handlers log content-safe and keep serving, so one bad firehose event or
  rejected settlement publish can't take XRPC down. Per-subsystem loops
  (reconcile, relay cursor) already try/catch; HTTP handlers already return
  500 instead of throwing.
- **Console graceful degradation** (separate PR) — short XRPC timeouts,
  retry-with-backoff, stale-cache fallback, and a friendly degraded state, so
  a `services` blip degrades the console instead of erroring it out.

### Phase 3 — remove the single points of failure (planned)

This is the structural work and needs a deliberate migration:

1. **Split read from write.** Run the AppView **read API** as its own
   deployable, separate from the exchange/indexer writers. A settlement or
   indexer bug then cannot take down reads. `buildAppviewApi(store)` is
   already a clean seam — the read API only needs the store.
2. **Move the AppView store off single-volume SQLite.** Options, in order of
   preference:
   - **Postgres** (Railway-managed): N stateless read replicas, no volume
     affinity, managed backups. Most operationally boring; the right default.
   - **LiteFS / Litestream**: keep SQLite, get replication + a rebuildable
     replica. Lower migration cost, more moving parts.
   Because the AppView is a *cache*, this is an infra swap behind the `Store`
   interface, not a data-model change. Keep a verified **rebuild-from-firehose**
   path so a lost index is recoverable, not fatal.
3. **≥2 replicas of the read API** behind Railway's load balancer, once the
   store supports concurrent readers. Now a single instance dying is not an
   outage.
4. **Writers stay single-instance** (the exchange is a single-writer ledger);
   make their restart fast and idempotent (reconcile already is). They can be
   down briefly without affecting reads — settlement catches up on the next
   reconcile tick.

### Phase 4 — know before users do (planned)

- **External uptime monitor** hitting `/healthz` (and a real XRPC) on a tight
  interval, alerting to Slack/email.
- **Fleet health surfacing** — reuse the agent crash-signature mechanism
  (#203) so a flapping `services` is visible, not silent.
- **Backups + a periodic restore drill** for the token-ledger volume, and a
  timed rebuild-from-firehose drill for the AppView.

## Invariant check

None of this changes the core invariants: the provider's PDS remains the
source of truth, AppViews stay caches, and the exchange is still federable.
Phase 3 explicitly leans on "AppView is a cache" to make the read path
horizontally scalable.
