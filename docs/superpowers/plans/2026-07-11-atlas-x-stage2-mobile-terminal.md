# ATLAS X Stage 2 Mobile Trading Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the ATLAS X Pro mobile trading workflow into a coherent professional terminal with a lighter chart inspection model, fullscreen chart tools, precision-aware order book, and complete spot order-entry flow while preserving the existing simulated ledger and all desktop behavior.

**Architecture:** Stage 2 is implemented as focused compatibility modules loaded after Stage 1 and before quality modules. The modules project the existing core state and public market session into a mobile-specific shell; they do not create a second cash, position, order, fill, OCO, exit-strategy, audit, or reservation ledger. Desktop remains on the existing four-zone workspace. Mobile uses task-oriented surfaces and bottom sheets with delegated events so DOM replacement cannot break entry points.

**Tech Stack:** Vanilla JavaScript, CSS, Canvas chart already present in `app.js`, `AtlasMarketDataEngine`, `AtlasChartExperience`, IndexedDB/localStorage for existing state, Playwright Core, GitHub Actions.

## Global Constraints

- Continue to use public market data only; do not connect real exchange accounts or funds.
- Do not request, store, or transmit API Key, Secret, private key, or seed phrase.
- Do not create a second accounting or matching ledger.
- Do not copy OKX, Binance, Bybit, Coinbase, or Kraken branding, full layouts, icons, or copy.
- Do not use iframe or old `atlas-x/` runtime files.
- Do not modify `main` during implementation.
- Preserve desktop 1440 × 900 and 1920 × 1080 behavior.
- Mobile acceptance viewports remain exactly 390 × 844 and 430 × 932.
- Minimum primary mobile touch target: 44 × 44 CSS pixels.
- Minimum secondary compact touch target: 40 × 40 CSS pixels.
- No horizontal page overflow at any acceptance viewport.
- Stage 2 must pass the Stage 1 real-network gateway smoke and every existing trading regression.
- Simulated perpetual-contract ledger is explicitly excluded until Stage 2 is complete.

---

## File Structure

### New production modules

- `atlas-x-pro/mobile-terminal-shell.js` — mounts and maintains the mobile task shell, header, surface navigation, sticky action bar, and sheet routing.
- `atlas-x-pro/mobile-terminal-shell.css` — mobile layout, spacing, typography, safe-area handling, and touch targets.
- `atlas-x-pro/mobile-chart-workspace.js` — lightweight candle inspection, fullscreen chart mode, mobile chart tool sheet, and return-to-latest behavior.
- `atlas-x-pro/mobile-chart-workspace.css` — fullscreen chart, top OHLC strip, compact inspection bar, and tool sheet.
- `atlas-x-pro/pro-orderbook.js` — price aggregation, bid/ask/both modes, stable column projection, book-to-ticket price transfer.
- `atlas-x-pro/pro-orderbook.css` — monospaced columns, depth rendering, compact/mobile layouts.
- `atlas-x-pro/pro-order-ticket.js` — professional order types, quantity/amount mode, percent sizing, estimates, validation, and projection to the existing core submit path.
- `atlas-x-pro/pro-order-ticket.css` — order-entry hierarchy, bottom-sheet states, estimates, risk and audit entry points.
- `atlas-x-pro/mobile-terminal-compat.js` — compatibility bridge for existing mobile navigation, account tools, alerts, screener, audit, and exit-strategy modules.

### Modified production files

- `atlas-x-pro/bootstrap.js` — load Stage 2 styles and scripts in deterministic order.
- `atlas-x-pro/realtime-market-integration.js` — expose a stable market-session event bridge required by book and order-ticket projections.
- `atlas-x-pro/index.html` — only add semantic placeholders when dynamic mounting cannot provide correct accessibility.
- `atlas-x-pro/PROJECT-STATE.md` — record the verified Stage 2 state after all gates pass.

### New tests

- `qa/atlas-x-pro/mobile-terminal-stage2.mjs` — mobile information hierarchy, surface routing, safe-area, touch, and overflow acceptance.
- `qa/atlas-x-pro/mobile-chart-workspace.mjs` — compact inspection, cancellation, fullscreen, tool sheet, and return-to-latest acceptance.
- `qa/atlas-x-pro/pro-orderbook.mjs` — aggregation, modes, column alignment, spread, and ticket transfer acceptance.
- `qa/atlas-x-pro/pro-order-ticket.mjs` — order types, quantity/amount conversion, percent sizing, estimates, validation, ledger projection, and no duplicate ledger acceptance.
- `qa/atlas-x-pro/stage2-visual.mjs` — screenshots for chart, book, order sheet, positions, and desktop non-regression.

### Modified tests/workflow

- `.github/workflows/atlas-x-pro-qa.yml` — add Stage 2 checks before the legacy module chain and upload new reports/screenshots.
- `qa/atlas-x-pro/mobile-layout-guard.mjs` — align old assertions with the new task shell without reducing viewport or touch requirements.
- `qa/atlas-x-pro/advanced-visual.mjs` — capture the new mobile surfaces instead of obsolete placements.

---

### Task 1: Establish the Stage 2 Mobile Acceptance Contract

**Files:**
- Create: `qa/atlas-x-pro/mobile-terminal-stage2.mjs`
- Create: `qa/atlas-x-pro/mobile-chart-workspace.mjs`
- Create: `qa/atlas-x-pro/pro-orderbook.mjs`
- Create: `qa/atlas-x-pro/pro-order-ticket.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

**Interfaces:**
- Consumes: existing DOM, `window.AtlasMarketDataEngine`, `window.AtlasChartExperience`, `atlasX.pro.v1`.
- Produces: four deterministic JSON reports and screenshots; explicit red gates for missing Stage 2 modules.

- [ ] **Step 1: Write the failing mobile shell test**

The test must assert:

```js
await page.waitForFunction(() => document.documentElement.dataset.mobileTerminalStage2 === 'ready');
assert.equal(await page.locator('.mobile-terminal-stage2').count(), 1);
assert.equal(await page.locator('[data-mobile-surface="chart"]').count(), 1);
assert.equal(await page.locator('[data-mobile-surface="book"]').count(), 1);
assert.equal(await page.locator('[data-mobile-surface="account"]').count(), 1);
assert.equal(await page.locator('.mobile-primary-actions button').count(), 2);
```

It must also measure 44 px primary targets, 40 px secondary targets, safe-area padding, no horizontal overflow, and exactly one visible alert/screener/favorite entry.

- [ ] **Step 2: Write the failing chart-workspace test**

The test must assert compact inspection fields, same-candle cancellation, explicit close, Esc on desktop emulation, fullscreen enter/exit, mobile tool sheet, return-to-latest, and no blocking detail card over more than 38% of the mobile chart.

- [ ] **Step 3: Write the failing order-book test**

The test must assert modes `both`, `bids`, `asks`; aggregation steps; stable three-column headers; calculated spread; cumulative depth; and clicked price copied to `#orderPrice` without order submission.

- [ ] **Step 4: Write the failing order-ticket test**

The test must assert order types `market`, `limit`, `stop-market`, `stop-limit`; amount/quantity mode; 25/50/75/100 percent sizing; fee/VWAP/slippage estimates; validation; existing ledger mutation only after explicit submit; and no new storage key containing a duplicate order ledger.

- [ ] **Step 5: Add all four tests to CI before old regressions**

Run in this order after Stage 1 tests:

```yaml
- run: node qa/atlas-x-pro/mobile-terminal-stage2.mjs
- run: node qa/atlas-x-pro/mobile-chart-workspace.mjs
- run: node qa/atlas-x-pro/pro-orderbook.mjs
- run: node qa/atlas-x-pro/pro-order-ticket.mjs
```

- [ ] **Step 6: Run CI and verify red gates**

Expected: all four mobile jobs fail at the new Stage 2 checks because the new production modules do not exist; gateway contract and smoke remain green.

- [ ] **Step 7: Commit**

```bash
git add qa/atlas-x-pro .github/workflows/atlas-x-pro-qa.yml
git commit -m "test: define stage2 mobile terminal acceptance"
```

---

### Task 2: Build the Mobile Task Shell

**Files:**
- Create: `atlas-x-pro/mobile-terminal-shell.js`
- Create: `atlas-x-pro/mobile-terminal-shell.css`
- Modify: `atlas-x-pro/bootstrap.js`
- Test: `qa/atlas-x-pro/mobile-terminal-stage2.mjs`

**Interfaces:**
- Consumes: `.mobile-market-head`, `.chart-panel`, `.orderbook-panel`, `.account-workspace`, `#orderTicket`, existing data attributes.
- Produces: `document.documentElement.dataset.mobileTerminalStage2 = 'ready'`, `.mobile-terminal-stage2`, `setSurface(name)`, `openTradeSheet(side)`, `closeTradeSheet()`.

- [ ] **Step 1: Implement one mounted shell**

The shell must expose these semantic regions:

```html
<section class="mobile-terminal-stage2">
  <header class="mobile-stage2-market"></header>
  <nav class="mobile-stage2-surfaces" aria-label="交易工作区"></nav>
  <main class="mobile-stage2-content"></main>
  <footer class="mobile-primary-actions"></footer>
</section>
```

It must move, not clone, existing chart/book/account nodes. Desktop must remain unchanged.

- [ ] **Step 2: Implement surface routing**

Supported values: `chart`, `book`, `trades`, `account`. Routing must update the existing core `mobileView` through the existing button path so persistence and downstream modules remain synchronized.

- [ ] **Step 3: Implement market header hierarchy**

Show pair, realtime price, change, source state, data age, favorite, alert, and screener in one controlled header. Use overflow-safe text and a compact secondary-action cluster.

- [ ] **Step 4: Implement sticky primary actions**

Exactly two buttons: buy and sell. They call the existing order-sheet entry, preserve side state, and remain above the safe-area inset.

- [ ] **Step 5: Implement resilient delegated events**

All shell actions must use event delegation from `.mobile-terminal-stage2` so later DOM replacement cannot remove behavior.

- [ ] **Step 6: Pass the mobile shell test**

Run:

```bash
ATLAS_VIEWPORT=iphone-390x844 node qa/atlas-x-pro/mobile-terminal-stage2.mjs
ATLAS_VIEWPORT=iphone-430x932 node qa/atlas-x-pro/mobile-terminal-stage2.mjs
```

Expected: PASS; desktop cases report explicit non-applicability without changing desktop DOM.

- [ ] **Step 7: Commit**

```bash
git add atlas-x-pro/mobile-terminal-shell.* atlas-x-pro/bootstrap.js qa/atlas-x-pro/mobile-terminal-stage2.mjs
git commit -m "feat: add task-oriented mobile trading shell"
```

---

### Task 3: Replace the Mobile Candle Overlay with a Lightweight Workspace

**Files:**
- Create: `atlas-x-pro/mobile-chart-workspace.js`
- Create: `atlas-x-pro/mobile-chart-workspace.css`
- Modify: `atlas-x-pro/realtime-market-integration.js`
- Test: `qa/atlas-x-pro/mobile-chart-workspace.mjs`

**Interfaces:**
- Consumes: `AtlasChartExperience.metrics`, `AtlasChartExperience.getSelection`, `AtlasMarketDataEngine.getState`, `#chartCanvas`, chart tool buttons.
- Produces: `.mobile-chart-inspection`, `.mobile-chart-tool-sheet`, `enterFullscreen()`, `exitFullscreen()`, `openTools(group)`, `closeTools()`.

- [ ] **Step 1: Add a compact OHLC inspection strip**

On mobile, a selected candle renders time, open/high/low/close, change, amplitude, volume and turnover in a top strip no taller than 118 px. EMA/provider/status move to a secondary expandable row. The old floating detail card must be hidden on mobile only.

- [ ] **Step 2: Preserve all cancellation paths**

Same candle, chart blank, close, surface switch, interval switch, symbol switch, drag start, and reset must clear the strip.

- [ ] **Step 3: Implement fullscreen chart**

Fullscreen mode keeps pair, price, interval, inspection strip, chart, return-to-latest and close. It hides order entry/account surfaces and accounts for safe-area insets.

- [ ] **Step 4: Implement bottom chart tool sheet**

Groups: intervals, main indicators, secondary indicators, drawing, reset. Existing chart tool buttons are moved or projected; no duplicate chart state is created.

- [ ] **Step 5: Implement return-to-latest visibility**

Show after chart offset or pan; hide after reset/latest. The action must not alter the selected market or account state.

- [ ] **Step 6: Pass chart-workspace tests at both mobile sizes**

Run both mobile viewport commands; expected PASS with inspection coverage <= 38% of chart height.

- [ ] **Step 7: Commit**

```bash
git add atlas-x-pro/mobile-chart-workspace.* atlas-x-pro/realtime-market-integration.js qa/atlas-x-pro/mobile-chart-workspace.mjs
git commit -m "feat: add fullscreen mobile chart workspace"
```

---

### Task 4: Build a Precision-Aware Professional Order Book

**Files:**
- Create: `atlas-x-pro/pro-orderbook.js`
- Create: `atlas-x-pro/pro-orderbook.css`
- Test: `qa/atlas-x-pro/pro-orderbook.mjs`

**Interfaces:**
- Consumes: current `AtlasMarketDataEngine` book/ticker, existing `data-book-price` path, `#orderPrice`.
- Produces: `window.AtlasProOrderBook`, `setMode(mode)`, `setAggregation(step)`, `getView()`, `document.documentElement.dataset.proOrderBook = 'ready'`.

- [ ] **Step 1: Normalize and aggregate levels**

For each side, group price by the selected step, sum quantity, and recompute cumulative quantity after sorting. Supported automatic step options derive from market precision and current price.

- [ ] **Step 2: Render stable columns**

Columns: price, quantity, cumulative. Use CSS grid with fixed numeric alignment and tabular/monospaced digits. The middle-price row shows last price, spread and bid/ask ratio.

- [ ] **Step 3: Add mode controls**

Modes `both`, `bids`, `asks` update one book projection. Do not create separate hidden books with conflicting state.

- [ ] **Step 4: Connect book price to ticket**

Clicking a level selects limit mode, writes price to the existing input, recalculates estimates, and on mobile opens the trade sheet only when the user explicitly taps the level.

- [ ] **Step 5: Preserve depth and legacy tests**

Existing `renderOrderBook`, depth chart, book-mode and chart-trading tests must remain green.

- [ ] **Step 6: Pass order-book tests**

Run all four viewports; expected PASS.

- [ ] **Step 7: Commit**

```bash
git add atlas-x-pro/pro-orderbook.* qa/atlas-x-pro/pro-orderbook.mjs
git commit -m "feat: add precision-aware professional order book"
```

---

### Task 5: Complete the Professional Spot Order Ticket

**Files:**
- Create: `atlas-x-pro/pro-order-ticket.js`
- Create: `atlas-x-pro/pro-order-ticket.css`
- Test: `qa/atlas-x-pro/pro-order-ticket.mjs`

**Interfaces:**
- Consumes: existing core inputs and submit path, `AtlasMarketDataEngine` ticker/book, existing risk/OCO/exit/audit modules.
- Produces: `window.AtlasProOrderTicket`, order type projection, input mode, estimate model, validation state, `document.documentElement.dataset.proOrderTicket = 'ready'`.

- [ ] **Step 1: Add professional order-type model**

UI types:

```js
['market', 'limit', 'stop-market', 'stop-limit']
```

Projection rules:

- market → existing `market`
- limit → existing `limit`
- stop-market → existing `stop` with trigger and market execution intent metadata
- stop-limit → existing `stop` with trigger plus limit price metadata

No order is written until the existing explicit submit control is activated.

- [ ] **Step 2: Add quantity/amount mode**

Toggling mode changes the primary input label and conversion direction while retaining the existing `#orderQuantity` and `#orderTotal` fields as accounting inputs.

- [ ] **Step 3: Add percentage sizing**

25/50/75/100 must calculate from available quote cash for buys and available unreserved base quantity for sells. It must honor reservation coordination.

- [ ] **Step 4: Add deterministic estimates**

Show estimated average execution price using current book levels, fee, slippage amount/percent, order value, and remaining available balance. If book depth is insufficient, show an explicit warning and disable submit.

- [ ] **Step 5: Add validation and review hierarchy**

Validation covers missing amount, invalid price, invalid trigger, insufficient cash/base, post-only crossing, reduce-only mismatch and stale/offline market data. Display errors next to the relevant field and in one summary region.

- [ ] **Step 6: Link advanced tools without clutter**

Risk plan, TP/SL, OCO, trailing/scaled exits and audit are in an expandable advanced section. Existing modules remain authoritative.

- [ ] **Step 7: Prove ledger integrity**

Before/after tests must show only `atlasX.pro.v1` and existing advanced ledgers change. No `stage2.orders`, `mobile.orders` or second cash/position storage key may exist.

- [ ] **Step 8: Pass ticket tests in all viewports**

Expected: mobile full sheet and desktop existing right ticket both pass.

- [ ] **Step 9: Commit**

```bash
git add atlas-x-pro/pro-order-ticket.* qa/atlas-x-pro/pro-order-ticket.mjs
git commit -m "feat: complete professional spot order ticket"
```

---

### Task 6: Integrate Existing Account, Alert, Audit, and Exit Modules

**Files:**
- Create: `atlas-x-pro/mobile-terminal-compat.js`
- Modify: `atlas-x-pro/bootstrap.js`
- Test: `qa/atlas-x-pro/mobile-terminal-stage2.mjs`

**Interfaces:**
- Consumes: existing account tabs, alert center, market screener, audit center, risk center, exit-strategy panels.
- Produces: stable delegated entries and one visible instance per feature.

- [ ] **Step 1: Map account tools into one mobile account surface**

Tabs: positions, current orders, fills, audit, balances. Counts remain sourced from existing DOM/state.

- [ ] **Step 2: Guarantee single entries**

Exactly one visible alert, screener, favorite, data-health, audit and close-sheet control on mobile. Remove classes from stale hidden duplicates rather than cloning state.

- [ ] **Step 3: Restore focus and scroll after sheets close**

Store the opener element, return focus, and retain the originating surface scroll position.

- [ ] **Step 4: Pass all existing mobile module tests**

Run alert, screener, audit, account tools, OCO, exit strategies and reservation coordination at 390 and 430.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/mobile-terminal-compat.js atlas-x-pro/bootstrap.js
git commit -m "fix: integrate advanced tools into mobile terminal"
```

---

### Task 7: Visual, Performance, and Cross-Viewport Hardening

**Files:**
- Create: `qa/atlas-x-pro/stage2-visual.mjs`
- Modify: `qa/atlas-x-pro/mobile-layout-guard.mjs`
- Modify: `qa/atlas-x-pro/advanced-visual.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`
- Modify: Stage 2 CSS files as findings require.

**Interfaces:**
- Consumes: completed Stage 2 modules.
- Produces: five critical screenshots per mobile viewport and desktop non-regression screenshots.

- [ ] **Step 1: Capture critical mobile states**

Screenshots:

- main chart
- selected candle compact strip
- fullscreen chart tools
- aggregated order book
- professional order sheet
- positions/audit account surface

- [ ] **Step 2: Capture desktop non-regression**

Capture 1440 and 1920 main workspace, book and ticket. Stage 2 mobile modules must not alter desktop dimensions or hide desktop controls.

- [ ] **Step 3: Enforce performance budgets**

- cached shell visible target <= 300 ms
- explicit interval feedback <= 100 ms
- order-book projection <= 50 ms for 40 levels
- mobile surface switch <= 100 ms
- no repeated full DOM rebuild on each ticker update

Record actual values; do not fabricate a pass.

- [ ] **Step 4: Run complete CI**

Required green gates:

- gateway contract
- both real gateway smoke checks
- Stage 1 realtime/period tests
- Stage 2 mobile shell/chart/book/ticket tests
- every existing trading/risk/OCO/exit/reservation/alert/audit/screener test
- semantic typography
- advanced visual
- mobile layout/account tools

- [ ] **Step 5: Perform human screenshot review**

Review information hierarchy, tap comfort, chart obstruction, sticky bars, safe area, numeric alignment, order-entry clarity, empty/error states and desktop regression.

- [ ] **Step 6: Commit**

```bash
git add qa/atlas-x-pro .github/workflows/atlas-x-pro-qa.yml atlas-x-pro/*.css
git commit -m "test: harden stage2 mobile terminal across viewports"
```

---

### Task 8: Update State, Integrate, and Preserve Rollback

**Files:**
- Modify: `atlas-x-pro/PROJECT-STATE.md`

**Interfaces:**
- Consumes: final immutable verified commit and CI run IDs.
- Produces: authoritative Stage 2 handoff and next-stage boundary.

- [ ] **Step 1: Freeze the verified runtime commit**

Record the exact SHA before any documentation-only commit.

- [ ] **Step 2: Update `PROJECT-STATE.md`**

Record modules, data boundaries, tests, screenshots, known risks, rollback SHA and the next unique priority.

- [ ] **Step 3: Compare with `atlas-x-pro-terminal`**

The Stage 2 branch must be strictly ahead with zero behind commits. If diverged, stop and reconcile; never force overwrite.

- [ ] **Step 4: Fast-forward the main development branch**

Use a non-force branch-ref update only after fresh green evidence.

- [ ] **Step 5: Do not deploy `main` yet unless the full product release gate is explicitly satisfied**

Stage 2 is a major product milestone but not the simulated perpetual-contract stage. Production deployment requires explicit release evidence and a stable rollback point.

- [ ] **Step 6: Commit documentation**

```bash
git add atlas-x-pro/PROJECT-STATE.md
git commit -m "docs: record verified stage2 mobile terminal"
```
