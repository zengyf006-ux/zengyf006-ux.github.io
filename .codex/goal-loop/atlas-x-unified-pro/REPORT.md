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
- Exact verified Head: `e874c3275f69e3f1e35ba763ae97250f983c05d5`.
- Actions Run `29192009639`: success.

## G2 — Workspace boundaries

- Commits: `345f9e5`, `2935702`, `c7e7de3`, `51e9d1b`.
- Six strict workspaces with tested one-way dependencies and typed ports.
- Exact verified Head: `51e9d1b754701e2b890de0ee572b6a359869a576`.
- Actions Run `29192393389`: success.

## Contract generation correction

- `a0231a7` added a regression test proving openapi-typescript was replacing business const values with schema names when `discriminator` was present.
- `9a29aa5` removed the harmful discriminator annotations while retaining strict `oneOf` + `const` validation. Generated TypeScript now uses `real`, `cachedReal`, `fixture`, `market`, `stopMarket` and `stopLimit`.
- `21b9082` restored read-only verification.

## G3 — Truthful resilient market data

Commits:

- `f704aab` — initial failing public market behavior tests.
- `5122e41` — added forward-gap and offline-memory truthfulness regression tests plus TDD red evidence.
- `6e1e98e` — implemented state reducer, sequence policy, Coinbase public parser/adapter, truthful cache/fixture behavior, bounded reconnect, stale/offline recovery, public smoke and docs.

Evidence:

- Public endpoint and channels are isolated behind an injected WebSocket factory; no global WebSocket/fetch replacement.
- Ticker, trade and level2 messages normalize to canonical decimal strings and `real` source metadata.
- Cached and retained values are recursively relabeled `cachedReal`; fixtures remain `fixture`.
- Sequence gaps, out-of-order messages, stale data, cache failure, socket closure, offline state and recovery are tested.
- Local clean verification: 12 test files, 115 tests, all workspace strict typechecks, generated drift clean, audit 0.
- Exact verified Head: `6e1e98ead4e157311571a05d29445c344f6deafb`.
- GitHub Actions Run `29193464887`: success.
- Job `verify`: locked install, deterministic rebuild, zero drift and full regression success.
- Job `public-market-smoke`: Coinbase Exchange public ticker, level2 book and one-minute candles observed successfully; fixture mode cannot satisfy this job.
- Workflow token permissions remain read-only.

## Current work

G4 is running: deterministic event-sourced paper account, order lifecycle, reservations, partial fills, fees, realized/unrealized PnL, reset confirmation and IndexedDB persistence.
