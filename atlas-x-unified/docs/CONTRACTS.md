# ATLAS X Unified Contracts

`openapi/atlas-x.openapi.yaml` is the cross-platform source of truth for Web/PWA and future Swift clients.

## Versioning

Every domain snapshot and event uses the fixed value `atlas.unified.v1`. Arbitrary semantic versions are rejected.

## Decimal boundary

Every price, quantity, amount, fee, rate and PnL value is a JSON string using the named OpenAPI format `atlas-decimal-34`. It permits canonical non-exponent decimals with at most 34 significant digits. JSON numbers, exponent notation, negative zero, leading zeros and trailing fractional zeros are invalid at the contract boundary. Runtime calculations use `decimal.js` with 80-digit internal precision and 34-digit half-up output; risk and balance quantity caps round down.

## Truthfulness

`DataSource` is a strict discriminated union. `cachedReal` requires `cacheTime`; `real` cannot carry it; `unknown`, `simulated` and `fixture` are distinct branches. UI consumers must display these states and never present cached, simulated or fixture data as live real data.

## Errors

All domain errors include a stable `DomainErrorCode`. Human-readable messages are supplementary and must not be used as program logic.
