# ATLAS X Pro Simulated Perpetual and Mobile Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete USDT-margined simulated perpetual contract engine and replace the fragmented mobile trading experience with a professional, auditable, cross-device workflow.

**Architecture:** Keep the existing spot ledger unchanged. Add an isolated event-oriented perpetual ledger with separate risk, order, funding, controller, audit, and UI modules. The existing market-data engine supplies last/index/mark inputs; the asset overview uses read-only aggregation rather than merging ledgers.

**Tech Stack:** Vanilla JavaScript, CSS, localStorage/IndexedDB, Playwright Core, GitHub Actions, Supabase Edge Functions, existing ATLAS X public market gateway.

## Global Constraints

- Simulation only; no real funds, deposits, withdrawals, exchange accounts, API keys, secrets, private keys, or seed phrases.
- Do not modify production directly; work only on `atlas-x-sim-perps-stage2` until all gates pass.
- Do not change the existing spot ledger schema or let perpetual liquidation modify spot balances.
- Do not label random, derived, stale, or cached values as real-time official exchange data.
- Every runtime HEAD change requires gateway smoke, four-view acceptance, console/page-error checks, and screenshot review.
- Mobile primary touch targets must be at least 42px; core long/short buttons must be at least 48px.
- Do not pass by deleting assertions, skipping checks, or relaxing financial invariants.

---

## File Map

### New runtime modules

- `atlas-x-pro/perpetual-ledger.js` — schema, migration, serialized writes, immutable audit IDs.
- `atlas-x-pro/perpetual-risk-engine.js` — notional, PnL, margin, risk tier, liquidation and bankruptcy calculations.
- `atlas-x-pro/perpetual-order-engine.js` — validation, reservation, order state machine, fills and position updates.
- `atlas-x-pro/perpetual-funding-engine.js` — funding source, countdown, settlement and offline catch-up.
- `atlas-x-pro/perpetual-controller.js` — market session integration and lifecycle orchestration.
- `atlas-x-pro/perpetual-trading-ui.js` — desktop/mobile perpetual views and interactions.
- `atlas-x-pro/perpetual-trading.css` — perpetual ticket, positions, orders, risk and audit styling.
- `atlas-x-pro/mobile-trading-shell.js` — mobile chart/book/trade/account hierarchy and drawers.
- `atlas-x-pro/mobile-trading-shell.css` — mobile layout, touch targets and safe-area handling.
- `atlas-x-pro/orderbook-pro.js` — precision aggregation and one-sided/two-sided rendering.

### New tests

- `qa/atlas-x-pro/perpetual-ledger.mjs`
- `qa/atlas-x-pro/perpetual-risk-engine.mjs`
- `qa/atlas-x-pro/perpetual-order-engine.mjs`
- `qa/atlas-x-pro/perpetual-funding.mjs`
- `qa/atlas-x-pro/perpetual-ui.mjs`
- `qa/atlas-x-pro/mobile-trading-stage2.mjs`
- `qa/atlas-x-pro/orderbook-pro.mjs`

### Existing files to modify

- `atlas-x-pro/bootstrap.js`
- `atlas-x-pro/index.html`
- `atlas-x-pro/market-data-engine.js`
- `atlas-x-pro/realtime-market-integration.js`
- `atlas-x-pro/order-execution-audit.js`
- `atlas-x-pro/PROJECT-STATE.md`
- `.github/workflows/atlas-x-pro-qa.yml`

---

## Task 1: Perpetual Ledger and Migration

**Files:**
- Create: `atlas-x-pro/perpetual-ledger.js`
- Test: `qa/atlas-x-pro/perpetual-ledger.mjs`

**Interfaces:**
- Produces: `window.AtlasPerpetualLedger`
- Methods: `getState()`, `transact(label, mutator)`, `reset()`, `nextId(prefix)`, `appendAudit(event)`
- Storage key: `atlasX.pro.perpetual.v1`

- [ ] **Step 1: Write the failing ledger test**

Test must seed an invalid/old ledger, load the page, and assert:

```js
const state = await page.evaluate(() => window.AtlasPerpetualLedger.getState());
assert.equal(state.version, 1);
assert.equal(state.account.positionMode, 'one_way');
assert.equal(state.account.walletBalance, 100000);
assert.deepEqual(state.positions, []);
assert.deepEqual(state.orders, []);
```

It must also call two concurrent `transact()` operations and assert both audit events survive without duplicate IDs.

- [ ] **Step 2: Run the test and confirm red**

Run:

```bash
node qa/atlas-x-pro/perpetual-ledger.mjs
```

Expected: FAIL because `window.AtlasPerpetualLedger` is undefined.

- [ ] **Step 3: Implement the ledger**

Implement normalized defaults:

```js
const DEFAULT_STATE = {
  version: 1,
  account: {
    walletBalance: 100000,
    realizedPnl: 0,
    feesPaid: 0,
    fundingPaid: 0,
    positionMode: 'one_way'
  },
  preferences: {
    marginModeBySymbol: {},
    leverageBySymbol: {},
    orderDefaults: {}
  },
  positions: [],
  orders: [],
  fills: [],
  fundingEvents: [],
  liquidationEvents: [],
  auditEvents: [],
  nextId: 1
};
```

Serialize all mutations through a promise queue and write a backup key before replacing corrupted data.

- [ ] **Step 4: Run ledger test and existing spot smoke**

```bash
node qa/atlas-x-pro/perpetual-ledger.mjs
node qa/atlas-x-pro/capture.mjs
```

Expected: PASS; spot ledger remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/perpetual-ledger.js qa/atlas-x-pro/perpetual-ledger.mjs
git commit -m "feat: add isolated perpetual ledger"
```

---

## Task 2: Perpetual Risk Engine

**Files:**
- Create: `atlas-x-pro/perpetual-risk-engine.js`
- Test: `qa/atlas-x-pro/perpetual-risk-engine.mjs`

**Interfaces:**
- Produces: `window.AtlasPerpetualRisk`
- Methods: `getTier(symbol, notional)`, `calculatePosition(input)`, `calculateAccount(input)`, `calculateLiquidationPrice(input)`, `canOpen(input)`

- [ ] **Step 1: Write failing deterministic math tests**

Cover:

```js
longPnl = qty * (mark - entry);
shortPnl = qty * (entry - mark);
initialMargin = notional / leverage;
maintenanceMargin = notional * tier.maintenanceRate + tier.maintenanceAmount;
```

Assertions must include long/short direction, weighted entry, cross/isolated equity, leverage tier cap, liquidation threshold and no NaN/Infinity output.

- [ ] **Step 2: Run and confirm red**

```bash
node qa/atlas-x-pro/perpetual-risk-engine.mjs
```

Expected: FAIL because risk engine is undefined.

- [ ] **Step 3: Implement risk tiers and calculations**

Use symbol configuration objects rather than BTC/ETH conditionals:

```js
const CONTRACTS = {
  'BTC-USDT-SWAP': { maxLeverage: 125, minNotional: 5, quantityStep: 0.001, priceTick: 0.1 },
  'ETH-USDT-SWAP': { maxLeverage: 100, minNotional: 5, quantityStep: 0.001, priceTick: 0.01 }
};
```

Clamp invalid input and return structured validation errors instead of throwing from UI paths.

- [ ] **Step 4: Run risk and ledger tests**

```bash
node qa/atlas-x-pro/perpetual-risk-engine.mjs
node qa/atlas-x-pro/perpetual-ledger.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/perpetual-risk-engine.js qa/atlas-x-pro/perpetual-risk-engine.mjs
git commit -m "feat: add perpetual margin and liquidation engine"
```

---

## Task 3: Order Engine and Position Accounting

**Files:**
- Create: `atlas-x-pro/perpetual-order-engine.js`
- Test: `qa/atlas-x-pro/perpetual-order-engine.mjs`

**Interfaces:**
- Consumes: `AtlasPerpetualLedger`, `AtlasPerpetualRisk`
- Produces: `window.AtlasPerpetualOrders`
- Methods: `submitOrder(input, market)`, `cancelOrder(id)`, `evaluateMarket(market)`, `closePosition(input, market)`

- [ ] **Step 1: Write failing order-state tests**

Cover:

- market long and short;
- limit GTC waiting and fill;
- weighted average when adding;
- partial reduce and realized PnL;
- reversal closes old side before opening remainder;
- reduce-only rejection when exposure would increase;
- Post Only rejection when immediately marketable;
- IOC partial fill then cancel remainder;
- FOK all-or-cancel;
- trigger order creates a child order;
- refresh restores open orders without duplicate fill.

- [ ] **Step 2: Run and confirm red**

```bash
node qa/atlas-x-pro/perpetual-order-engine.mjs
```

Expected: FAIL because order engine is undefined.

- [ ] **Step 3: Implement validation and serialized execution**

Every submit path returns:

```js
{ ok: boolean, orderId?: string, fillIds?: string[], errorCode?: string, message?: string }
```

All state changes must occur in one ledger transaction. Market fills use current normalized order-book depth when available; fallback slippage must be deterministic and labelled `simulated_depth`.

- [ ] **Step 4: Run order, risk and ledger suites**

```bash
node qa/atlas-x-pro/perpetual-order-engine.mjs
node qa/atlas-x-pro/perpetual-risk-engine.mjs
node qa/atlas-x-pro/perpetual-ledger.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/perpetual-order-engine.js qa/atlas-x-pro/perpetual-order-engine.mjs
git commit -m "feat: add perpetual order and position engine"
```

---

## Task 4: Mark Price, Index Price and Funding

**Files:**
- Create: `atlas-x-pro/perpetual-funding-engine.js`
- Modify: `atlas-x-pro/market-data-engine.js`
- Modify: `atlas-x-pro/realtime-market-integration.js`
- Test: `qa/atlas-x-pro/perpetual-funding.mjs`

**Interfaces:**
- Produces: `window.AtlasPerpetualFunding`
- Methods: `getMarketContext(symbol)`, `settleDue(now)`, `getCountdown(now)`

- [ ] **Step 1: Write failing funding tests**

Assert:

- fresh public mark/index/funding values are preferred;
- derived fallback is labelled `derived`;
- stale values block new opening orders;
- positive funding debits longs and credits shorts;
- negative funding reverses direction;
- reload catches up at most one missed settlement window;
- repeated evaluation does not duplicate settlement.

- [ ] **Step 2: Run and confirm red**

```bash
node qa/atlas-x-pro/perpetual-funding.mjs
```

Expected: FAIL because funding engine is undefined.

- [ ] **Step 3: Implement funding context and settlement**

Market context shape:

```js
{
  symbol,
  lastPrice,
  indexPrice,
  markPrice,
  fundingRate,
  nextFundingAt,
  source: 'public' | 'derived' | 'cache',
  freshness: 'live' | 'stale' | 'offline',
  updatedAt
}
```

- [ ] **Step 4: Run funding and gateway suites**

```bash
node qa/atlas-x-pro/perpetual-funding.mjs
node qa/atlas-x-pro/gateway-contract.mjs
node qa/atlas-x-pro/gateway-smoke.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/perpetual-funding-engine.js atlas-x-pro/market-data-engine.js atlas-x-pro/realtime-market-integration.js qa/atlas-x-pro/perpetual-funding.mjs
git commit -m "feat: add mark price and funding settlement"
```

---

## Task 5: Controller, Liquidation and Audit Integration

**Files:**
- Create: `atlas-x-pro/perpetual-controller.js`
- Modify: `atlas-x-pro/order-execution-audit.js`
- Test: `qa/atlas-x-pro/perpetual-controller.mjs`

**Interfaces:**
- Produces: `window.AtlasPerpetual`
- Methods: `getSnapshot()`, `setLeverage()`, `setMarginMode()`, `submitOrder()`, `closePosition()`, `evaluateNow()`

- [ ] **Step 1: Write failing lifecycle tests**

Cover leverage changes, margin-mode changes, market updates, funding settlement, cross liquidation, isolated liquidation, TP/SL trigger, trailing stop trigger and audit correlation IDs.

- [ ] **Step 2: Run and confirm red**

```bash
node qa/atlas-x-pro/perpetual-controller.mjs
```

Expected: FAIL because controller is undefined.

- [ ] **Step 3: Implement controller**

Subscribe once to the market-data engine. Debounce rendering but never debounce ledger/risk evaluation past the latest price event. Liquidation transaction must close the position, release margin, record fee/fill/liquidation/audit and preserve spot state.

- [ ] **Step 4: Run lifecycle and existing audit suites**

```bash
node qa/atlas-x-pro/perpetual-controller.mjs
node qa/atlas-x-pro/order-execution-audit.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/perpetual-controller.js atlas-x-pro/order-execution-audit.js qa/atlas-x-pro/perpetual-controller.mjs
git commit -m "feat: orchestrate perpetual lifecycle and audit"
```

---

## Task 6: Desktop Perpetual Trading UI

**Files:**
- Create: `atlas-x-pro/perpetual-trading-ui.js`
- Create: `atlas-x-pro/perpetual-trading.css`
- Modify: `atlas-x-pro/bootstrap.js`
- Modify: `atlas-x-pro/index.html`
- Test: `qa/atlas-x-pro/perpetual-ui.mjs`

**Interfaces:**
- Consumes: `window.AtlasPerpetual`
- Produces DOM markers: `data-perpetual-ui="ready"`, `data-contract-symbol`, `data-margin-mode`, `data-position-mode`

- [ ] **Step 1: Write failing desktop/mobile UI test**

Assert visible contract selector, simulated label, mark/index/funding, leverage, margin mode, order types, long/short actions, estimate panel, positions, orders, funding, liquidation and audit tabs.

- [ ] **Step 2: Run and confirm red**

```bash
ATLAS_VIEWPORT=desktop-1440x900 node qa/atlas-x-pro/perpetual-ui.mjs
ATLAS_VIEWPORT=iphone-390x844 node qa/atlas-x-pro/perpetual-ui.mjs
```

Expected: FAIL because perpetual UI is absent.

- [ ] **Step 3: Implement UI and bootstrap order**

Load core modules in strict order:

```text
ledger → risk → order → funding → controller → UI
```

Do not mark global quality ready until all required modules finish.

- [ ] **Step 4: Run all four viewport UI tests**

```bash
for v in iphone-390x844 iphone-430x932 desktop-1440x900 desktop-1920x1080; do
  ATLAS_VIEWPORT=$v node qa/atlas-x-pro/perpetual-ui.mjs || exit 1
done
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/perpetual-trading-ui.js atlas-x-pro/perpetual-trading.css atlas-x-pro/bootstrap.js atlas-x-pro/index.html qa/atlas-x-pro/perpetual-ui.mjs
git commit -m "feat: add perpetual trading workspace"
```

---

## Task 7: Mobile Trading Shell

**Files:**
- Create: `atlas-x-pro/mobile-trading-shell.js`
- Create: `atlas-x-pro/mobile-trading-shell.css`
- Modify: `atlas-x-pro/bootstrap.js`
- Test: `qa/atlas-x-pro/mobile-trading-stage2.mjs`

**Interfaces:**
- Produces: `data-mobile-trading-stage2="ready"`
- Views: `chart`, `book`, `trade`, `positions`, `account`

- [ ] **Step 1: Write failing mobile shell tests**

Assert:

- market/status header remains visible;
- compact OHLC strip does not cover more than 22% of chart height;
- chart fullscreen opens and closes;
- book/trades toggle works;
- long/short buttons are fixed, at least 48px and not covered by safe area;
- order drawer supports quantity/notional and 25/50/75/100%;
- estimate panel shows margin, fee, average price, liquidation and risk;
- positions/orders/history/funding/audit are reachable without horizontal page overflow.

- [ ] **Step 2: Run and confirm red**

```bash
ATLAS_VIEWPORT=iphone-390x844 node qa/atlas-x-pro/mobile-trading-stage2.mjs
ATLAS_VIEWPORT=iphone-430x932 node qa/atlas-x-pro/mobile-trading-stage2.mjs
```

Expected: FAIL because mobile Stage 2 shell is absent.

- [ ] **Step 3: Implement shell and drawers**

Use delegated event handlers so DOM reordering does not lose listeners. Preserve desktop DOM ownership and only activate shell under 820px.

- [ ] **Step 4: Run both mobile tests and legacy mobile gates**

```bash
ATLAS_VIEWPORT=iphone-390x844 node qa/atlas-x-pro/mobile-trading-stage2.mjs
ATLAS_VIEWPORT=iphone-430x932 node qa/atlas-x-pro/mobile-trading-stage2.mjs
ATLAS_VIEWPORT=iphone-390x844 node qa/atlas-x-pro/mobile-first-screen.mjs
ATLAS_VIEWPORT=iphone-430x932 node qa/atlas-x-pro/mobile-account-tools.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/mobile-trading-shell.js atlas-x-pro/mobile-trading-shell.css atlas-x-pro/bootstrap.js qa/atlas-x-pro/mobile-trading-stage2.mjs
git commit -m "feat: rebuild mobile perpetual trading flow"
```

---

## Task 8: Professional Order Book

**Files:**
- Create: `atlas-x-pro/orderbook-pro.js`
- Modify: `atlas-x-pro/perpetual-trading.css`
- Test: `qa/atlas-x-pro/orderbook-pro.mjs`

**Interfaces:**
- Produces: `window.AtlasOrderBookPro`
- Methods: `aggregate(levels, tick)`, `setMode(mode)`, `setPrecision(value)`, `render(snapshot)`

- [ ] **Step 1: Write failing aggregation and UI tests**

Assert bid floors and ask ceilings to tick, quantities sum, cumulative totals are monotonic, one-sided modes hide the correct side, columns retain stable widths and source prices match current market snapshot.

- [ ] **Step 2: Run and confirm red**

```bash
node qa/atlas-x-pro/orderbook-pro.mjs
```

Expected: FAIL because professional order book is absent.

- [ ] **Step 3: Implement aggregation and rendering**

Never aggregate bids upward or asks downward. Preserve raw levels for order execution; aggregation is presentation-only.

- [ ] **Step 4: Run order book and order-engine suites**

```bash
node qa/atlas-x-pro/orderbook-pro.mjs
node qa/atlas-x-pro/perpetual-order-engine.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/orderbook-pro.js atlas-x-pro/perpetual-trading.css qa/atlas-x-pro/orderbook-pro.mjs
git commit -m "feat: add professional order book controls"
```

---

## Task 9: Workflow Integration and Full Regression

**Files:**
- Modify: `.github/workflows/atlas-x-pro-qa.yml`
- Modify: `atlas-x-pro/PROJECT-STATE.md`

- [ ] **Step 1: Add all Stage 2 suites to acceptance workflow**

Run pure math/ledger tests once and UI tests in all four viewport jobs. Keep gateway contract and real-network smoke as mandatory independent jobs.

- [ ] **Step 2: Run workflow and inspect every job**

Expected mandatory jobs:

```text
gateway-contract
gateway-smoke
perpetual-core
acceptance-iphone-390x844
acceptance-iphone-430x932
acceptance-desktop-1440x900
acceptance-desktop-1920x1080
```

All must conclude `success`.

- [ ] **Step 3: Review screenshots manually**

Inspect main, chart detail, order book, order drawer, positions, funding, liquidation warning and audit screens at all four sizes. Reject overlap, tiny text, duplicate controls, hidden state or inconsistent prices.

- [ ] **Step 4: Update project state**

Record exact HEAD, workflow run IDs, gateway status, scope, remaining debt, rollback commit and deployment status.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/atlas-x-pro-qa.yml atlas-x-pro/PROJECT-STATE.md
git commit -m "test: gate simulated perpetual stage"
```

---

## Task 10: Merge and Deploy

- [ ] **Step 1: Confirm Stage 2 PR head has not moved after verification**

Compare exact verified SHA with current PR head. If different, rerun all gates.

- [ ] **Step 2: Merge Stage 2 into `atlas-x-pro-terminal`**

Use expected-head protection and a normal merge/rebase method. Never force-update.

- [ ] **Step 3: Rerun acceptance and visual QA on merged development head**

Both workflows must conclude `success`.

- [ ] **Step 4: Create production rollback branch**

Name: `rollback/atlas-x-main-before-perpetual-stage2-20260711`.

- [ ] **Step 5: Fast-forward `main` only when ancestry is clean**

If `main` and development diverge, reconcile history normally and rerun gates. Do not force.

- [ ] **Step 6: Verify production**

Confirm the production path loads, title is correct, real market status appears, contract selector works, simulation label is visible, BTC/ETH perpetual order flow works, and no 404/white-screen/overflow appears.

- [ ] **Step 7: Record final deployment**

Update `PROJECT-STATE.md` with production SHA, rollback SHA, workflow IDs and known limitations.
