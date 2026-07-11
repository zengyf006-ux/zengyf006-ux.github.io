# ATLAS X Pro Stage 1 Realtime Market & Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow, single-provider, partially simulated market-data path with a resilient public-market gateway plus a generation-safe client engine, then upgrade the K-line experience so interval changes, realtime freshness, selection, high/low labels, countdowns, and rich candle details behave like a mature trading terminal.

**Architecture:** GitHub Pages remains the static frontend. A public Supabase Edge Function (`atlas-market-gateway`) normalizes Binance, OKX, and Bybit public market data and provides health, candles, snapshots, and SSE fallback. The frontend adds a standalone `market-data-engine.js` that owns session identity, request generations, cache, freshness, direct WebSocket fast path, SSE fallback, and normalized events. `app.js` keeps account and simulated order logic but consumes engine events instead of owning network failover. Chart behavior is split into `chart-experience.js` so selection, overlays, extrema labels, countdown, and interaction state are testable independently.

**Tech Stack:** Vanilla JavaScript, Canvas 2D, IndexedDB, EventTarget/CustomEvent, EventSource, WebSocket, Supabase Edge Functions (Deno TypeScript), Playwright Core, GitHub Actions.

## Global Constraints

- Remain a high-fidelity simulated trading product; do not add real funds, withdrawals, exchange accounts, API secrets, private keys, or seed phrases.
- Public market data only; the gateway must not store user account, order, balance, or personal data.
- No iframe and no dependency on legacy `atlas-x/` DOM, CSS, or business scripts.
- Do not claim data is live when it is cached, stale, reconnecting, or offline.
- Do not replace deterministic CI with external-network-only tests; maintain deterministic provider tests and add a separate real-network smoke test.
- All four viewports remain mandatory: 390×844, 430×932, 1440×900, and 1920×1080.
- Deployment remains non-force fast-forward only after all stage gates pass.

---

## File Map

### Create

- `supabase/functions/atlas-market-gateway/index.ts` — public, origin-restricted multi-provider market-data gateway.
- `supabase/functions/atlas-market-gateway/deno.json` — Edge Function runtime configuration.
- `atlas-x-pro/market-data-engine.js` — normalized market session, cache, generation, stream, freshness, and provider state.
- `atlas-x-pro/chart-experience.js` — candle selection state machine, rich detail model, high/low labels, countdown, and chart interaction helpers.
- `atlas-x-pro/realtime-market-chart.css` — realtime status, skeleton loading, rich candle card, extrema labels, latest button, and mobile chart layout.
- `qa/atlas-x-pro/realtime-market-chart.mjs` — deterministic browser acceptance for interval correctness, request generations, stale state, selection cancellation, extrema, and countdown.
- `qa/atlas-x-pro/gateway-contract.mjs` — deterministic gateway normalization tests against local fixtures.
- `qa/atlas-x-pro/gateway-smoke.mjs` — real deployed gateway health/candles/snapshot smoke.

### Modify

- `atlas-x-pro/index.html` — add full interval controls, richer chart detail markup, status/freshness UI, latest button, and load new modules before `app.js`.
- `atlas-x-pro/app.js` — remove direct REST/WebSocket ownership, consume `AtlasMarketDataEngine`, preserve order/account contracts, and route chart rendering through `AtlasChartExperience` helpers.
- `atlas-x-pro/bootstrap.js` — load `realtime-market-chart.css` and expose stage-ready markers.
- `atlas-x-pro/styles.css` / `atlas-x-pro/mobile-final.css` — small compatibility adjustments only where existing layout contracts require them.
- `.github/workflows/atlas-x-pro-qa.yml` — add deterministic stage test and artifact; allow child PRs targeting `atlas-x-pro-terminal`.
- `atlas-x-pro/PROJECT-STATE.md` — record branch, gateway version, test runs, known risks, and deployment boundary.

---

### Task 1: Add failing deterministic Stage 1 browser tests

**Files:**
- Create: `qa/atlas-x-pro/realtime-market-chart.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

**Interfaces:**
- Consumes: Existing page at `/atlas-x-pro/?qa=1`.
- Produces: `qa-artifacts-pro/realtime-market-chart-report.json` and screenshots with deterministic checks.

- [ ] **Step 1: Write the failing browser test**

The test must inject a deterministic provider through `window.__ATLAS_MARKET_TEST_PROVIDER__` before page scripts run. It must expose delayed candle requests so generation ordering can be tested.

```js
await context.addInitScript(() => {
  const intervalMs = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
    '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
    '1d': 86_400_000, '1w': 604_800_000,
  };
  window.__ATLAS_MARKET_TEST_PROVIDER__ = {
    async candles({ symbol, interval, limit, signal }) {
      const delay = interval === '1m' ? 450 : interval === '30m' ? 280 : 40;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
      const step = intervalMs[interval];
      const end = Math.floor(Date.now() / step) * step;
      return Array.from({ length: limit }, (_, index) => {
        const open = 60_000 + index * 3;
        return {
          time: end - (limit - index) * step,
          closeTime: end - (limit - index - 1) * step - 1,
          open,
          high: open + 20,
          low: open - 15,
          close: open + 8,
          volume: 100 + index,
          quoteVolume: (100 + index) * (open + 8),
          trades: 50 + index,
          closed: index < limit - 1,
          provider: 'fixture',
        };
      });
    },
    async snapshot({ symbol }) {
      return {
        symbol,
        provider: 'fixture',
        serverTime: Date.now(),
        receivedAt: Date.now(),
        ticker: { price: 64_370.7, open: 62_830, high: 64_482.3, low: 63_772.6, volume: 566.51, quoteVolume: 36_430_300, change: 2.44 },
        book: { bids: [[64_370.7, 9.41]], asks: [[64_370.8, 0.27]], sequence: 1 },
        trades: [{ id: 'fixture-1', price: 64_370.7, qty: 0.01, time: Date.now(), side: 'buy' }],
      };
    },
    subscribe({ onEvent }) {
      const timer = setInterval(() => onEvent({
        type: 'ticker', provider: 'fixture', symbol: 'BTCUSDT', sequence: Date.now(),
        serverTime: Date.now(), receivedAt: Date.now(), data: { price: 64_370.7 + Math.random() },
      }), 250);
      return () => clearInterval(timer);
    },
  };
});
```

The assertions must verify:

```js
checks.engineReady = await page.evaluate(() => document.documentElement.dataset.marketDataEngine === 'ready');
checks.intervalSetComplete = await page.locator('[data-timeframe]').allTextContents().then(values =>
  ['1m','3m','5m','15m','30m','1H','2H','4H','6H','12H','1D','1W'].every(label => values.includes(label))
);

await page.locator('[data-timeframe="1m"]').click();
await page.locator('[data-timeframe="30m"]').click();
await page.locator('[data-timeframe="1d"]').click();
await page.waitForFunction(() => document.documentElement.dataset.activeMarketInterval === '1d');
checks.lastIntervalWins = await page.evaluate(() => window.AtlasMarketDataEngine?.getState().interval === '1d');
checks.intervalSpanMatches = await page.evaluate(() => {
  const state = window.AtlasMarketDataEngine?.getState();
  const candles = state?.candles || [];
  return candles.length > 10 && candles[1].time - candles[0].time === 86_400_000;
});

await page.locator('#chartCanvas').click({ position: { x: 160, y: 150 } });
checks.richCardVisible = await page.locator('#chartCandleDetail').isVisible();
checks.richCardComplete = await page.locator('#chartCandleDetail').evaluate(card =>
  ['开盘','最高','最低','收盘','涨跌额','涨跌幅','振幅','成交量','成交额','EMA10','EMA20','数据源'].every(text => card.textContent.includes(text))
);
await page.locator('#chartCanvas').click({ position: { x: 160, y: 150 } });
checks.sameCandleCancels = await page.locator('#chartCandleDetail').isHidden();

checks.extremaVisible = await page.locator('.chart-extrema-label').count() === 2;
checks.countdownVisible = await page.locator('#chartCountdown').isVisible();
checks.liveState = await page.locator('#marketConnectionState').getAttribute('data-state') === 'live';
```

- [ ] **Step 2: Add the test to the workflow**

```yaml
      - name: Verify realtime market and chart stage
        env:
          CHROME_BIN: /usr/bin/google-chrome
          ATLAS_VIEWPORT: ${{ matrix.viewport }}
        run: node qa/atlas-x-pro/realtime-market-chart.mjs
```

Add `qa-artifacts-pro/realtime-market-chart-report.json` to the artifact list and add `atlas-x-pro-terminal` to the workflow pull-request base branches.

- [ ] **Step 3: Run CI and verify the new test fails for missing engine/UI**

Expected failure markers:

```text
marketDataEngine !== ready
#chartCandleDetail not found
active interval generation assertions failed
```

- [ ] **Step 4: Commit**

```bash
git add qa/atlas-x-pro/realtime-market-chart.mjs .github/workflows/atlas-x-pro-qa.yml
git commit -m "test: define realtime market and chart acceptance"
```

---

### Task 2: Implement and deploy the public market gateway

**Files:**
- Create: `supabase/functions/atlas-market-gateway/index.ts`
- Create: `supabase/functions/atlas-market-gateway/deno.json`
- Create: `qa/atlas-x-pro/gateway-contract.mjs`

**Interfaces:**
- Consumes: Binance, OKX, and Bybit public REST endpoints.
- Produces: `GET /health`, `/markets`, `/snapshot`, `/candles`, and `/stream` with normalized schema version `atlas.market.v1`.

- [ ] **Step 1: Write gateway normalization contract tests**

Define fixture inputs for all three providers and assert the same normalized candle shape:

```js
{
  time: Number,
  closeTime: Number,
  open: Number,
  high: Number,
  low: Number,
  close: Number,
  volume: Number,
  quoteVolume: Number,
  trades: Number,
  closed: Boolean,
  provider: 'binance' | 'okx' | 'bybit'
}
```

Also assert symbol whitelist, interval whitelist, limit clamp `20..500`, and rejection of arbitrary proxy URLs.

- [ ] **Step 2: Implement the Edge Function**

Required constants:

```ts
const VERSION = 'atlas.market.v1';
const ALLOWED_ORIGINS = new Set([
  'https://zengyf006-ux.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);
const SYMBOLS = new Set(['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT']);
const INTERVALS = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']);
```

Provider adapters must expose:

```ts
type ProviderAdapter = {
  name: 'binance' | 'okx' | 'bybit';
  candles(symbol: string, interval: string, limit: number, signal: AbortSignal): Promise<NormalizedCandle[]>;
  snapshot(symbol: string, signal: AbortSignal): Promise<NormalizedSnapshot>;
};
```

Use a warm-instance health map:

```ts
const health = new Map<string, { latency: number; failures: number; lastSuccessAt: number }>();
```

Sort providers by `failures * 1000 + latency`, use a per-provider timeout of 1600ms, and require snapshot ticker/book/trades to come from the same provider.

`/stream` must return `text/event-stream`, send an initial `status`, then a normalized snapshot event every 1200ms, a current-candle event every 2400ms, a heartbeat every 10 seconds, and close after 45 seconds so clients reconnect. Abort upstream work on client disconnect.

- [ ] **Step 3: Apply security and resource controls**

- Reject methods other than `GET` and `OPTIONS`.
- Reject disallowed Origin with HTTP 403.
- Return CORS only for the approved origin.
- Limit requests to 120 per minute per forwarded IP in the warm instance.
- Limit SSE to 45 seconds.
- Do not accept upstream URLs from request parameters.
- Return `{ version, error: { code, message } }` without stack traces.

- [ ] **Step 4: Deploy to existing Supabase project**

Deploy project `vtcunypvhtudragsittb`, function name `atlas-market-gateway`, with `verify_jwt=false` because it implements explicit public-origin and parameter controls and serves public data only.

- [ ] **Step 5: Verify deployed endpoints**

Expected checks:

```text
/health -> 200, version atlas.market.v1
/candles?symbol=BTCUSDT&interval=1m&limit=30 -> 30 candles, 60000ms spacing
/candles?symbol=BTCUSDT&interval=1d&limit=30 -> 30 candles, 86400000ms spacing
/snapshot?symbol=BTCUSDT -> provider + ticker + book + trades + timestamps
```

- [ ] **Step 6: Commit gateway source and contract tests**

```bash
git add supabase/functions/atlas-market-gateway qa/atlas-x-pro/gateway-contract.mjs
git commit -m "feat: add resilient public market gateway"
```

---

### Task 3: Build the generation-safe client market-data engine

**Files:**
- Create: `atlas-x-pro/market-data-engine.js`
- Test: `qa/atlas-x-pro/realtime-market-chart.mjs`

**Interfaces:**
- Consumes: gateway URL, optional deterministic test provider, native WebSocket/EventSource/fetch.
- Produces: `window.AtlasMarketDataEngine`.

Exact public interface:

```ts
AtlasMarketDataEngine.start({ symbol: string, interval: string }): Promise<void>
AtlasMarketDataEngine.switchSession({ symbol?: string, interval?: string }): Promise<void>
AtlasMarketDataEngine.stop(): void
AtlasMarketDataEngine.getState(): Readonly<MarketState>
AtlasMarketDataEngine.subscribe(listener: (state: MarketState, event: MarketEvent) => void): () => void
AtlasMarketDataEngine.intervalMs(interval: string): number
```

`MarketState` must include:

```js
{
  version: 'atlas.market.client.v1',
  sessionId, requestGeneration, symbol, interval,
  connectionState: 'booting' | 'live' | 'reconnecting' | 'stale' | 'offline',
  provider, lastServerTime, lastReceivedAt, latencyMs, staleForMs,
  ticker, book, trades, candles, source: 'cache' | 'gateway' | 'direct' | 'fixture'
}
```

- [ ] **Step 1: Implement interval metadata and validation**

```js
const INTERVAL_MS = Object.freeze({
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
  '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
  '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
  '1d': 86_400_000, '1w': 604_800_000,
});
```

Reject unsupported intervals instead of silently falling back.

- [ ] **Step 2: Add IndexedDB cache**

Database `atlas-x-market-cache`, version `1`, stores:

```js
{ key: `${symbol}:${interval}`, candles, snapshot, savedAt, version: 1 }
```

Render cache immediately if valid; mark source `cache` and connection state `booting` or `stale`, never `live`.

- [ ] **Step 3: Implement generation and cancellation**

Each session switch must:

```js
state.requestGeneration += 1;
const generation = state.requestGeneration;
activeAbortController?.abort();
closeRealtime();
clearFreshnessTimers();
```

Before every state write from async work:

```js
if (generation !== state.requestGeneration) return;
```

- [ ] **Step 4: Implement snapshot/candles bootstrap**

Run snapshot and candles in parallel. Preserve old candles while loading. Atomically replace only after validating:

```js
candles.length >= 20 && candles.every((c, i) => i === 0 || c.time - candles[i - 1].time === intervalMs)
```

Allow the final gap to be no larger than one interval plus 5 seconds.

- [ ] **Step 5: Implement direct WebSocket fast path**

Use the existing official Binance combined stream only after gateway bootstrap. Normalize `ticker`, `depth20@100ms`, `aggTrade`, and `kline_interval` into one session. If no valid message arrives within 2200ms, close direct WS and start gateway SSE.

- [ ] **Step 6: Implement SSE fallback and freshness states**

- `live`: last event age ≤ 3000ms.
- `reconnecting`: age > 3000ms or stream reconnecting.
- `stale`: age > 10_000ms while cached/last data remains visible.
- `offline`: gateway and direct stream failed and no refresh succeeds.

Reconnect with capped backoff `[500, 1000, 2000, 4000, 8000]`.

- [ ] **Step 7: Expose deterministic provider hook only before engine construction**

```js
const provider = window.__ATLAS_MARKET_TEST_PROVIDER__ || createProductionProvider();
```

The production page must not expose a UI toggle to fixture data.

- [ ] **Step 8: Run Stage 1 tests and commit**

```bash
node qa/atlas-x-pro/realtime-market-chart.mjs
```

Expected: interval and generation checks pass; chart UI checks may still fail until Task 5.

```bash
git add atlas-x-pro/market-data-engine.js
git commit -m "feat: add generation-safe market data engine"
```

---

### Task 4: Integrate engine into the terminal without breaking simulated trading

**Files:**
- Modify: `atlas-x-pro/index.html`
- Modify: `atlas-x-pro/app.js`
- Modify: `atlas-x-pro/bootstrap.js`

**Interfaces:**
- Consumes: `AtlasMarketDataEngine` state and events.
- Produces: existing DOM IDs and localStorage contracts unchanged for orders, balances, positions, fills, risk, OCO, exits, reservations, audit, and alerts.

- [ ] **Step 1: Load modules in the correct order**

At the bottom of `index.html`:

```html
<script src="./native-network.js"></script>
<script src="./market-data-engine.js"></script>
<script src="./chart-experience.js"></script>
<script src="./app.js"></script>
```

Remove `network-adapter.js` and `network-router-v2.js` from the production path after the engine fully replaces them; retain files temporarily only for rollback until Stage 1 is accepted.

- [ ] **Step 2: Expand timeframe controls**

Use exact `data-timeframe` values:

```html
1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d 1w
```

Labels may be `1m`, `3m`, `5m`, `15m`, `30m`, `1H`, `2H`, `4H`, `6H`, `12H`, `1D`, `1W`.

- [ ] **Step 3: Replace app network ownership**

Delete or stop calling:

```js
fetchInitialCandles
connectActiveStream
connectMarketStream
startDemoFeed
```

Subscribe once:

```js
const unsubscribeMarket = AtlasMarketDataEngine.subscribe((marketState, event) => {
  applyMarketState(marketState, event);
});
await AtlasMarketDataEngine.start({ symbol: state.activeSymbol, interval: state.timeframe });
```

`applyMarketState` must update existing market models, candles, order book, trades, active price UI, open-order matching, positions, and account metrics in one animation-frame batch.

- [ ] **Step 4: Preserve all trading invariants**

- `atlasX.pro.v1` remains the core account key.
- Market engine never writes cash, positions, orders, fills, OCO, exits, reservations, or audit storage.
- Order matching uses the engine ticker price.
- Order ticket estimate, order book mid price, mobile bar price, and chart latest line use the same state revision.

- [ ] **Step 5: Update interval and symbol switching**

```js
async function switchMarketSession(next) {
  state.pointerIndex = null;
  state.chartOffset = 0;
  state.selectedBookPrice = null;
  setChartLoadingState('switching');
  await AtlasMarketDataEngine.switchSession(next);
}
```

No blanking `state.candles=[]`; keep previous chart dimmed until the new generation commits.

- [ ] **Step 6: Commit**

```bash
git add atlas-x-pro/index.html atlas-x-pro/app.js atlas-x-pro/bootstrap.js
git commit -m "refactor: consume unified realtime market sessions"
```

---

### Task 5: Implement the professional K-line interaction layer

**Files:**
- Create: `atlas-x-pro/chart-experience.js`
- Create: `atlas-x-pro/realtime-market-chart.css`
- Modify: `atlas-x-pro/index.html`
- Modify: `atlas-x-pro/app.js`

**Interfaces:**
- Consumes: normalized candles, interval, provider, freshness state, canvas geometry.
- Produces: `window.AtlasChartExperience` helpers and DOM projection.

Exact public interface:

```js
AtlasChartExperience.intervalMs(interval)
AtlasChartExperience.metrics(candles, index)
AtlasChartExperience.select(index, reason)
AtlasChartExperience.clear(reason)
AtlasChartExperience.getSelection()
AtlasChartExperience.countdown(candle, interval, now)
AtlasChartExperience.extrema(candles)
```

- [ ] **Step 1: Add rich detail markup**

Add `#chartCandleDetail` with an explicit close button and fields for time, interval, O/H/L/C, change amount, change percent, amplitude, volume, quote volume, EMA10, EMA20, closed/open status, provider, and received time.

- [ ] **Step 2: Implement metric calculations**

```js
changeAmount = candle.close - candle.open;
changePercent = changeAmount / Math.max(Math.abs(candle.open), Number.EPSILON) * 100;
amplitude = (candle.high - candle.low) / Math.max(Math.abs(candle.open), Number.EPSILON) * 100;
quoteVolume = candle.quoteVolume || candle.volume * candle.close;
```

EMA must use the same visible-series calculation as the plotted line.

- [ ] **Step 3: Implement selection state machine**

- First tap/click selects nearest candle.
- Same candle tap/click clears.
- Clicking outside the candle plotting area clears.
- Close button clears.
- `Escape` clears.
- Interval switch, symbol switch, chart reset, drag start, and fullscreen transition clear.
- Pointer hover on desktop may preview without locking; click locks.
- Mobile long-press and tap share the same selected-index model.

- [ ] **Step 4: Draw professional overlays**

During chart render:

```js
const high = AtlasChartExperience.extrema(candles).high;
const low = AtlasChartExperience.extrema(candles).low;
```

Draw short horizontal leader lines and labels at the exact candle x/y positions. Expose matching `.chart-extrema-label[data-kind="high|low"]` DOM labels for accessibility and testing.

Add the latest-price line, live price label, and `#chartCountdown` based on the final candle close time. Countdown must show `00:00` at expiry and then advance when the next candle arrives.

- [ ] **Step 5: Add non-blocking loading/freshness UI**

- Cached chart remains visible with `data-loading="switching"` and 0.55 opacity.
- `#marketConnectionState` displays `实时`, `重连中`, `数据已过期`, or `离线`.
- `#marketDataAge` displays event age.
- `#chartLoading` becomes a compact status badge, not a full blocking overlay after cache exists.
- Add `#chartGoLatest` only when `chartOffset > 0`.

- [ ] **Step 6: Add mobile and desktop CSS**

Desktop: rich values remain in the OHLC strip, with a compact floating card only when locked.

Mobile: a 2-column edge card with max width `min(290px, calc(100vw - 24px))`, internal scrolling disabled, and no overlap with the bottom trade bar.

Interactive targets must be at least 40px; explicit close is 44px on mobile.

- [ ] **Step 7: Run Stage 1 test and commit**

```bash
node qa/atlas-x-pro/realtime-market-chart.mjs
```

Expected: all new Stage 1 checks pass in all four viewports.

```bash
git add atlas-x-pro/chart-experience.js atlas-x-pro/realtime-market-chart.css atlas-x-pro/index.html atlas-x-pro/app.js
git commit -m "feat: deliver professional K-line interaction and overlays"
```

---

### Task 6: Add real-network smoke without weakening deterministic CI

**Files:**
- Create: `qa/atlas-x-pro/gateway-smoke.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

**Interfaces:**
- Consumes: deployed gateway base URL.
- Produces: `qa-artifacts-pro/gateway-smoke-report.json`.

- [ ] **Step 1: Implement smoke checks**

```js
const base = process.env.ATLAS_MARKET_GATEWAY;
const health = await fetchJson(`${base}/health`);
const oneMinute = await fetchJson(`${base}/candles?symbol=BTCUSDT&interval=1m&limit=30`);
const oneDay = await fetchJson(`${base}/candles?symbol=BTCUSDT&interval=1d&limit=30`);
const first = await fetchJson(`${base}/snapshot?symbol=BTCUSDT`);
await new Promise(resolve => setTimeout(resolve, 1200));
const second = await fetchJson(`${base}/snapshot?symbol=BTCUSDT`);
```

Assert:

- health version is `atlas.market.v1`.
- 1m spacing is `60_000`.
- 1d spacing is `86_400_000`.
- provider is one of `binance|okx|bybit`.
- ticker price is positive.
- snapshot timestamps are present.
- second `receivedAt` is newer than first.

Do not silently replace failures with fixture data. Report external failure explicitly.

- [ ] **Step 2: Add separate workflow job**

The deterministic four-view job remains required. Add a single `gateway-smoke` job with `continue-on-error: false` after the deployed gateway is stable. Use repository variable `ATLAS_MARKET_GATEWAY` or inline the public function URL if no secret is required.

- [ ] **Step 3: Commit**

```bash
git add qa/atlas-x-pro/gateway-smoke.mjs .github/workflows/atlas-x-pro-qa.yml
git commit -m "test: add real market gateway smoke gate"
```

---

### Task 7: Full regression, artifact review, and project state

**Files:**
- Modify: `atlas-x-pro/PROJECT-STATE.md`

**Interfaces:**
- Consumes: completed implementation and all CI artifacts.
- Produces: auditable release candidate record.

- [ ] **Step 1: Run the entire four-view acceptance matrix**

Every existing step must pass, including orders, balances, positions, audit, OCO, exits, reservations, alerts, screener, intelligence, mobile account tools, and advanced visuals.

- [ ] **Step 2: Review critical screenshots manually**

Review at minimum for each viewport:

- chart with no selection,
- chart with rich candle detail,
- 1m and 1d interval states,
- stale/reconnecting state,
- high/low labels,
- mobile bottom trade bar and chart card overlap,
- desktop full workspace density.

Reject screenshots with tofu text, clipped labels, overlapping extrema, stale data marked live, unreadable numbers, or excessive blocking loaders.

- [ ] **Step 3: Measure and record actual performance**

Record:

- cached content visible time,
- fresh snapshot time,
- stream live time,
- interval switch feedback time,
- interval switch commit time,
- stale transition time.

Do not claim targets that were not measured.

- [ ] **Step 4: Update project state**

Record exact start SHA, end SHA, gateway function version, deployed gateway URL, changed files, deterministic run ID, gateway smoke result, four-view screenshot review, known risks, deployment status, rollback point, and the unique next task: Stage 2 mobile terminal and order-book restructuring.

- [ ] **Step 5: Commit documentation**

```bash
git add atlas-x-pro/PROJECT-STATE.md
git commit -m "docs: record realtime market and chart stage result"
```

---

### Task 8: Merge and deploy only after all gates pass

**Files:**
- No additional runtime files unless verification finds a defect.

- [ ] **Step 1: Confirm child branch relation**

`atlas-x-realtime-chart-stage1` must be a clean fast-forward into `atlas-x-pro-terminal` or merged through its child PR without unrelated conflict.

- [ ] **Step 2: Re-run final CI on the resulting `atlas-x-pro-terminal` HEAD**

Do not reuse child-branch evidence after resolving conflicts or after unrelated runtime changes.

- [ ] **Step 3: Confirm development branch is a clean fast-forward from `main`**

If diverged, stop and reconcile without force push.

- [ ] **Step 4: Preserve rollback reference**

Create a rollback branch or tag pointing to the current production commit before deployment.

- [ ] **Step 5: Fast-forward `main` and verify production**

Verify the production title, realtime status, 1m/30m/1d interval differences, rich candle card cancellation, high/low labels, current price updates, and no blank loader loop.

- [ ] **Step 6: Final state update**

Record the actual production commit, rollback ref, Pages URL, and production verification evidence.

---

## Plan Self-Review

- Spec coverage: gateway, three providers, client generations, cache, realtime freshness, correct intervals, selection cancellation, rich candle data, extrema, countdown, deterministic CI, real-network smoke, four-view visual review, deployment, and rollback are each mapped to a task.
- Placeholder scan: no TBD/TODO/"implement later" requirements remain.
- Type consistency: provider, candle, snapshot, engine state, and public API names are defined once and reused consistently.
- Scope: this plan intentionally implements only Stage 1. Mobile terminal restructuring, expanded indicators, professional order-entry expansion, and simulated perpetuals remain Stage 2/3 work and are not mixed into this blocking correctness stage.
