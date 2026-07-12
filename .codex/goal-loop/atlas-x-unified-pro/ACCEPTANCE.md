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

## G5 Web product — running

Verified checkpoint: Head `371b94bd7d0cccb13f13dad24703def13a08aba6`, Run `29198256110`.

Accepted for this checkpoint:

- React/Vite build, strict workspace types, tests, audit and generated drift passed.
- Production build Artifact was uploaded successfully.
- Market, limit, stopMarket and stopLimit paper order drafts are available.
- Quantity, amount and percentage inputs use shared decimal-safe domain logic.
- Terminal, assets, current orders, fills, alerts, settings, data-health and help are reachable on desktop and mobile.
- One shared event-sourced paper account uses IndexedDB where available and truthfully reports memory fallback.
- Mobile uses explicit chart/book/order/trades task panes instead of an unbounded vertical terminal.
- Fixture is visibly labeled and independent Coinbase public smoke passed.

Still required before G5 acceptance:

- Connect the existing public/cached market adapter into the Web state flow with explicit connection and latency display.
- Complete live/cached/offline transition behavior in the rendered product.
- Add E2E, accessibility, four-viewport screenshot and visual iteration evidence.
- Remove remaining prototype-level chart rendering and complete screenshot-led product refinement.
