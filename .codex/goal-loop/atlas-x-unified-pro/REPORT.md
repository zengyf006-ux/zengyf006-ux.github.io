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

## G5 — Web product, batches 1-2

- `2a8f32a` — established the React/Vite professional trading shell and product pages.
- `a757165` — locked React/Vite dependencies after full verification.
- `962b151` — restored read-only Web verification and public market smoke.
- `bb6294c` / `8fa22db` — expanded Web acceptance for all four order types and exact input modes.
- `679eded` / `fd32fec` — implemented decimal-safe quantity, amount and buy/sell percentage sizing plus four draft variants.
- `2333d59` / `3e06dff` / `418f0db` — replaced per-component memory ledgers with one shared Context ledger and IndexedDB persistence with truthful memory fallback.
- `08e70ce` / `da05fc3` — completed the first paper trading workflow, assets/orders/fills pages, alerts, settings, reset confirmation and mobile reachability.
- `940ea4f`, `3ec244d`, `050306a`, `4fae14e` — dedicated mobile task switching, responsive product styles and complete mobile navigation.
- `92adbce` — added production build Artifact publication while retaining read-only permissions.
- Fixture remains visibly labeled and cannot satisfy the independent public Coinbase smoke.
- Market, limit, stopMarket and stopLimit are available with quantity, amount and percentage input modes, decimal-safe estimates and confirmation.
- A single event-sourced account is shared across terminal, assets, orders, fills and settings; IndexedDB reload is used where available.
- Mobile trading uses task panes for chart, book, order and trades rather than one unbounded vertical terminal.
- Exact verified Head: `371b94bd7d0cccb13f13dad24703def13a08aba6`.
- Actions Run `29198256110`: `verify` success; production Web build Artifact success; `public-market-smoke` success.
- Artifact ID `8261621959`, digest `sha256:619ee936aa5b21dfdb5a7f05c481f1cc7980998e514d737b219e287b44262888`.

## G5 — Web product, batch 3 truthful market rendering

- Added a persistent IndexedDB cache that accepts only `real` public market snapshots.
- Connected the injected Coinbase adapter to a React market provider without replacing global WebSocket or fetch.
- Rendered explicit `real`, `cachedReal`, `fixture`, offline, delayed, stale and error status with source and latency detail.
- Public ticker price, amount change and percentage change use shared decimal-safe calculations.
- Public order-book and trade events now drive the terminal; fixture data is used only before public events arrive and is visibly labeled.
- Retained order-book/trade data is relabeled `cachedReal` when the connection falls back to cache; unknown offline state clears retained public events.
- Split CI into install, generation, drift, strict typecheck, tests, production build and audit steps with downloadable diagnostic logs.
- Exact verified Head: `37cca57090a7519fbf6e6423b03da71d8112a63e`.
- Actions Run `29199258526`: 143 tests, strict typecheck, production build, audit, diagnostics, build Artifact and public market smoke all success.
- Web Artifact ID `8261899305`, digest `sha256:496c73381c678494913138cc1ccbf95c2415324f441de830ae6794a372fc3c4b`.
- CI diagnostics Artifact ID `8261899047`, digest `sha256:26a219e31b8dc8854b3230d30a27ef8edb35998ba644e6be731db474825365ec`.

## G5 — Web product, batch 4 public candles and recovery

- Added a strict Coinbase public candle adapter for 1m, 5m, 15m, 1h, synthetic exact 4h and 1d intervals.
- Added IndexedDB candle persistence that accepts only matching `real` public candles.
- Replaced the prototype bar chart with decimal-safe candle bodies and wicks derived from contract strings without native floating-point financial calculations.
- The rendered chart identifies `real`, `cachedReal` and fixture data, exposes provider, interval, count and request latency, and preserves the latest real candle cache during outages.
- Browser online/offline events now cause immediate candle fallback and recovery; overlapping refresh requests are suppressed.
- Added parser, aggregation, malformed-data, cache, chart-geometry, latency and offline-presentation tests.
- Exact verified implementation Head: `822c8cc06c5e6a4b7fbae81d65d628f86ea0f6d6`.
- Actions Run `29199915453`: 24 test files / 164 tests, all strict typechecks, production build, audit, diagnostics, Web Artifact and public market smoke passed.
- Web Artifact ID `8262077478`, digest `sha256:692f16eea83aa70678f50fc56fd26e9ee3d9199f6bc221b7276ebab0f12db3cd`.
- CI diagnostics Artifact ID `8262077374`, digest `sha256:e9ebcac2e5273f762a8fadca87a57fb6e7d16d2e69d20faddf9785a3aa5cb398`.
- G5 is accepted. E2E/a11y/performance gates remain assigned to G7; screenshot-led redesign remains assigned to G8 and G9.

## Current work

G6 is running. The next batch adds an installable manifest, versioned offline application shell, explicit recovery state and safe update activation flow without adding any real-money or production deployment path.
