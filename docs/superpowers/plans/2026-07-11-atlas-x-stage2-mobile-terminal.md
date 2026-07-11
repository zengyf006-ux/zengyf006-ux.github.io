# ATLAS X Pro Stage 2 Mobile Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将手机端从桌面模块切片升级为一体化专业交易流程，完善盘口聚合、四种基础订单类型、数量/金额模式、VWAP/费用/滑点预估和全屏图表，同时保持现有实时行情与模拟账本不变。

**Architecture:** 新增四个边界清晰的移动层模块：移动终端编排、盘口纯函数与投影、专业下单适配、手机图表工作区。它们只消费 `AtlasMarketDataEngine`、`AtlasChartExperience` 和现有交易核心，不创建第二套资金、持仓、订单、成交、OCO、退出策略、预留、审计或预警账本。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Canvas、Playwright Core、GitHub Actions、现有 Supabase 公共行情网关。

## Global Constraints

- 不接真实资金、充值、提现、真实交易所账户、API Key、Secret、私钥或助记词。
- `atlasX.pro.v1` 等现有交易和策略存储键保持唯一财务真相。
- 手机关键操作触控目标至少 44px。
- 所有运行时代码变化必须通过 390×844、430×932、1440×900、1920×1080 全量回归。
- 真实行情、周期、K 线、风险、OCO、退出策略、预留、预警、审计和筛选器门禁不得跳过。
- 不在 `main` 直接试错，不强制更新任何分支。

---

## File Map

### 新增

- `atlas-x-pro/mobile-terminal-shell.js`：手机 DOM 编排、上下文标签、底部栏、滚动恢复。
- `atlas-x-pro/mobile-terminal-shell.css`：手机主屏层级与安全区。
- `atlas-x-pro/professional-orderbook.js`：订单簿聚合纯函数、精度、模式和渲染投影。
- `atlas-x-pro/professional-orderbook.css`：固定列宽、深度背景和成交列表。
- `atlas-x-pro/professional-order-entry.js`：订单类型、数量/金额模式、VWAP、校验和现有核心适配。
- `atlas-x-pro/professional-order-entry.css`：手机下单面板与提交前摘要。
- `atlas-x-pro/mobile-chart-workspace.js`：紧凑详情、全屏图表、工具抽屉。
- `atlas-x-pro/mobile-chart-workspace.css`：全屏层、详情条和工具抽屉。
- `qa/atlas-x-pro/professional-orderbook.mjs`：聚合与手机盘口验收。
- `qa/atlas-x-pro/professional-order-entry.mjs`：四种订单、输入模式和预估验收。
- `qa/atlas-x-pro/mobile-terminal-stage2.mjs`：手机主屏、全屏图表、键盘和安全区验收。

### 修改

- `atlas-x-pro/bootstrap.js`：按依赖顺序加载 Stage 2 模块和样式。
- `atlas-x-pro/index.html`：只补充语义挂载点和无 JS 回退，不复制账本 UI。
- `atlas-x-pro/app.js`：暴露薄交易核心适配接口，不改变撮合内部逻辑。
- `.github/workflows/atlas-x-pro-qa.yml`：加入三个 Stage 2 门禁和产物。
- `atlas-x-pro/PROJECT-STATE.md`：记录阶段结果、运行 ID、截图和部署状态。

---

### Task 1: Stage 2 Red Tests

**Files:**
- Create: `qa/atlas-x-pro/professional-orderbook.mjs`
- Create: `qa/atlas-x-pro/professional-order-entry.mjs`
- Create: `qa/atlas-x-pro/mobile-terminal-stage2.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

**Interfaces:**
- Consumes: current page DOM, `window.AtlasMarketDataEngine`, existing localStorage contracts.
- Produces: three reports under `qa-artifacts-pro/` and viewport screenshots.

- [ ] **Step 1: Write order-book failing checks**

Assert:

```js
checks.moduleReady = document.documentElement.dataset.professionalOrderbook === 'ready';
checks.columnsStable = ['price','quantity','cumulative'].every(key =>
  document.querySelector(`[data-book-column="${key}"]`));
checks.aggregateConservesQuantity = Math.abs(sourceQty - aggregatedQty) < 1e-8;
checks.modeSwitches = ['all','bids','asks'].every(mode => controls.includes(mode));
checks.priceClickOnlyFills = orderPrice > 0 && ordersAfter === ordersBefore;
```

- [ ] **Step 2: Write order-entry failing checks**

Assert four order types, amount/quantity equality, field relationships, VWAP fixture result, fee, slippage, submit labels, reservation use, and no duplicate ledger.

Fixture book:

```js
asks: [[100,1],[101,2],[102,3]],
bids: [[99,1],[98,2],[97,3]]
```

For a market buy of 250 USDT, expected VWAP:

```js
qty = 1 + 150 / 101;
vwap = 250 / qty;
```

- [ ] **Step 3: Write mobile-shell failing checks**

Assert fixed hierarchy, compact detail under 32% chart height, full-screen entry/exit, context restoration, 44px primary controls, safe-area padding, keyboard not covering submit, and no horizontal overflow.

- [ ] **Step 4: Add workflow steps before legacy quality checks**

```yaml
- name: Verify Stage 2 mobile terminal
  env:
    CHROME_BIN: /usr/bin/google-chrome
    ATLAS_VIEWPORT: ${{ matrix.viewport }}
  run: node qa/atlas-x-pro/mobile-terminal-stage2.mjs
```

Add equivalent orderbook and order-entry steps and upload all three reports.

- [ ] **Step 5: Run CI and confirm red**

Expected: gateway and Stage 1 pass; the new Stage 2 steps fail because the modules do not exist.

- [ ] **Step 6: Commit**

```bash
git add qa/atlas-x-pro .github/workflows/atlas-x-pro-qa.yml
git commit -m "test: define Stage 2 mobile trading gates"
```

---

### Task 2: Professional Order-Book Core

**Files:**
- Create: `atlas-x-pro/professional-orderbook.js`
- Create: `atlas-x-pro/professional-orderbook.css`
- Modify: `atlas-x-pro/bootstrap.js`

**Interfaces:**
- Consumes: `AtlasMarketDataEngine.getState().book`, active market precision.
- Produces:

```ts
AtlasProfessionalOrderbook.aggregateBook(input): AggregatedBook
AtlasProfessionalOrderbook.precisionOptions(price, precision): number[]
AtlasProfessionalOrderbook.setMode(mode): void
AtlasProfessionalOrderbook.setTickSize(tickSize): void
AtlasProfessionalOrderbook.snapshot(): Readonly<OrderbookUiState>
```

- [ ] **Step 1: Implement tick rounding**

```js
function bucketPrice(price, tick, side) {
  const scaled = Number(price) / tick;
  return (side === 'bid' ? Math.floor(scaled) : Math.ceil(scaled)) * tick;
}
```

Use integer scaling based on tick decimals to avoid floating-point key drift.

- [ ] **Step 2: Implement aggregation**

Group quantities by bucket, sort asks ascending and bids descending, calculate cumulative quantities, spread, spread bps and side ratios. Never mutate source arrays.

- [ ] **Step 3: Generate precision options**

For price `P` and market precision `d`, return three ordered values centered around the native tick, for example BTC may expose `0.1/1/10`, while sub-dollar markets expose decimal ticks.

- [ ] **Step 4: Render stable rows**

Each row must use:

```html
<button class="pro-book-row" data-book-price="...">
  <span data-book-cell="price">...</span>
  <span data-book-cell="quantity">...</span>
  <span data-book-cell="cumulative">...</span>
</button>
```

Depth fill uses CSS variable `--book-depth`.

- [ ] **Step 5: Bind same-session updates**

Subscribe to `atlas:market-state`; rerender at most once per animation frame. Do not fetch separately.

- [ ] **Step 6: Pass order-book test and legacy book/depth tests**

Expected: new report passes on four viewports; existing depth and chart-trading tests remain green.

- [ ] **Step 7: Commit**

```bash
git add atlas-x-pro/professional-orderbook.* atlas-x-pro/bootstrap.js
git commit -m "feat: add professional aggregated order book"
```

---

### Task 3: Trading Core Adapter

**Files:**
- Modify: `atlas-x-pro/app.js`

**Interfaces:**
- Produces:

```ts
window.AtlasTradingCore = {
  getMarketContext(): { symbol, base, quote, price, precision, side, orderType },
  getAccountSnapshot(): { cash, positions, orders, history },
  getAvailability(side, symbol): { cash, quantity, reservedCash, reservedQuantity },
  estimate(input): Estimate,
  submit(input): SubmitResult,
  subscribe(listener): unsubscribe
}
```

- [ ] **Step 1: Expose read-only snapshots**

Return structured clones; callers cannot mutate internal state.

- [ ] **Step 2: Map Stage 2 types to existing core**

```js
market -> market
limit -> limit
stop_market -> stop
stop_limit -> stop with explicit limitPrice metadata
```

If the existing core cannot safely execute stop-limit, store it as an existing waiting order with trigger and limit metadata, then let the same matching loop activate it. Do not add a second order array.

- [ ] **Step 3: Centralize submission**

The adapter sets existing fields and calls the same existing submit path. It returns the created order/fill ID or structured validation error.

- [ ] **Step 4: Verify unchanged ledger keys**

Before and after adapter calls, assert no new financial storage key exists.

- [ ] **Step 5: Run all existing execution, reservation, audit and strategy tests**

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add atlas-x-pro/app.js
git commit -m "refactor: expose a thin trading core adapter"
```

---

### Task 4: Professional Order Entry

**Files:**
- Create: `atlas-x-pro/professional-order-entry.js`
- Create: `atlas-x-pro/professional-order-entry.css`
- Modify: `atlas-x-pro/bootstrap.js`

**Interfaces:**
- Consumes: `AtlasTradingCore`, `AtlasProfessionalOrderbook.snapshot()`.
- Produces: `window.AtlasProfessionalOrderEntry` with `setType`, `setInputMode`, `estimate`, `validate`, `submit`, `snapshot`.

- [ ] **Step 1: Define UI state**

```js
{
  type: 'market'|'limit'|'stop_market'|'stop_limit',
  side: 'buy'|'sell',
  inputMode: 'amount'|'quantity',
  price: '', triggerPrice: '', limitPrice: '', amount: '', quantity: '', percent: 0
}
```

Persist only `type` and `inputMode` in `atlasX.pro.mobileTerminal.v1`.

- [ ] **Step 2: Implement VWAP estimate**

Walk asks for buys and bids for sells until requested amount/quantity is filled. Return `complete:false` when depth is insufficient.

- [ ] **Step 3: Implement validation matrix**

- Market: quantity or amount > 0.
- Limit: limit price > 0.
- Stop-market: trigger > 0.
- Stop-limit: trigger > 0, limit > 0, and explicit relationship warning.
- Buy cannot exceed unified cash availability.
- Sell cannot exceed unified quantity availability.
- Offline market submission is blocked.

- [ ] **Step 4: Project fields and summary**

Use one form container and toggle field groups; do not duplicate four forms. Summary exposes reference, VWAP, slippage bps, fee, total, availability and execution explanation.

- [ ] **Step 5: Submit through adapter**

On success clear transactional values but retain type/input mode. On error focus first invalid field and preserve all values.

- [ ] **Step 6: Pass order-entry and all legacy trading tests**

- [ ] **Step 7: Commit**

```bash
git add atlas-x-pro/professional-order-entry.* atlas-x-pro/bootstrap.js
git commit -m "feat: deliver professional mobile order entry"
```

---

### Task 5: Mobile Terminal Shell

**Files:**
- Create: `atlas-x-pro/mobile-terminal-shell.js`
- Create: `atlas-x-pro/mobile-terminal-shell.css`
- Modify: `atlas-x-pro/bootstrap.js`
- Modify: `atlas-x-pro/index.html`

**Interfaces:**
- Consumes: existing mobile market head, chart panel, orderbook panel, account workspace and trade bar.
- Produces: `window.AtlasMobileTerminal` with `setContext`, `openOrder`, `closeOrder`, `snapshot`, `restore`.

- [ ] **Step 1: Add semantic mount points**

```html
<section id="mobileTerminalSummary"></section>
<nav id="mobileContextTabs"></nav>
<section id="mobileContextStage"></section>
```

No duplicate data IDs.

- [ ] **Step 2: Reparent only below 820px**

Move existing panels into the mobile stage and keep placeholder comments so desktop restoration is deterministic. On resize above 820px, restore original parents and order.

- [ ] **Step 3: Build compact market summary**

Show high, low, turnover, amplitude and spread in one horizontal strip with an expand control.

- [ ] **Step 4: Replace old mobile nav semantics**

Contexts: `chart`, `book`, `trades`, `positions`, `orders`. Account full view remains reachable through an overflow action.

- [ ] **Step 5: Coordinate bottom bar and sheets**

Use `visualViewport` to add keyboard inset. Lock body scroll only while a sheet is open. Preserve chart scroll position.

- [ ] **Step 6: Pass mobile-shell test and legacy mobile guards**

- [ ] **Step 7: Commit**

```bash
git add atlas-x-pro/mobile-terminal-shell.* atlas-x-pro/bootstrap.js atlas-x-pro/index.html
git commit -m "feat: restructure the mobile trading terminal"
```

---

### Task 6: Mobile Chart Workspace

**Files:**
- Create: `atlas-x-pro/mobile-chart-workspace.js`
- Create: `atlas-x-pro/mobile-chart-workspace.css`
- Modify: `atlas-x-pro/bootstrap.js`

**Interfaces:**
- Consumes: `AtlasChartExperience`, `AtlasMarketDataEngine`, chart DOM.
- Produces: `window.AtlasMobileChartWorkspace` with `openFullscreen`, `closeFullscreen`, `openTools`, `closeTools`, `snapshot`.

- [ ] **Step 1: Build compact detail strip**

On selection show time, O/H/L/C, delta and volume in a maximum two-row strip. Detailed metrics move to a collapsible drawer.

- [ ] **Step 2: Build fixed full-screen layer**

Move chart stage into the layer with placeholders, not a cloned canvas. Add close, current pair, interval and live status.

- [ ] **Step 3: Add bottom tools drawer**

Expose all 12 periods, EMA/BOLL/VOL, drawing tools, reset and go-latest. Reuse existing controls through delegated clicks.

- [ ] **Step 4: Restore state**

On close return DOM, restore scroll and chart offset, then call chart resize. Clear locked selection per spec.

- [ ] **Step 5: Pass mobile-shell and Stage 1 chart tests**

- [ ] **Step 6: Commit**

```bash
git add atlas-x-pro/mobile-chart-workspace.* atlas-x-pro/bootstrap.js
git commit -m "feat: add mobile full-screen chart workspace"
```

---

### Task 7: Cross-Module Integration and Polish

**Files:**
- Modify: `atlas-x-pro/bootstrap.js`
- Modify: `atlas-x-pro/continuous-hardening.css`
- Modify: relevant compatibility modules only when a failing legacy test proves a conflict.

**Interfaces:**
- Consumes: all Stage 2 modules.
- Produces: `document.documentElement.dataset.mobileTerminalStage2 = 'ready'` only after complete initialization.

- [ ] **Step 1: Enforce load order**

```text
trading core adapter → professional orderbook → professional order entry → mobile shell → mobile chart workspace → compatibility modules → ready
```

- [ ] **Step 2: Remove duplicate mobile controls**

Keep one alert, one data-health entry, one market entry and one buy/sell pair.

- [ ] **Step 3: Audit touch and typography**

Primary controls 44px; fixed numeric columns; no clipped Chinese; no font-size below existing accessibility floor for actionable text.

- [ ] **Step 4: Run three Stage 2 tests and all legacy tests**

Fix root causes; do not skip or relax checks.

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro
git commit -m "fix: integrate Stage 2 mobile trading modules"
```

---

### Task 8: Full Verification, State and Deployment

**Files:**
- Modify: `atlas-x-pro/PROJECT-STATE.md`

- [ ] **Step 1: Run exact-head acceptance**

Require gateway contract, real-network smoke, all four viewports and all Stage 1/2/legacy steps to pass.

- [ ] **Step 2: Review screenshots**

For 390, 430, 1440 and 1920 review:

- default chart
- selected candle
- full-screen chart
- all/bids/asks book
- market/limit/stop-market/stop-limit forms
- keyboard open
- positions/orders context

Reject overlap, tofu text, unstable columns, fake live state, hidden submit buttons, duplicate controls and excessive loaders.

- [ ] **Step 3: Record measurements**

Record first interactive time, chart switch time, orderbook render time, full-screen open time and order estimate update time. Do not invent unmeasured claims.

- [ ] **Step 4: Update state**

Record exact SHA, run IDs, screenshots, known risks and next unique priority.

- [ ] **Step 5: Merge and re-run on main development branch**

Do not reuse child-branch evidence after merge.

- [ ] **Step 6: Create production rollback ref and fast-forward main**

Use `force:false`; stop on divergence.

- [ ] **Step 7: Verify production branch content and Pages target**

Confirm title, Stage 2 module files, real gateway URL and no missing assets.

---

## Plan Self-Review

- Spec coverage: mobile hierarchy, compact K-line detail, full-screen chart, orderbook aggregation, precision, three book modes, four order types, input mode, VWAP, fees, slippage, validation, existing ledgers, regression, screenshots and deployment each map to a task.
- Placeholder scan: no TODO, TBD or unspecified implementation step remains.
- Type consistency: module names and public interfaces are defined once and reused.
- Scope: simulated perpetual leverage/funding ledger is explicitly excluded until Stage 2 passes.

## Execution Choice

The user has explicitly authorized uninterrupted implementation. Execute inline in this session using `superpowers:executing-plans`, with test-first commits and no routine approval pauses.
