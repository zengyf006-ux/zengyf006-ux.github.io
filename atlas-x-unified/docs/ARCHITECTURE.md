# ATLAS X Unified Architecture

The workspace dependency direction is fixed:

`contracts → domain → market-data / paper-trading → web`

`ui` depends only on contracts and is consumed by the web application. Contracts never import runtime domain code; domain never imports network, persistence, UI, or application code. Market adapters and paper-ledger adapters expose ports rather than browser globals. The web application composes these ports and owns presentation state.

The root `src/` remains a compatibility facade while verified milestone-one code is migrated package by package. It is not a second implementation: workspace packages re-export or consume the canonical root modules until a later atomic move preserves all Golden Vectors and generated-contract checks.
