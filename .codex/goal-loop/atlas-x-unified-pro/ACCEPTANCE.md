# ATLAS X Unified Pro — Acceptance Ledger

## Parent acceptance

The project may request final review only when all 15 completion conditions from `GOAL.md`/the user specification are evidenced on an exact Head and PR #15 remains Draft and unmerged.

## Current rejection: Foundation completeness

Starting Head `2f9f4993296eeee55d25f58248682cc7d48ee43a` is rejected as a final foundation because:

1. Required OpenAPI domain schemas are missing.
2. `OrderStatus` and `MarketConnection` state sets are incomplete.
3. SchemaVersion accepts arbitrary semantic versions instead of only `atlas.unified.v1`.
4. The 34-digit decimal rule is described but not a named OpenAPI format enforced identically by AJV/TypeScript/future Swift fixtures.
5. `DataSource` is not yet the required strict discriminated union.
6. Domain errors are not uniformly represented by stable codes.
7. Risk sizing omits equity/available cash separation, entry/exit fees, optional target and reward/risk outputs.
8. Workflow path coverage omits its own workflow file.
9. OpenAPI is not reviewable multiline YAML and milestone evidence/legacy disposition docs are absent.

## Rework requirement

Add failing tests first, implement the minimum strict contract/domain changes, regenerate types, run `npm ci`, `npm run verify`, full audit, exact-Head Actions, and record evidence before G1 may become `done`.
