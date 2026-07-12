# ATLAS X Unified Pro — Goal Graph

Status values: `ready`, `running`, `rejected`, `done`.

| ID | Goal | Depends on | Status |
|---|---|---|---|
| G0 | Establish durable goal-loop state and baseline evidence | — | done |
| G1 | Foundation rework: complete contracts, decimal format, truthfulness, risk model, docs and CI paths | G0 | done |
| G2 | Monorepo/package boundaries for contracts, domain, market data, paper trading, UI and web app | G1 | done |
| G3 | Deterministic market adapters, connection state machine, cache/offline truthfulness | G2 | done |
| G4 | Event-sourced paper ledger with IndexedDB persistence and reset confirmation | G2 | done |
| G5 | Professional Web terminal, markets, watchlist, assets, orders, fills, alerts, settings and data health | G3,G4 | done |
| G6 | PWA installability, offline shell, recovery and update flow | G5 | done |
| G7 | Unit/contract/vector/state/ledger/persistence/reconnect/E2E/a11y/performance gates | G3,G4,G5,G6 | done |
| G8 | Visual iteration 1: product structure and interaction | G5,G7 | done |
| G9 | Visual iteration 2: screenshot-led redesign and polish | G8 | done |
| G10 | Final exact-Head evidence, build artifact and independent-review package | G9 | running |
| G11 | Deployment permission gate | G10 | ready |

## Execution rules

- Only one goal may be `running` unless its work is genuinely independent.
- A goal becomes `done` only with committed evidence and exact-Head CI where applicable.
- A rejected batch is repaired on the same branch; tests are never weakened or skipped.
- `CURRENT.md` identifies the immediate next action and must remain concise.
