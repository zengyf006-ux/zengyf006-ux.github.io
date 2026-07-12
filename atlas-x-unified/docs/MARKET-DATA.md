# Market Data Architecture

ATLAS X Unified uses the public Coinbase Exchange WebSocket feed through an injected `WebSocketFactory`. The adapter never replaces global `fetch` or `WebSocket`, never authenticates, and never handles private account data.

## Truthfulness

- WebSocket messages normalized from the public provider are `real` and name `coinbase-exchange`.
- Cached or retained values are rewritten recursively to `cachedReal` with `cacheTime`.
- Deterministic regression data is always `fixture` and carries a fixture identifier.
- Offline, reconnecting, stale, delayed, degraded and error states remain visible through `MarketConnection`.

## Resilience

The adapter subscribes to heartbeat, ticker, matches and level2 channels. Sequence gaps and out-of-order messages degrade the connection, bounded exponential backoff reconnects the socket, a configurable stale timer detects quiet streams, and network recovery reconnects only after the application marks the network online.

## CI modes

`npm test` uses only deterministic injected sockets, clocks, schedulers, caches and fixtures. A separate `public-market-smoke` GitHub Actions job calls the public Coinbase Exchange ticker, level2 book and candle endpoints. Fixture results cannot satisfy that job or be labeled as real data.
