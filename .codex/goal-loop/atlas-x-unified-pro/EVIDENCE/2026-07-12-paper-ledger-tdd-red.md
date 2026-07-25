# Paper ledger TDD red evidence — 2026-07-12

The G4 acceptance suite was authored before the final ledger implementation. Its initial red run exposed missing deterministic event replay, order reservations and release, partial/full fills, stop triggers, exact fees and PnL, stable storage failures, corrupt sequence rejection, IndexedDB reload, duplicate event handling and confirmation-gated reset.

No existing test was removed, skipped or weakened. The green implementation must preserve every prior G0–G3 gate and pass the full workspace verification.
