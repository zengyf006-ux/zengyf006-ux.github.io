# ATLAS X Unified Pro — Acceptance Ledger

## Parent acceptance

The project may request final review only when all 15 completion conditions from `GOAL.md` and the user specification are evidenced on an exact Head and PR #15 remains Draft and unmerged.

## G1 foundation rework — accepted

Accepted on Head `e874c3275f69e3f1e35ba763ae97250f983c05d5`, Actions Run `29192009639`.

## G2 workspace boundaries — accepted

Accepted on Head `51e9d1b754701e2b890de0ee572b6a359869a576`, Actions Run `29192393389`.

- Required workspace manifests and source entrypoints exist.
- Package dependency graph is one-way and tested.
- All workspaces pass strict TypeScript independently.
- Contracts/domain remain browser and UI independent.
- No workspace may store business truth in localStorage/sessionStorage or replace global fetch/WebSocket.
- Clean npm ci, generated drift, full tests and audit pass.

## G3 acceptance — running

Required evidence: deterministic fixture mode, public real-feed parser/adapter, explicit truthfulness on every snapshot/event, complete connection-state transitions, sequence-gap/staleness handling, bounded reconnect backoff, cache fallback that never becomes `real`, and network-loss/recovery tests.
