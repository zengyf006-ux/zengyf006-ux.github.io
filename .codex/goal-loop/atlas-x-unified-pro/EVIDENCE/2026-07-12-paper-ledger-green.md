# G4 Paper Ledger — Green Evidence

Date: 2026-07-12

## Commits

- `6ecbd3bf24003611ce00547c55fd9091418800db` — event-sourced paper trading ledger and tests.
- `794692c459ac9c21bb7ed76a144729e6f643758b` — final read-only workflow.
- `7a279fa0552924b990f64bd61cc876baace0bf40` — architecture and milestone evidence.

## Test evidence

- Generated OpenAPI/types/vector drift: clean.
- Root and all workspace TypeScript strict checks: passed.
- Vitest: 14 files, 137 tests passed.
- Golden Vectors: 56 total; normal 24, boundary 13, error 19.
- npm audit at high threshold: 0 vulnerabilities.

## GitHub Actions

- Workflow: `ATLAS X Unified Verify`
- Run ID: `29195070635`
- Exact Head: `7a279fa0552924b990f64bd61cc876baace0bf40`
- `verify`: success.
- `public-market-smoke`: success.
- Repository token permission: read-only.

## Accepted behavior

Event replay, exact balances, reservations, four order types, cancellation, partial/full fills, stop triggers, fees, cost basis, realized/unrealized PnL, command/event idempotency, sequence-gap rejection, IndexedDB reload, storage failure mapping and confirmation-gated reset.

No merge, deployment, real order, credential, production gateway, Supabase, main, legacy website or PR #13 change occurred.
