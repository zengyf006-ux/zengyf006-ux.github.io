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

## G6 — Installable PWA and safe offline shell

- Added a standalone Web App Manifest, application metadata, normal SVG icon and maskable SVG icon.
- Added a versioned service worker that installs the public application shell, uses network-first navigation, caches same-origin static GET responses and does not intercept cross-origin public market traffic.
- Explicitly excludes authorization, cookie, API, auth, orders and accounts requests from service-worker caching.
- Added browser-visible install, offline, recovery and update states.
- Updates remain waiting until the user chooses `安全更新`; a controller replacement reload occurs only after that explicit action.
- Added deterministic PWA state and policy tests plus a production artifact gate for manifest, shell, registration and activation boundaries.
- An initial gate failure at `dd1cba9` exposed a wrong `dist/assets` path in the verifier; the verifier was corrected without weakening any assertion.
- Exact verified implementation Head: `1ac0bb07ef94010712569237846a9fe52592140b`.
- Actions Run `29200295123`: 25 test files / 168 tests, all strict typechecks, production build, PWA artifact gate, audit and public market smoke passed.
- PWA gate evidence: `[pwa-build] shell=5 js=1 css=1 manifest=standalone update=user-approved`.
- Web Artifact ID `8262186843`, digest `sha256:cc0f4465e1c853430e82cc3531d5a81f761c06c7035a403c0565f4b91041b7de`.
- CI diagnostics Artifact ID `8262186688`, digest `sha256:13b1610de9b3e1b6501829ca657b4517ff49c5b09e63988148f5f08c31512df7`.
- G6 is accepted.

## G7 — Browser-driven quality gates

- Added pinned Python Playwright dependencies and a system-Chrome browser-quality runner without changing application dependencies.
- Added deterministic paper order E2E, cross-page shared state, IndexedDB reload persistence, service-worker offline shell and recovery checks.
- Added DOM and accessibility-tree audits, keyboard traversal with focus visibility, performance budgets and four required viewport screenshots.
- Browser traffic is isolated from external market services while the independent Coinbase public smoke remains a separate live job.
- Initial failures exposed three defects in the test harness itself: a WebSocket route deadlock, an order-button visibility assumption on the mobile chart pane and synthetic HTTP 503 console noise. Each was repaired without weakening product assertions.
- Exact verified implementation Head: `3cf2c80aee74337c5571154b6e1c392bf765b563`.
- Actions Run `29201636493`: `verify`, `public-market-smoke` and `web-quality` all passed.
- Retained 25 test files / 168 tests; strict typecheck, production build, PWA verification and audit passed.
- Browser evidence: paper position persisted after reload; service worker controlled the page, offline shell rendered and recovery notice appeared.
- Accessibility evidence: zero unnamed visible controls, unlabeled inputs, duplicate IDs, missing image alternatives or unnamed accessibility-tree controls; 18 unique keyboard controls with 18 visible focus stops.
- Performance evidence: FCP `532 ms`, load `295.1 ms`, transfer `102,575 B`, JavaScript `96,879 B`, CSS `4,366 B`, DOM `256`, CLS `0.000527`, long tasks `300 ms`; all under budget.
- Four viewports passed without horizontal overflow: desktop 1440×900, laptop 1024×768, tablet 768×1024 and mobile 390×844.
- Browser quality Artifact ID `8262563434`, digest `sha256:8be42c52637dca17f633a499e675ed6f68ef925b0541ac225e69e3cf9e2a9e25`.
- Web Artifact ID `8262557566`, digest `sha256:c7e254c003e840416975b878b216646629cf9b9fd8a70eac11fb25a49f5f95c9`.
- CI diagnostics Artifact ID `8262557472`, digest `sha256:5bc9762d657a0dd4e0c9fd1ee14904bca9ba45c19765159ea1873d256dc14873`.
- G7 is accepted.

## Current work

G8 is running. The exact G7 screenshots show a functionally complete but visually under-resolved terminal: desktop hierarchy is too flat, laptop/tablet panel balance pushes key controls below the fold, and CI screenshots lack readable CJK fonts. The next batch installs screenshot fonts in CI and performs the first screenshot-driven structural/interaction refinement while preserving every G7 gate.
