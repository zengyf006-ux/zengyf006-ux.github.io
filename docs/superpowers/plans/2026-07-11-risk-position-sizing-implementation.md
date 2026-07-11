# 风险仓位计算器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 ATLAS X Pro 下单面板中加入基于账户权益、入场价、止损价和风险比例的交易计划与建议仓位工具，并保持原模拟撮合与全部验收零回归。

**Architecture:** 使用独立增强模块 `risk-position-sizing.js` 读取现有 DOM 与本地模拟账本，不修改核心撮合数据结构。模块负责计划参数持久化、风险计算、方向校验和将建议数量写回原订单表单；`risk-position-sizing.css` 负责跨端布局；独立 Playwright 验收脚本用固定账本和价格验证计算结果及一键填入。

**Tech Stack:** 原生 HTML/CSS/JavaScript、localStorage、Playwright Core、GitHub Actions。

## Global Constraints

- 当前仍为现货模拟交易，不新增真实资产、密钥、充值、提现或交易所账户连接。
- 默认单笔风险为账户权益的 1%，允许 0.1%–5%。
- 买入止损必须低于入场价，目标价如填写必须高于入场价。
- 建议数量必须包含双边预计手续费，并受可用现金或现货持仓上限约束。
- 一键填入必须触发原订单表单联动，不绕开现有下单校验。
- 四种视口 390×844、430×932、1440×900、1920×1080 必须通过。
- 原订单保护、绩效账本、组合风险、市场情报、行情路由和移动工具必须零回归。

---

### Task 1: 建立风险仓位失败验收

**Files:**
- Create: `qa/atlas-x-pro/risk-position-sizing.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

**Interfaces:**
- Consumes: 页面现有 `#orderQuantity`、`#orderTotal`、`#estimatedFee`、`#accountEquity`、`#availableBalance`。
- Produces: `qa-artifacts-pro/risk-position-sizing-report.json` 与 `${viewport}-risk-position-sizing.png`。

- [ ] **Step 1: 写固定账本测试**

测试初始化本地状态：账户现金 100,000 USDT、BTC 当前模拟入场价 64,000、无持仓、无挂单。打开买入市价订单，设置止损 62,000、目标 68,000、风险比例 1%。

测试独立计算：

```js
const equity = 100000;
const entry = 64000;
const stop = 62000;
const targetPrice = 68000;
const riskRate = 0.01;
const feeRate = 0.0008;
const riskBudget = equity * riskRate;
const unitRisk = Math.abs(entry - stop) + entry * feeRate + stop * feeRate;
const rawQty = riskBudget / unitRisk;
const cashCapQty = equity / (entry * (1 + feeRate));
const expectedQty = Math.min(rawQty, cashCapQty);
const maxLoss = expectedQty * unitRisk;
const reward = expectedQty * (targetPrice - entry) - expectedQty * (entry + targetPrice) * feeRate;
const rr = reward / maxLoss;
```

断言：
- `.risk-sizing-panel` 可见；
- 风险预算、建议数量、最大亏损、盈亏比与上述结果误差小于 0.02；
- 点击 `[data-risk-sizing-apply]` 后 `#orderQuantity` 等于建议数量；
- `#orderTotal` 与 `#estimatedFee` 同步更新；
- 买入止损改为 66,000 后状态无效且按钮禁用；
- 手机无横向溢出，提交按钮可滚动到达。

- [ ] **Step 2: 将测试接入四端流水线**

在组合风险验收后新增：

```yaml
      - name: Verify risk position sizing
        env:
          CHROME_BIN: /usr/bin/google-chrome
          ATLAS_VIEWPORT: ${{ matrix.viewport }}
        run: node qa/atlas-x-pro/risk-position-sizing.mjs
```

上传结果中加入：

```yaml
            qa-artifacts-pro/risk-position-sizing-report.json
```

- [ ] **Step 3: 运行流水线确认红灯**

Expected: 四端只在 `Verify risk position sizing` 失败，原因是 `.risk-sizing-panel` 尚不存在；此前步骤保持成功。

- [ ] **Step 4: 提交**

```bash
git add qa/atlas-x-pro/risk-position-sizing.mjs .github/workflows/atlas-x-pro-qa.yml
git commit -m "test: add risk position sizing acceptance"
```

---

### Task 2: 实现独立风险计算模块

**Files:**
- Create: `atlas-x-pro/risk-position-sizing.js`

**Interfaces:**
- Consumes: `localStorage['atlasX.pro.v1']`、当前市场 DOM、订单表单 DOM。
- Produces: `window.AtlasRiskSizing.calculate(input)`、`.risk-sizing-panel`、`data-*` 计算结果。

- [ ] **Step 1: 定义纯计算函数**

```js
function calculateRiskSizing({
  side,
  equity,
  availableCash,
  heldQuantity,
  entryPrice,
  stopPrice,
  targetPrice,
  riskPercent,
  feeRate = 0.0008,
}) {
  const result = {
    valid: false,
    reason: '',
    riskBudget: 0,
    quantity: 0,
    maxLoss: 0,
    reward: 0,
    riskReward: 0,
    cappedBy: '',
  };

  if (![equity, entryPrice, riskPercent].every(value => Number.isFinite(value) && value > 0)) {
    result.reason = '账户权益、入场价或风险比例无效';
    return result;
  }
  if (riskPercent < 0.1 || riskPercent > 5) {
    result.reason = '单笔风险必须在 0.1%–5%';
    return result;
  }
  if (side === 'sell') {
    if (!(heldQuantity > 0)) {
      result.reason = '当前交易对没有可卖持仓';
      return result;
    }
    result.valid = true;
    result.quantity = heldQuantity;
    result.cappedBy = 'position';
    result.reason = '现货卖出按可用持仓上限计算';
    return result;
  }
  if (!(stopPrice > 0) || stopPrice >= entryPrice) {
    result.reason = '买入计划的止损价必须低于入场价';
    return result;
  }
  if (targetPrice > 0 && targetPrice <= entryPrice) {
    result.reason = '买入计划的目标价必须高于入场价';
    return result;
  }

  const riskBudget = equity * riskPercent / 100;
  const unitRisk = Math.abs(entryPrice - stopPrice) + entryPrice * feeRate + stopPrice * feeRate;
  const rawQuantity = riskBudget / unitRisk;
  const cashCap = availableCash / (entryPrice * (1 + feeRate));
  const quantity = Math.max(0, Math.min(rawQuantity, cashCap));
  if (!(quantity > 0)) {
    result.reason = '风险预算或可用余额不足';
    return result;
  }

  result.valid = true;
  result.riskBudget = riskBudget;
  result.quantity = quantity;
  result.maxLoss = quantity * unitRisk;
  result.cappedBy = cashCap + 1e-12 < rawQuantity ? 'cash' : '';
  if (targetPrice > 0) {
    result.reward = quantity * (targetPrice - entryPrice) - quantity * (entryPrice + targetPrice) * feeRate;
    result.riskReward = result.maxLoss > 0 ? result.reward / result.maxLoss : 0;
  }
  result.reason = result.cappedBy === 'cash' ? '已按可用余额上限调整' : '风险预算内';
  return result;
}
```

将函数暴露为：

```js
window.AtlasRiskSizing = { calculate: calculateRiskSizing };
```

- [ ] **Step 2: 注入交易计划 DOM**

在 `.advanced-options` 后插入：

```html
<section class="risk-sizing-panel" data-risk-sizing-state="idle">
  <button class="risk-sizing-toggle" type="button" aria-expanded="false">
    <span><b>交易计划</b><small>按止损距离计算建议仓位</small></span>
    <strong id="riskSizingCompact">风险 1.00%</strong>
  </button>
  <div class="risk-sizing-body" hidden>
    <div class="risk-sizing-inputs">
      <label><span>入场价</span><input id="riskEntryPrice" inputmode="decimal"><b>USDT</b></label>
      <label><span>止损价</span><input id="riskStopPrice" inputmode="decimal"><b>USDT</b></label>
      <label><span>目标价</span><input id="riskTargetPrice" inputmode="decimal"><b>USDT</b></label>
      <label><span>单笔风险</span><input id="riskPercent" inputmode="decimal" value="1"><b>%</b></label>
    </div>
    <div class="risk-sizing-presets">
      <button type="button" data-risk-percent="0.25">0.25%</button>
      <button type="button" data-risk-percent="0.5">0.5%</button>
      <button class="active" type="button" data-risk-percent="1">1%</button>
      <button type="button" data-risk-percent="2">2%</button>
    </div>
    <div class="risk-sizing-results">
      <div><span>风险预算</span><b id="riskBudgetValue">--</b></div>
      <div><span>建议数量</span><b id="riskQuantityValue">--</b></div>
      <div><span>预计最大亏损</span><b id="riskMaxLossValue">--</b></div>
      <div><span>盈亏比</span><b id="riskRewardValue">--</b></div>
    </div>
    <p class="risk-sizing-status" id="riskSizingStatus">填写止损价后计算</p>
    <button type="button" data-risk-sizing-apply disabled>使用建议数量</button>
  </div>
</section>
```

- [ ] **Step 3: 实现账户与市场读取**

- 账户权益优先读取 `#accountEquity`；读取失败时从本地账本计算现金与持仓标记价值。
- 可用现金读取 `#availableBalance`。
- 当前入场价：市价单使用 `#lastPrice`，其他订单使用 `#orderPrice`。
- 当前持仓数量从本地状态中按 `activeSymbol` 汇总。
- 当前 side 从 `.side-selector [data-side].active` 读取。

- [ ] **Step 4: 实现按交易对持久化**

使用键 `atlasX.pro.riskPlans.v1`：

```js
{
  "BTCUSDT": { "riskPercent": 1, "stopPrice": 62000, "targetPrice": 68000 },
  "ETHUSDT": { "riskPercent": 0.5, "stopPrice": 3300, "targetPrice": 3800 }
}
```

切换交易对后重新读取当前符号计划；不得保存入场价，入场价始终跟随当前订单上下文。

- [ ] **Step 5: 实现一键填入**

```js
quantityInput.value = formattedQuantity;
quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
```

不得直接修改总额或手续费元素，必须让原 `syncOrderFields('quantity')` 处理。

- [ ] **Step 6: 提交**

```bash
git add atlas-x-pro/risk-position-sizing.js
git commit -m "feat: add risk based position sizing"
```

---

### Task 3: 完成桌面与移动视觉集成

**Files:**
- Create: `atlas-x-pro/risk-position-sizing.css`
- Modify: `atlas-x-pro/bootstrap.js`

**Interfaces:**
- Consumes: Task 2 注入的类名。
- Produces: 桌面紧凑折叠面板和手机订单 Sheet 内自然滚动布局。

- [ ] **Step 1: 编写桌面样式**

要求：
- 折叠态最小高度 48px；
- 展开态输入使用两列网格；
- 结果四项使用两列网格；
- 状态文本与按钮使用现有 `--atlas-ui-font`；
- 数值使用 `var(--mono)`；
- 无渐变、无发光、边框与现有订单面板一致。

- [ ] **Step 2: 编写手机样式**

在 `@media (max-width: 820px)` 中：
- 输入与结果改为单列或两列；
- 所有按钮最小高度 40px；
- 面板宽度 `100%`、`min-width: 0`；
- 不使用固定高度；
- 不遮挡 `.submit-order`。

- [ ] **Step 3: 接入启动链**

在样式数组加入：

```js
'./risk-position-sizing.css',
```

在 `portfolio-risk.js` 之后、`market-intelligence.js` 之前加载：

```js
await loadScript('./risk-position-sizing.js');
```

- [ ] **Step 4: 提交**

```bash
git add atlas-x-pro/risk-position-sizing.css atlas-x-pro/bootstrap.js
git commit -m "style: integrate risk sizing across viewports"
```

---

### Task 4: 全套验证与人工审查

**Files:**
- Modify only if validation finds a reproducible defect.

**Interfaces:**
- Consumes: GitHub Actions 四端产物。
- Produces: 四端全绿和桌面/手机实图审查结论。

- [ ] **Step 1: 运行完整流水线**

Expected: `Capture and validate`、专业工作区、订单保护、绩效账本、组合风险、风险仓位、实时市场情报、行情路由、中文字体、移动布局和移动账户工具全部成功。

- [ ] **Step 2: 下载 1440×900 与 390×844 产物**

检查：
- 折叠态不挤压原订单区；
- 展开态字段层级清楚；
- 数值无方框字；
- 手机可滚动到“使用建议数量”和原提交按钮；
- 无横向溢出；
- 一键填入后数量、总额和手续费同时变化。

- [ ] **Step 3: 缺陷先写守卫再修复**

任何视觉或账务缺陷必须先增加可复现的几何/计算断言，再修改 CSS 或 JS。

- [ ] **Step 4: 最终提交与报告**

最终报告必须给出：最新提交 SHA、四端结果、核心公式、已验证的限制条件和下一轮对标模块。
