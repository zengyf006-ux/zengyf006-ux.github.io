# ATLAS X Unified Pro — Acceptance Ledger

## Parent acceptance

Final review requires all completion conditions on an exact Head while PR #15 remains Draft and unmerged.

## G1 foundation rework — accepted

Head `e874c3275f69e3f1e35ba763ae97250f983c05d5`, Run `29192009639`.

## G2 workspace boundaries — accepted

Head `51e9d1b754701e2b890de0ee572b6a359869a576`, Run `29192393389`.

## G3 market data — accepted

Head `6e1e98ead4e157311571a05d29445c344f6deafb`, Run `29193464887`.

- Deterministic fixture mode is separately identified and tested.
- Coinbase public parser and adapter produce real-source canonical events.
- Every cached/offline retained value is visibly `cachedReal`.
- Complete connection states, sequence degradation, reconnect, stale/offline recovery and public smoke are tested.

## G4 paper ledger — accepted

Head `7a279fa0552924b990f64bd61cc876baace0bf40`, Run `29195070635`.

- Deterministic event replay and exact initial/available/locked/total balances.
- market, limit, stopMarket and stopLimit lifecycle.
- Quote/base reservations, cancellation release, partial and full fills.
- Exact fees, weighted position cost, realized/unrealized PnL and equity.
- Stable command/event idempotency and sequence-gap rejection.
- IndexedDB cross-instance reload, storage failure mapping and confirmation-gated reset.
- All paper data is explicitly `simulated`; real public smoke remains separate and passed.

## G5 Web product — accepted

Exact verified implementation Head `822c8cc06c5e6a4b7fbae81d65d628f86ea0f6d6`, Run `29199915453`.

- React/Vite production build, all strict workspace typechecks, generated drift, audit and public market smoke passed.
- 24 Vitest files / 164 tests passed without weakening or skipping tests.
- Market, limit, stopMarket and stopLimit paper order drafts are available.
- Quantity, amount and percentage inputs use shared decimal-safe domain logic.
- Terminal, markets, watchlist, assets, current orders, fills, alerts, settings, data-health and help are reachable on desktop and mobile.
- One shared event-sourced paper account uses IndexedDB where available and truthfully reports memory fallback.
- Mobile uses explicit chart/book/order/trades task panes instead of an unbounded vertical terminal.
- Coinbase ticker, order book, trades and read-only K lines are rendered with explicit provider and truthfulness labels.
- Public K lines use exact decimal geometry, show request latency, retain only real values in IndexedDB, relabel offline retention as `cachedReal`, and fall back to visibly labeled fixture data when no real cache exists.
- Browser online/offline events trigger immediate K-line recovery/fallback; duplicate refreshes are suppressed.
- Web build Artifact ID `8262077478`, digest `sha256:692f16eea83aa70678f50fc56fd26e9ee3d9199f6bc221b7276ebab0f12db3cd`.
- CI diagnostics Artifact ID `8262077374`, digest `sha256:e9ebcac2e5273f762a8fadca87a57fb6e7d16d2e69d20faddf9785a3aa5cb398`.

The remaining E2E, accessibility, performance and four-viewport gates belong to G7. Screenshot-led product redesign belongs to G8 and G9; those requirements were not silently treated as G5 evidence.

## G6 PWA — running

Required before acceptance:

- Installable manifest and application identity.
- Versioned offline application shell without caching authenticated or real-money operations.
- Explicit offline/recovery state and safe update activation flow.
- Tests for update decisions and service-worker caching policy.
- Exact-Head strict typecheck, tests, production build, audit and Artifact evidence.
