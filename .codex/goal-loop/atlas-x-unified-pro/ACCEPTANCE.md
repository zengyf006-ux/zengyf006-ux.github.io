# ATLAS X Unified Pro — Acceptance Ledger

## Parent acceptance

The project may request final review only when all 15 completion conditions from `GOAL.md` and the user specification are evidenced on an exact Head and PR #15 remains Draft and unmerged.

## G1 foundation rework — accepted

The starting foundation rejection was resolved on exact verified Head `e874c3275f69e3f1e35ba763ae97250f983c05d5` with Actions Run `29192009639` successful.

Accepted evidence:

1. Required OpenAPI domain schemas are present.
2. OrderStatus and MarketConnection state sets match the required values; `cancelled` is rejected.
3. SchemaVersion is fixed to `atlas.unified.v1`.
4. `atlas-decimal-34` is executed by AJV and TypeScript; number, exponent, negative zero, noncanonical and 35-digit values are rejected.
5. DataSource is a strict discriminated union and cached-real time requirements are enforced.
6. Domain errors use stable codes.
7. Risk assessment includes equity, available cash, independent fees, target/reward/risk ratio and conservative caps.
8. Workflow listens to both unified source and its own workflow file.
9. OpenAPI is reviewable multiline YAML and contract/evidence/legacy disposition docs exist.
10. Generated types/vectors are deterministic, full audit passes and CI is read-only.

## G2 acceptance — running

Required next evidence: workspace dependency graph, package-boundary tests, strict builds for each package, no circular domain/UI/network dependencies, and preservation of all G1 gates.
