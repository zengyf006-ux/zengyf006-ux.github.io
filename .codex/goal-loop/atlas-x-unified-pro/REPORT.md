# ATLAS X Unified Pro — Work Report

## Baseline: 2026-07-12

- Repository: `zengyf006-ux/zengyf006-ux.github.io`
- Branch: `atlas-x-unified-pro`
- Draft PR: #15
- Base: `main` at `3a5b2d7120c46b000abb4767f09b190ecb203d03`
- Starting Head: `2f9f4993296eeee55d25f58248682cc7d48ee43a`
- Starting Actions: `ATLAS X Unified Verify`, Run `29190101359`, success
- Starting baseline: 63 Vitest tests and 38 Golden Vectors.

## G0 — Goal loop

- `41b8243` — durable goal, graph, report, acceptance, current status and evidence directory.

## G1 — Foundation rework

- Commits: `9842891`, `5985e58`, `8d3f8c4`, `c84c7dc`, `53ad963`, `e874c32`.
- Fixed `atlas.unified.v1`, `atlas-decimal-34`, strict DataSource variants, complete statuses, stable errors, fee-aware risk and multiline contract docs.
- Exact verified Head: `e874c3275f69e3f1e35ba763ae97250f983c05d5`; Run `29192009639` success.

## G2 — Workspace boundaries

- Commits: `345f9e5`, `2935702`, `c7e7de3`, `51e9d1b`.
- Six strict workspaces with tested one-way dependencies and typed ports.
- Exact verified Head: `51e9d1b754701e2b890de0ee572b6a359869a576`; Run `29192393389` success.

## Contract generation correction

- `a0231a7` added the regression proving `openapi-typescript` was replacing business const values with schema names.
- `9a29aa5` retained strict `oneOf` + `const` validation while restoring generated values such as `real`, `market` and `stopLimit`.
- `21b9082` restored read-only verification.

## G3 — Truthful resilient market data

- Commits: `f704aab`, `5122e41`, `6e1e98e`, `ffbf559`.
- Injected public WebSocket adapter, Coinbase parser, explicit truthfulness, bounded reconnect, sequence/staleness degradation and truthful cache fallback.
- Local clean verification: 12 test files / 115 tests, all workspace strict typechecks, drift and audit passed.
- Exact verified implementation Head: `6e1e98ead4e157311571a05d29445c344f6deafb`.
- Run `29193464887`: `verify` and `public-market-smoke` success.

## G4 — Event-sourced paper trading ledger

- `6ecbd3b` — event-sourced ledger, memory/IndexedDB stores, lifecycle, reservations, fills, fees, cost/PnL and reset safety.
- `794692c` — removed temporary materialization workflow and restored read-only CI.
- `7a279fa` — paper trading architecture and milestone evidence.
- Deterministic replay, idempotent commands/events, sequence integrity, exact cash/asset reservations, partial/full fills, cancellation, stop triggers and stable domain errors.
- IndexedDB reload is tested across instances; persistence failures do not mutate in-memory truth.
- Local verification: 14 test files / 137 tests, 56 Golden Vectors, all workspace strict typechecks, generated drift clean, audit 0.
- Exact verified Head: `7a279fa0552924b990f64bd61cc876baace0bf40`.
- Actions Run `29195070635`: `verify` success; `public-market-smoke` success; workflow permissions read-only.

## Current work

G5 is running: typed React Web product structure, terminal workflow, market/watchlist/assets/orders/fills/alerts/settings/data-health pages and dedicated desktop/mobile interaction architecture.
