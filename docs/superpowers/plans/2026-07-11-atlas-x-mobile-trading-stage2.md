# ATLAS X Stage 2 Mobile Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the mobile trading path around a compact chart-first hierarchy, a genuinely aggregated order book, and four professional simulated order types without creating a second financial ledger.

**Architecture:** Add three focused Stage 2 modules loaded after the existing terminal quality stack. `pro-order-book-stage2.js` derives display levels only from `AtlasMarketDataEngine`; `order-entry-stage2.js` drives estimates and mobile fields through a minimal `AtlasCoreTrading` bridge; `mobile-terminal-stage2.js` owns mobile layout and fullscreen state. Existing storage and core execution remain authoritative.

**Tech Stack:** Vanilla JavaScript, CSS Grid, Canvas-based existing chart, localStorage compatibility, Playwright Core, GitHub Actions.

## Global Constraints

- Do not connect real funds, deposits, withdrawals, exchange accounts, API keys, secrets, private keys, or seed phrases.
- Do not create a second balance, position, order, fill, OCO, exit, reservation, or audit ledger.
- Do not use iframe or reuse old V7–V14 page structures.
- Mobile is an independent product flow; desktop must remain visually unchanged.
- Main controls on 390 × 844 and 430 × 932 must be at least 40px high.
- Do not weaken, skip, or delete existing assertions to obtain green CI.
- Any runtime HEAD change requires gateway contract, real-network smoke, four-view acceptance, visual QA, and human screenshot review.

---

### Task 1: Core order-type compatibility and bridge

**Files:**
- Modify: `atlas-x-pro/app.js`
- Test: `qa/atlas-x-pro/order-entry-stage2.mjs`

**Interfaces:**
- Produces: `window.AtlasCoreTrading.getState()`, `getMarket()`, `setOrderType(type)`, `setSide(side)`, `syncOrderFields(source)`, `submitOrder()`, `renderOrderTicket()`, `matchOpenOrders()`.
- Produces normalized order types: `market | limit | stop_market | stop_limit`.
- Consumes: existing `atlasX.pro.v1` state and existing fill/order rendering functions.

- [ ] **Step 1: Add a failing order-type test**

Create `qa/atlas-x-pro/order-entry-stage2.mjs` with deterministic seeded state. Assert that `window.AtlasCoreTrading` exists, old `stop` values normalize to `stop_market`, and the four accepted type values survive `setOrderType()`.

Expected first run: FAIL because `AtlasCoreTrading` and the two new order types do not exist.

- [ ] **Step 2: Extend state loading and rendering**

In `app.js`, replace the old type whitelist with:

```js
const normalizeOrderType = value => ({ stop: 'stop_market' })[value]
  || (['market', 'limit', 'stop_market', 'stop_limit'].includes(value) ? value : 'market');
```

Use `normalizeOrderType(saved.orderType)` during load. Show the price field for `limit` and `stop_limit`; show the trigger field for `stop_market` and `stop_limit`.

- [ ] **Step 3: Implement stop-market and stop-limit matching**

Use these predicates:

```js
const triggerReached = order.side === 'buy'
  ? price >= order.triggerPrice
  : price <= order.triggerPrice;
const limitReached = order.side === 'buy'
  ? price <= order.price
  : price >= order.price;
```

For `stop_limit`, set `order.triggeredAt` and `order.status = 'triggered'` when the trigger is reached, then wait for `limitReached`. For `stop_market`, execute at current market price immediately after trigger. Legacy `stop` is handled as `stop_market`.

- [ ] **Step 4: Expose a frozen bridge**

At the end of `app.js`, expose functions without exposing mutable arrays:

```js
window.AtlasCoreTrading = Object.freeze({
  getState: () => structuredClone({
    activeSymbol: state.activeSymbol,
    side: state.side,
    orderType: state.orderType,
    cash: state.cash,
    positions: state.positions,
    orders: state.orders,
    history: state.history,
  }),
  getMarket: () => structuredClone(market()),
  setOrderType: type => { state.orderType = normalizeOrderType(type); renderOrderTicket(); saveState(); },
  setSide: side => { state.side = side === 'sell' ? 'sell' : 'buy'; renderOrderTicket(); saveState(); },
  syncOrderFields,
  submitOrder,
  renderOrderTicket,
  matchOpenOrders,
});
```

- [ ] **Step 5: Run the focused test and commit**

Run through the Stage 2 workflow command for both mobile viewports. Expected: bridge, normalization and lifecycle assertions PASS; other Stage 2 tests are not yet present.

Commit: `feat: extend core simulated order types`

---

### Task 2: Professional aggregated order book

**Files:**
- Create: `atlas-x-pro/pro-order-book-stage2.js`
- Create: `qa/atlas-x-pro/order-book-stage2.mjs`
- Modify: `atlas-x-pro/bootstrap.js`

**Interfaces:**
- Consumes: `AtlasMarketDataEngine.getState().book`, existing `#asksRows`, `#bidsRows`, `#pricePrecision`, `[data-book-mode]`.
- Produces: `window.AtlasOrderBookStage2.getSnapshot()`, `setAggregation(step)`, `setMode(mode)`.
- Persists only `{ aggregation, mode }` in `atlasX.pro.mobileStage2.v1`.

- [ ] **Step 1: Write aggregation contract tests**

Test a fixed raw book with duplicate buckets. Assert:

```js
buyBucket = Math.floor(price / step) * step;
sellBucket = Math.ceil(price / step) * step;
```

Assert total quantity is conserved, cumulative quantity is monotonic, asks are ascending before display reversal, bids are descending, and three modes render correctly.

Expected first run: FAIL because the Stage 2 module is absent.

- [ ] **Step 2: Implement raw-level normalization**

Accept both formats:

```js
const normalizeLevel = level => Array.isArray(level)
  ? { price: Number(level[0]), quantity: Number(level[1]) }
  : { price: Number(level.price), quantity: Number(level.quantity ?? level.qty) };
```

Discard non-finite, zero, or negative values.

- [ ] **Step 3: Implement aggregation and cumulative totals**

Aggregate by integer bucket keys derived from `Math.round(bucket / step)` to avoid floating-point map fragmentation. Reconstruct numeric prices from the key and step. Calculate cumulative totals after sorting.

- [ ] **Step 4: Render stable three-column rows**

Each row must contain price, quantity, cumulative quantity and a side-specific depth percentage. Preserve `data-book-price` so existing price selection continues to work.

- [ ] **Step 5: Subscribe without render loops**

Subscribe to `AtlasMarketDataEngine`; render only when book revision, symbol, aggregation, or mode changes. Use a render guard if observing the existing DOM. Mark `document.documentElement.dataset.orderBookStage2 = 'ready'`.

- [ ] **Step 6: Load from bootstrap and run tests**

Load after `realtime-market-integration`/quality modules and before the mobile shell. Expected: all order-book tests PASS on 390 and 430, existing depth chart and book selection tests remain green.

Commit: `feat: add aggregated professional order book`

---

### Task 3: Four-type order entry and depth estimates

**Files:**
- Create: `atlas-x-pro/order-entry-stage2.js`
- Create: `atlas-x-pro/order-entry-stage2.css`
- Modify: `atlas-x-pro/bootstrap.js`
- Extend: `qa/atlas-x-pro/order-entry-stage2.mjs`

**Interfaces:**
- Consumes: `AtlasCoreTrading`, `AtlasMarketDataEngine`, existing order inputs and submit button.
- Produces: `window.AtlasOrderEntryStage2.getEstimate()`, `setUnitMode(mode)`, `setOrderType(type)`.
- Persists only `unitMode` and last order type in `atlasX.pro.mobileStage2.v1`.

- [ ] **Step 1: Add failing estimate tests**

Use a deterministic asks book. For a buy quantity spanning two levels, assert:

```js
vwap = totalNotional / filledQuantity;
slippageBps = (vwap - referencePrice) / referencePrice * 10000;
fee = totalNotional * 0.0008;
coverage = filledQuantity / requestedQuantity;
```

Mirror the sign for sells. Assert no financial ledger changes occur while calculating estimates.

- [ ] **Step 2: Mount unit and order-type controls**

Add segmented controls without deleting existing fields:

```html
<div class="stage2-unit-switch">
  <button data-entry-unit="quantity">按数量</button>
  <button data-entry-unit="total">按金额</button>
</div>
<div class="stage2-order-types">
  <button data-stage2-order-type="market">市价</button>
  <button data-stage2-order-type="limit">限价</button>
  <button data-stage2-order-type="stop_market">止损市价</button>
  <button data-stage2-order-type="stop_limit">止损限价</button>
</div>
```

The inactive legacy input remains in the DOM and receives synchronized values.

- [ ] **Step 3: Implement depth walking**

For buys, consume asks from best to worst; for sells, consume bids from best to worst. Return `{ requestedQuantity, filledQuantity, unfilledQuantity, notional, vwap, referencePrice, slippageBps, slippageCost, fee, coverage }`.

- [ ] **Step 4: Render explicit estimate states**

- Market: VWAP, fee, slippage, coverage.
- Limit/stop-limit: entered limit price, fee, slippage `--`, condition text.
- Stop-market: current-depth estimate labeled “触发时仅供参考”.
- Empty depth: “盘口深度不足”, no invented VWAP.

- [ ] **Step 5: Connect submit path to core bridge**

Stage 2 controls call `AtlasCoreTrading.setOrderType()` and existing `AtlasCoreTrading.submitOrder()`. Do not write core arrays directly.

- [ ] **Step 6: Run focused tests and commit**

Expected: four order types, quantity/amount synchronization, estimate math, ledger immutability and mobile touch targets PASS.

Commit: `feat: add professional mobile order entry`

---

### Task 4: Mobile chart-first shell and lightweight candle context

**Files:**
- Create: `atlas-x-pro/mobile-terminal-stage2.js`
- Create: `atlas-x-pro/mobile-terminal-stage2.css`
- Modify: `atlas-x-pro/bootstrap.js`
- Create: `qa/atlas-x-pro/mobile-trading-stage2.mjs`

**Interfaces:**
- Consumes: existing mobile market head, quick stats, chart panel, order-book panel, account panel, mobile trade bar, candle-detail DOM.
- Produces: `window.AtlasMobileStage2.openFullscreenChart()`, `closeFullscreenChart()`, `openContext(name)`.

- [ ] **Step 1: Write failing hierarchy and fullscreen tests**

On 390 and 430, assert the visual order of market head, quick stats, compact tools, chart, context strip, and trade bar. Assert fullscreen locks body scroll, keeps chart visible, and restores state after close.

- [ ] **Step 2: Mount compact chart controls**

Create one horizontal period strip and one tools button. Keep all existing period buttons in the DOM; move secondary indicators/drawing controls into a bottom tool sheet.

- [ ] **Step 3: Replace the mobile candle overlay presentation**

Do not remove the detailed data source. On mobile, project selected candle values into a two-line compact strip. Add a “更多” button that reveals the existing full detail as a bottom layer. Desktop detail remains unchanged.

- [ ] **Step 4: Implement fullscreen state**

Use `body.mobile-chart-fullscreen`, store previous scroll position, close on explicit button and Escape, and call the existing chart resize/draw path after each transition.

- [ ] **Step 5: Add contextual tabs**

Provide `盘口`, `逐笔`, and `持仓` summary tabs below the chart. Opening a tab switches the existing mobile panel; no cloned data tables.

- [ ] **Step 6: Run focused tests and commit**

Expected: both mobile viewports pass hierarchy, fullscreen, compact candle, contextual navigation, touch target and overflow checks.

Commit: `feat: rebuild mobile chart-first trading shell`

---

### Task 5: Integrated mobile styling and accessibility

**Files:**
- Modify: `atlas-x-pro/mobile-terminal-stage2.css`
- Modify: `atlas-x-pro/order-entry-stage2.css`
- Modify: `atlas-x-pro/pro-order-book-stage2.js` only if accessibility attributes are missing
- Extend: `qa/atlas-x-pro/mobile-trading-stage2.mjs`

**Interfaces:**
- Produces no new data interface.

- [ ] **Step 1: Add 390/430 geometry assertions**

Assert no horizontal overflow, primary controls ≥40px, bottom bar clears safe area, chart has a meaningful minimum height, and no fixed layer covers the buy/sell buttons.

- [ ] **Step 2: Apply final responsive geometry**

Use `clamp()`, safe-area insets and grid minmax. Avoid viewport-specific hard-coded coordinates except the existing 390 breakpoint for compact spacing.

- [ ] **Step 3: Add accessibility state**

Use `aria-pressed` for mode/type buttons, `aria-expanded` for sheets, meaningful labels for fullscreen and context tabs, and focus restoration after closing sheets.

- [ ] **Step 4: Run mobile-focused tests and commit**

Expected: both mobile viewports pass all geometry and accessibility assertions.

Commit: `style: finalize Stage 2 mobile trading layout`

---

### Task 6: CI integration and full regression

**Files:**
- Modify: `.github/workflows/atlas-x-pro-qa.yml`
- Modify: `atlas-x-pro/PROJECT-STATE.md` after verification only

**Interfaces:**
- Adds workflow steps for the three Stage 2 test files.

- [ ] **Step 1: Add Stage 2 workflow steps**

Run `mobile-trading-stage2.mjs`, `order-book-stage2.mjs`, and `order-entry-stage2.mjs` after the existing mobile/account checks and before artifact upload. Desktop scripts must return explicit non-applicable success rather than exercising mobile-only assertions.

- [ ] **Step 2: Run red/green focused cycles**

Each implementation commit must first produce a failing Stage 2 step, then a passing focused step. Do not wait for the whole workflow to discover syntax errors.

- [ ] **Step 3: Run the complete matrix**

Required final evidence:

- Gateway contract PASS
- Real-network gateway smoke PASS
- 390 × 844 complete acceptance PASS
- 430 × 932 complete acceptance PASS
- 1440 × 900 complete acceptance PASS
- 1920 × 1080 complete acceptance PASS
- Visual QA PASS

- [ ] **Step 4: Human screenshot review**

Review at minimum mobile main, fullscreen chart, order book, order sheet, candle context, account/audit and desktop main. Reject white screens, tofu text, overlapping fixed layers, truncated controls or desktop regressions.

- [ ] **Step 5: Update persistent state and commit**

Record exact runtime HEAD, final verified HEAD, workflow run IDs, screenshots reviewed, remaining risks, rollback branch and next phase. A docs-only state commit may reuse the exact runtime evidence.

Commit: `docs: record Stage 2 mobile trading completion`

---

### Task 7: Safe integration and deployment

**Files:**
- No runtime file changes.

**Interfaces:**
- Integrates `atlas-x-mobile-trading-stage2` into `atlas-x-pro-terminal`, then deploys by non-forced fast-forward only.

- [ ] **Step 1: Verify branch ancestry**

`atlas-x-mobile-trading-stage2` must be ahead of and not behind `atlas-x-pro-terminal`. If diverged, reconcile normally; never force.

- [ ] **Step 2: Save a development rollback branch**

Create `rollback/atlas-x-pro-terminal-before-stage2-20260711` from the exact pre-merge development HEAD.

- [ ] **Step 3: Merge the Stage 2 PR and re-run full validation**

Do not reuse feature-branch evidence after merge. The merged development HEAD must receive a fresh complete matrix and visual QA.

- [ ] **Step 4: Save a production rollback branch**

Create a unique rollback branch from current `main` immediately before deployment.

- [ ] **Step 5: Deploy without force**

Update `main` only when it is an ancestor of the validated development HEAD. Verify `main` and `atlas-x-pro-terminal` are identical afterward.

- [ ] **Step 6: Update the state file on both branches**

Fast-forward the docs-only state record to production and verify identical refs.
