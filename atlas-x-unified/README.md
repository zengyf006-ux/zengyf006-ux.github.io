# ATLAS X Unified Pro

Contract-first, UI-free foundation shared by the future ATLAS X Web/PWA and native SwiftUI clients.

This package owns canonical decimal handling, OpenAPI 3.1 contracts, versioned Golden Vectors, and deterministic pure financial functions. It deliberately contains no DOM, browser globals, storage, network patching, UI, PWA, deployment, Supabase, or perpetual-contract code.

## Verification

```bash
npm ci
npm run verify
```

`npm run verify` checks generated OpenAPI types for drift, runs strict TypeScript checking, executes all Vitest suites, and fails on high or critical production-dependency audit findings.

## Contracts

`openapi/atlas-x.openapi.yaml` is the cross-platform source of truth. The generated TypeScript contract file is committed and must remain byte-for-byte synchronized through:

```bash
npm run generate:contracts
npm run check:generated
```

Financial values use canonical decimal strings at every JSON and interface boundary. Runtime arithmetic uses `decimal.js` with an explicit decimal128-compatible 34-significant-digit, half-up output context and higher internal precision. JSON numbers, exponent notation, negative zero, and inputs beyond the supported precision are rejected; balance and risk position caps round quantities down conservatively.

## Golden Vectors

Version `v1` contains 38 platform-neutral cases: 18 normal, 8 boundary, and 12 error cases. The JSON files and their Draft 2020-12 schema are intentionally independent of TypeScript so a future SwiftUI test target can execute the same fixtures.

## Architecture boundaries

The package contains pure contracts and calculations only. Automated tests reject DOM or browser globals, local storage, React/UI imports, and global `fetch` or `WebSocket` replacement.

## Dependency policy

Direct dependencies and verification tooling are version-pinned in `package.json` and `package-lock.json`. CI installs only from the committed lock file with Node.js 22 and read-only repository permissions.
