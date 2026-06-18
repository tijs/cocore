// Exchange entry point — vestigial.
//
// The exchange runtime lives in `infra/services` — the single-process
// orchestrator that runs the AppView indexer, the firehose, the token
// ledger, and the patronage scheduler. This file stays as the
// package's `start` script entry point so the cargo of docker-compose
// configs that invoke `pnpm --filter @cocore/exchange start` still
// resolve. It logs once and parks.

console.error(
  "exchange: standalone runtime is vestigial. The exchange runs inside infra/services. See packages/exchange/src/{token-balance,exchange,publisher}.ts for the library surface.",
);

if (import.meta.url === `file://${process.argv[1]}`) {
  // Park so a long-running container doesn't crash-loop. Operators
  // who hit this should re-target their compose to infra/services.
  await new Promise(() => {});
}
