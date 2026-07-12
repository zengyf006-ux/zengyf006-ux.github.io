# ATLAS X Unified Pro — Work Report

## Baseline: 2026-07-12

- Repository: `zengyf006-ux/zengyf006-ux.github.io`
- Branch: `atlas-x-unified-pro`
- Draft PR: #15
- Base: `main` at `3a5b2d7120c46b000abb4767f09b190ecb203d03`
- Starting Head: `2f9f4993296eeee55d25f58248682cc7d48ee43a`
- Starting Actions: `ATLAS X Unified Verify`, Run `29190101359`, success
- Starting baseline: 63 Vitest tests and 38 Golden Vectors.

## G0 — Goal loop

- `41b8243` — `docs: establish unified pro goal loop`
- Durable goal, graph, report, acceptance, current status and evidence directory established.

## G1 — Foundation rework

Commits:

- `9842891` — record TDD red evidence.
- `5985e58` — add failing foundation and expanded risk acceptance tests.
- `8d3f8c4` — implement fixed schema version, named decimal format, strict truthfulness, domain schemas, stable errors, risk assessment, docs and workflow migration.
- `c84c7dc` — fix Golden Vector meta-schema version migration after Run `29191899789` exposed the mismatch.
- `53ad963` — Actions materialized multiline OpenAPI, generated TypeScript and migrated/expanded vectors.
- `e874c32` — restore final read-only deterministic CI.

Evidence:

- Fixed schema version: `atlas.unified.v1`.
- Named format: `atlas-decimal-34`, 34 digits accepted and 35 rejected by TypeScript and AJV.
- Strict DataSource branches distinguish unknown, cached real, real, simulated and fixture.
- Full OrderStatus and MarketConnection state sets; only `canceled` is accepted.
- Complete requested domain schemas and stable DomainErrorCode enum.
- Fee-aware spot-long risk assessment separates equity and available cash, supports optional target, reward/risk outputs and conservative quantity caps.
- Original risk API and original vectors remain executable; vectors expanded from 38 to 44: normal 20, boundary 9, error 15.
- Local compatibility reconstruction: 9 test files, 89 tests, generated drift/typecheck/audit all passed.
- Exact verified Head: `e874c3275f69e3f1e35ba763ae97250f983c05d5`.
- GitHub Actions: `ATLAS X Unified Verify`, Run `29192009639`, success; locked install, deterministic rebuild, zero generated drift and full verify all passed.
- Final workflow token permissions are read-only.

## Current work

G2 is running. The next batch establishes explicit package and application boundaries while preserving all G1 behavior and evidence.
