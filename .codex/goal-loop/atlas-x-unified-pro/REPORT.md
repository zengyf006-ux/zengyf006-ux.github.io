# ATLAS X Unified Pro — Work Report

## Repository boundary

- Repository: `zengyf006-ux/zengyf006-ux.github.io`
- Branch: `atlas-x-unified-pro`
- Draft PR: #15 → `main`
- Base at project start: `3a5b2d7120c46b000abb4767f09b190ecb203d03`
- No merge, production deployment, real-fund integration, Supabase/gateway modification or perpetual-contract implementation was performed.

## Baseline

- Starting Head: `2f9f4993296eeee55d25f58248682cc7d48ee43a`
- Starting Run: `29190101359`
- Starting tests: 63 Vitest tests and 38 Golden Vectors.

## G0–G2 — goal loop, contracts and workspace architecture

- Durable goal-loop state was established under `.codex/goal-loop/atlas-x-unified-pro/`.
- Contract generation, decimal format, truthfulness variants, statuses, stable errors and risk rules were corrected.
- Six strict workspaces were established with tested one-way dependencies and typed ports.
- G1 exact Head `e874c3275f69e3f1e35ba763ae97250f983c05d5`, Run `29192009639`.
- G2 exact Head `51e9d1b754701e2b890de0ee572b6a359869a576`, Run `29192393389`.

## G3 — truthful resilient market data

- Added deterministic fixture mode, injected Coinbase public adapter/parser, strict source truthfulness, bounded reconnect, sequence/staleness degradation and truthful cached-real fallback.
- Exact Head `6e1e98ead4e157311571a05d29445c344f6deafb`, Run `29193464887`.

## G4 — event-sourced paper ledger

- Added deterministic replay, idempotent commands/events, reservations, market/limit/stopMarket/stopLimit lifecycle, partial/full fills, cancellation, fees, cost/PnL and confirmation-gated reset.
- Added memory and IndexedDB stores; persistence failures do not mutate in-memory truth.
- Exact Head `7a279fa0552924b990f64bd61cc876baace0bf40`, Run `29195070635`.

## G5 — complete Web product and public candles

- Delivered terminal, markets, watchlist, assets, orders, fills, alerts, settings, data health and help.
- Added all four paper order types and quantity/amount/percentage sizing with decimal-safe estimates and confirmation.
- Replaced isolated component ledgers with one shared event-sourced account and IndexedDB persistence.
- Added mobile chart/book/order/trades task navigation.
- Connected public ticker, order book and trade rendering with explicit `real`, `cachedReal`, fixture, offline, delayed, stale and error states.
- Added strict Coinbase candles for 1m, 5m, 15m, 1h, exact synthetic 4h and 1d; candle geometry remains decimal-safe.
- Added truthful candle cache, request latency, browser online/offline recovery and duplicate-refresh suppression.
- Exact accepted Head `822c8cc06c5e6a4b7fbae81d65d628f86ea0f6d6`, Run `29199915453`, 24 files / 164 tests.

## G6 — installable PWA

- Added standalone manifest, normal/maskable icons and application identity.
- Added a versioned same-origin service worker limited to eligible GET application-shell/static resources.
- Excluded authorization, cookie, API, auth, order, account and cross-origin market traffic from caching.
- Added explicit install, offline, recovery and update-ready UI; update activation remains user-approved.
- Exact Head `1ac0bb07ef94010712569237846a9fe52592140b`, Run `29200295123`, 25 files / 168 tests.

## G7 — browser and quality gates

- Added pinned Playwright browser tooling and a read-only CI quality job.
- Added paper-flow E2E, shared-state checks, IndexedDB reload persistence, PWA offline/recovery, DOM/accessibility-tree audit, keyboard traversal, performance budgets and four screenshots.
- External browser market traffic is isolated in deterministic browser tests; independent live Coinbase smoke remains separate.
- Exact Head `3cf2c80aee74337c5571154b6e1c392bf765b563`, Run `29201636493`.
- Evidence: 18 keyboard controls with visible focus; no unnamed/unlabeled accessibility defects; four viewports without horizontal overflow.

## G8 — screenshot-driven structural redesign

- Installed Noto CJK for readable Chinese CI screenshots.
- Reworked desktop into a chart-led workspace with a market rail and full-height paper ticket.
- Kept chart and ticket above the laptop fold; enabled explicit task panes on tablet/mobile.
- Exact Head `dbf2b24d6db2ff0364aa85dc76a63adb6e237448`, Run `29201931971`.
- All prior functional, accessibility, persistence, recovery, performance and viewport gates remained green.

## G9 — screenshot-driven final polish

- Removed duplicated desktop source emphasis without hiding truthfulness.
- Replaced ticket dead space with an explicit local-paper/no-real-funds boundary.
- Compressed and corrected mobile runtime/header/task/bottom navigation.
- Exact Head `2643b59313af011fe5e08afbab0171c24fa0cab4`, Run `29202179426`.
- Performance: FCP `296 ms`, load `115.1 ms`, transfer `104,362 B`, JS `96,878 B`, CSS `6,154 B`, DOM `256`, CLS `0.000438`, long tasks `186 ms`.

## G10 — exact-Head evidence and independent review package

- Changed every workflow job to checkout and assert the exact PR Head rather than a synthetic merge ref.
- Added final-evidence validation tests and a production evidence builder.
- The final package validates the exact Head, PWA build, browser report, four screenshots, goal-loop state and checksum set.
- It contains `MANIFEST.json`, `EXACT-HEAD.txt`, `REVIEW.md`, `CHECKSUMS.sha256`, production build, browser evidence/trace, CI logs, source proof and goal-loop state.
- Initial strict failures were fixed without weakening gates: missing `.mjs` declaration and an overflow regression test that did not exceed the intentional one-pixel rendering tolerance.
- Exact implementation/evidence Head `beb641e63ee006e3683544185cbdd71edc0b228e`, Run `29202495984`.
- All four jobs passed: `verify`, `public-market-smoke`, `web-quality`, `final-evidence`.
- Final result: 26 Vitest files / 171 tests plus exact-Head browser and artifact validation.
- Final browser performance: FCP `308 ms`, load `106.8 ms`, transfer `103,632 B`, JS `96,878 B`, CSS `6,154 B`, DOM `256`, CLS `0.0004443`, long tasks `84 ms`.
- Independent review Artifact `8262801676`, digest `sha256:9f6603ab5d9a160ea707aa82aac007cbff47f7bc74c22501a83f83da0a438f23`.
- Browser quality Artifact `8262799335`, digest `sha256:8efe85eb40cbadc1c88fe07ff1e794740f1a4fab51802545fdb61e0c1cb35ce5`.
- Production Web Artifact `8262792751`, digest `sha256:0be856e70b58879b9301fc70e55052f21f2d121042cc072dad60eebebe78d988`.
- CI diagnostics Artifact `8262792562`, digest `sha256:d22e4ce43f4e2e95481cbf2ee70ac4c69637309213f64ba876b407de486b31cc`.
- The Draft PR title/body were corrected to the actual Unified Web/PWA scope and safety boundary.

## Current state

G0–G10 are complete. This final state-only synchronization commit is revalidated by the same exact-Head workflow; GitHub’s latest PR Head and successful run supersede the historical evidence Head above. G11 remains a permission gate only: PR #15 stays Draft, open and unmerged until explicit authorization identifies a permitted merge or deployment action.
