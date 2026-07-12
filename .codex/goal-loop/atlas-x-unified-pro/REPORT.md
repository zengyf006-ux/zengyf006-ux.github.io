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
- Exact verified Head: `e874c3275f69e3f1e35ba763ae97250f983c05d5`.
- GitHub Actions Run `29192009639` succeeded with locked install, deterministic rebuild, zero generated drift and read-only permissions.

## G2 — Workspace boundaries

Commits:

- `345f9e5` — add failing workspace dependency and source-boundary tests.
- `2935702` — establish contracts, domain, market-data, paper-trading, UI and web workspaces with one-way dependencies.
- `c7e7de3` — Actions generated package-lock workspace registrations.
- `51e9d1b` — restore final read-only workspace verification.

Evidence:

- Dependency direction is fixed and tested: contracts → domain → market-data/paper-trading → web; UI depends only on contracts.
- Root compatibility facade preserves all G1 behavior while packages expose focused typed entrypoints.
- Market data and paper trading are represented by ports, not DOM actions or global browser state.
- Paper trading event storage uses a typed event union rather than `unknown` records.
- Architecture tests cover every workspace and reject localStorage/sessionStorage business truth, global window state, and fetch/WebSocket monkey patches.
- Local clean `npm ci` and `npm run verify`: 10 test files, 94 tests, all six workspace typechecks, audit 0.
- Exact verified Head: `51e9d1b754701e2b890de0ee572b6a359869a576`.
- GitHub Actions Run `29192393389`: success; locked install, deterministic rebuild, zero lock/generated drift and full workspace verification.
- Final workflow permissions are read-only.

## Current work

G3 is running: deterministic fixture and public Coinbase feed parsing, connection transitions, reconnection backoff, cache/offline truthfulness and source visibility.
