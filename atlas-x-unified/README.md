# ATLAS X Unified Pro

Contract-first, UI-free foundation shared by the future ATLAS X Web/PWA and native SwiftUI clients.

This package owns canonical decimal handling, OpenAPI 3.1 contracts, versioned Golden Vectors, and deterministic pure financial functions. It deliberately contains no DOM, browser globals, storage, network patching, UI, PWA, deployment, Supabase, or perpetual-contract code.

## Verification

```bash
npm ci
npm run verify
```

The generated TypeScript contract file is committed and must remain byte-for-byte synchronized with `openapi/atlas-x.openapi.yaml`.
