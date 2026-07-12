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
- Connection transitions cover initializing, cached, live, delayed, reconnecting, stale, offline, degraded and error.
- Sequence gaps and out-of-order data degrade rather than remain falsely live.
- Reconnect backoff is bounded and deterministic.
- Network loss/recovery, stale detection and cache failure are tested.
- Separate public smoke verifies the actual ticker/order-book/candle chain and cannot be replaced by fixtures.

## G4 paper ledger — running

Required evidence: deterministic event replay, initial balance, available/locked/total assets, market/limit/stop order lifecycle, reservation/release, partial/full fills, cancellation, fees, position cost, realized/unrealized PnL, reload correctness through IndexedDB, stable errors, idempotent command/event IDs, and confirmation-gated reset.
