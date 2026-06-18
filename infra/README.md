# cocore local stack

A docker-compose stack that brings up enough of cocore to exercise the
full receipt-to-settlement loop on one machine.

## Components

| Service                | Port | What it does                                     |
| ---------------------- | ---- | ------------------------------------------------ |
| `cocore-services`      | 8080 | Bridge HTTP (publish + healthz + stats)          |
|                        | 8081 | AppView read API (XRPC over HTTP)                |
| `cocore-console`       | 3000 | TanStack Start requester UI + device-pair page   |
| `cocore-mock-provider` | —    | Synthetic provider; publishes a receipt every 5s |

`cocore-services` also runs an in-process **autoresponder** (gated on
`COCORE_AUTORESPOND=1`, default on). When a `dev.cocore.compute.job`
record lands on the firehose — e.g. submitted from the console's
`/inference` page — the autoresponder synthesizes a P-256-signed
receipt for it and dispatches the receipt back to the firehose. The
exchange then settles it normally. Disable with
`COCORE_AUTORESPOND=0` when running against real providers.

`cocore-services` runs four logical pieces in one process: a
[`Firehose`](../packages/sdk/src/firehose.ts), the [AppView indexer +
read API](../packages/appview/src/), the [exchange
orchestrator](../packages/exchange/src/exchange.ts) backed by the
`MockAdapter`, and a small HTTP front door for outsiders to publish
records into. Splitting them across containers is straightforward —
they are already independent classes — but for dev we want one log
stream and one set of ports.

## Run it

With Docker:

```bash
make stack-up
make stack-smoke   # asserts the loop closed
make stack-down
```

Without Docker (uses your local `node` against the same source):

```bash
# Terminal 1
cd infra/services && aube run start

# Terminal 2
cd infra/mock-provider && \
  COCORE_BRIDGE_URL=http://localhost:8080 aube run start

# Terminal 3
./infra/smoke.sh
```

In either mode the smoke script (`infra/smoke.ts`):

1. Hits `/healthz`.
2. Snapshots `bridge.stats`.
3. **Generates a real P-256 keypair via WebCrypto.**
4. Publishes a `(paymentAuthorization, job, attestation, receipt)`
   tuple via `dev.cocore.bridge.publish`. The receipt's
   `enclaveSignature` is a real ECDSA-P256-DER signature over the
   canonical bytes of the rest of the body; the attestation's
   `publicKey` is the matching public key.
5. Waits for `bridge.stats` to show one new charge + one new
   settlement.
6. Hits `dev.cocore.appview.verifyReceipt` and asserts `ok:true`.
   That endpoint runs both structural validation **and the
   cryptographic P-256 verify** — the same code path described in
   `packages/sdk/src/p256.ts`.
7. Hits `dev.cocore.appview.getReceipts` and asserts the receipt is
   indexed.

## Endpoints worth knowing

```
http://localhost:8080/healthz
http://localhost:8080/xrpc/dev.cocore.bridge.publish        # POST
http://localhost:8080/xrpc/dev.cocore.bridge.stats          # GET

http://localhost:8081/xrpc/dev.cocore.appview.listProviders
http://localhost:8081/xrpc/dev.cocore.appview.getReceipts?provider=did:plc:...
http://localhost:8081/xrpc/dev.cocore.appview.getReceipts?job=at://...
http://localhost:8081/xrpc/dev.cocore.appview.getSettlements?receipt=at://...
http://localhost:8081/xrpc/dev.cocore.appview.verifyReceipt?uri=...
http://localhost:8081/xrpc/dev.cocore.appview.verifySettlement?uri=...

http://localhost:3000/                                       # console
http://localhost:3000/inference                              # request inference (auth required)
http://localhost:3000/devices/new                            # device pair
http://localhost:3000/api/auth/atproto/metadata.json         # ATProto OAuth client metadata
http://localhost:3000/api/xrpc/dev.cocore.devicePair.start   # POST
http://localhost:3000/api/xrpc/dev.cocore.devicePair.poll    # GET
http://localhost:3000/api/xrpc/dev.cocore.devicePair.confirm # POST
http://localhost:3000/api/xrpc/dev.cocore.inference.submit   # POST (auth)
http://localhost:3000/api/xrpc/dev.cocore.inference.status   # GET  (auth)
```

## What this stack is NOT

- **Not a real PDS.** The bridge stands in for the AT Protocol
  firehose during dev. M5.5 swaps the in-memory `Firehose` for a real
  `com.atproto.sync.subscribeRepos` consumer; the same interfaces hold.
- **Closed-loop credits, no external payments.** Settlement runs through
  the exchange's in-process token ledger; there is no payments provider to
  configure. (The Stripe integration was removed in the closed-loop pivot.)
- **Not a federation demo.** This stack runs one exchange and one
  AppView; the federation invariant is exercised by the
  [exchange](../packages/exchange/src/firehose.test.ts) and
  [AppView](../packages/appview/src/indexer/federation.test.ts) unit tests.
  Spin up a second `cocore-services` container with a different
  `COCORE_EXCHANGE_DID` against the same firehose to exercise it
  live.
