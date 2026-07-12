# G5 Web checkpoint — Green Evidence

Date: 2026-07-12

## Exact verification

- Verified Head: `371b94bd7d0cccb13f13dad24703def13a08aba6`
- Workflow: `ATLAS X Unified Verify`
- Run ID: `29198256110`
- `verify`: success
- `public-market-smoke`: success
- Workflow permissions: contents read

## Build artifact

- Artifact ID: `8261621959`
- Name: `atlas-x-unified-web-e6a50df9d6127af32fc583b6f603a2c97e91b783`
- Size: 374491 bytes
- Digest: `sha256:619ee936aa5b21dfdb5a7f05c481f1cc7980998e514d737b219e287b44262888`
- Expiry: 2026-07-26

## Verified scope

- React/Vite production build.
- Full contract regeneration and zero generated/lock drift.
- All workspace strict TypeScript checks, Vitest regression suite and high-level dependency audit.
- Independent Coinbase public ticker/order-book/candle smoke.
- Shared event-sourced paper account with IndexedDB and truthful memory fallback.
- Four paper order types, exact quantity/amount/percentage input, estimate and confirmation.
- Desktop product navigation and mobile primary plus additional-page navigation.
- Mobile chart/book/order/trades task switching.

## Boundaries

No merge, deployment, real order, real funds, credentials, main, PR #13, legacy website, production gateway or Supabase change occurred.

G5 remains running because rendered real/cached/offline market integration, E2E, accessibility, four-viewport screenshots and two visual iterations are not yet accepted.
