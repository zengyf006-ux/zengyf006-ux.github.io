# Professional Workspace Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ATLAS X Pro 增加命令面板、四种工作区模式、三套交易预设、专业快捷键和覆盖全部提交入口的统一交易安全锁。

**Architecture:** 新模块通过 DOM 事件驱动既有终端，不读取或修改 `app.js` 闭包状态。独立存储 `atlasX.pro.workspace.v1`，通过 `data-workspace-mode` 与 `data-trading-locked` 驱动布局和锁定视觉；捕获阶段统一阻止提交。

**Tech Stack:** 原生 HTML/CSS/JavaScript、localStorage、MutationObserver、Playwright Core、GitHub Actions。

## Global Constraints

- 不改动核心行情、模拟撮合、现金、持仓、委托和历史账本计算。
- 不增加第三方运行时依赖。
- 新选择器使用 `workspace-` 或 `data-workspace-*` 前缀。
- 不提供键盘直接提交订单。
- 四端验收：390×844、430×932、1440×900、1920×1080。
- 锁定必须覆盖普通订单、OCO、追踪止损和分批止盈。

---

### Task 1: 建立失败验收

**Files:**
- Create: `qa/atlas-x-pro/workspace-command-center.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

**Interfaces:**
- Consumes: 页面现有 `#quickSearchButton`、`#layoutButton`、`#submitOrder` 和高级策略提交入口。
- Produces: `qa-artifacts-pro/workspace-command-center-report.json`。

- [ ] **Step 1: 写失败测试**

测试固定本地账户和 BTC 持仓，验证：命令面板、ETH 切换、风险工作区持久化、均衡预设、锁定四类提交、两步解锁、输入框快捷键隔离和手机无溢出。

- [ ] **Step 2: 接入 CI**

在退出策略验收后增加：

```yaml
- name: Verify workspace command center
  env:
    CHROME_BIN: /usr/bin/google-chrome
    ATLAS_VIEWPORT: ${{ matrix.viewport }}
  run: node qa/atlas-x-pro/workspace-command-center.mjs
```

并上传 `qa-artifacts-pro/workspace-command-center-report.json`。

- [ ] **Step 3: 运行验证红灯**

Run: GitHub Actions `ATLAS X Pro acceptance`
Expected: 既有步骤先通过，`Verify workspace command center` 因 `.workspace-command-dialog` 不存在而失败。

- [ ] **Step 4: Commit**

```bash
git add qa/atlas-x-pro/workspace-command-center.mjs .github/workflows/atlas-x-pro-qa.yml
git commit -m "test: define workspace command center acceptance"
```

### Task 2: 命令面板与动作路由

**Files:**
- Create: `atlas-x-pro/workspace-command-center.js`
- Create: `atlas-x-pro/workspace-command-center.css`

**Interfaces:**
- Produces: `window.AtlasWorkspace.openCommand()`, `closeCommand()`, `getState()`, `setMode()`, `applyPreset()`, `setLocked()`。

- [ ] **Step 1: 实现独立存储与 UI 注入**

存储默认值：

```js
const DEFAULT_STATE = {
  version: 1,
  mode: 'standard',
  preset: 'balanced',
  locked: false,
  updatedAt: 0,
};
```

注入命令面板、布局面板、搜索框、结果列表和空状态。

- [ ] **Step 2: 实现命令索引**

市场从页面 `[data-symbol]` 去重读取；动作使用独立 `data-workspace-command`，包括模式、方向、订单类型、周期和锁定。

- [ ] **Step 3: 实现键盘导航**

支持 ArrowUp、ArrowDown、Enter、Escape 和 `⌘/Ctrl + K`；执行后恢复焦点。

- [ ] **Step 4: 运行单项验收**

Run: `node qa/atlas-x-pro/workspace-command-center.mjs`
Expected: 命令面板、ETH 切换相关检查通过；工作区、预设和锁定检查仍失败。

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/workspace-command-center.js atlas-x-pro/workspace-command-center.css
git commit -m "feat: add command palette and action routing"
```

### Task 3: 工作区模式与交易预设

**Files:**
- Modify: `atlas-x-pro/workspace-command-center.js`
- Modify: `atlas-x-pro/workspace-command-center.css`

**Interfaces:**
- Consumes: 现有 `[data-side]`、`[data-order-type]`、`[data-timeframe]`、`#postOnly`、`#riskPercent`。
- Produces: `data-workspace-mode` 和持久化预设状态。

- [ ] **Step 1: 实现四种模式**

`standard`、`chart`、`execution`、`risk` 仅改变 CSS 布局；risk 模式触发持仓页签。

- [ ] **Step 2: 实现三套预设**

```js
const PRESETS = {
  conservative: { orderType: 'limit', postOnly: true, riskPercent: 0.5 },
  balanced: { orderType: 'limit', postOnly: false, riskPercent: 1 },
  active: { orderType: 'market', postOnly: false, riskPercent: 1.5 },
};
```

只更新控件并派发 `input/change`，不填数量、不点击提交。

- [ ] **Step 3: 验证刷新恢复**

Run: `node qa/atlas-x-pro/workspace-command-center.mjs`
Expected: 模式、刷新恢复和预设检查通过。

- [ ] **Step 4: Commit**

```bash
git add atlas-x-pro/workspace-command-center.js atlas-x-pro/workspace-command-center.css
git commit -m "feat: add workspace modes and trade presets"
```

### Task 4: 统一安全锁与快捷键

**Files:**
- Modify: `atlas-x-pro/workspace-command-center.js`
- Modify: `atlas-x-pro/workspace-command-center.css`

**Interfaces:**
- Consumes: `#submitOrder`、`#createOcoOrder`、退出策略提交按钮。
- Produces: `document.documentElement.dataset.tradingLocked` 和统一锁定提示。

- [ ] **Step 1: 捕获阶段拦截**

提交选择器：

```js
const TRADE_SUBMIT_SELECTOR = [
  '#submitOrder',
  '#createOcoOrder',
  '#createTrailingExit',
  '#createScaledExit',
  '[data-create-trailing-exit]',
  '[data-create-scaled-exit]',
].join(',');
```

锁定时 `preventDefault()`、`stopImmediatePropagation()`，显示统一提示，不修改账本。

- [ ] **Step 2: 两步解锁**

首次请求设置 3 秒确认窗口；第二次才写入 `locked:false`。超时恢复初始状态。

- [ ] **Step 3: 专业快捷键**

输入控件内完全忽略 B/S/M/L/T；无下单快捷键。移动端 B/S 使用现有移动买卖按钮。

- [ ] **Step 4: 验证安全边界**

Run: `node qa/atlas-x-pro/workspace-command-center.mjs`
Expected: 四类提交均被阻止、单击不能解锁、二次确认后解锁、输入框隔离通过。

- [ ] **Step 5: Commit**

```bash
git add atlas-x-pro/workspace-command-center.js atlas-x-pro/workspace-command-center.css
git commit -m "feat: add unified trading lock and hotkeys"
```

### Task 5: 启动链、全回归与实图审查

**Files:**
- Modify: `atlas-x-pro/bootstrap.js`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

**Interfaces:**
- Consumes: Task 2–4 的脚本和样式。
- Produces: 四端完整绿色流水线和截图。

- [ ] **Step 1: 接入启动链**

在 `reservation-coordinator` 后加载样式和脚本，确保核心订单模块已完成初始化。

- [ ] **Step 2: 跑四端全链**

Run: GitHub Actions `ATLAS X Pro acceptance`
Expected: 四个矩阵任务全部 success，包含全部既有步骤和新增工作区步骤。

- [ ] **Step 3: 人工审查截图**

检查桌面命令面板层级、布局切换、锁定状态；检查 390 手机底部抽屉、触控高度和横向溢出。

- [ ] **Step 4: Commit**

```bash
git add atlas-x-pro/bootstrap.js .github/workflows/atlas-x-pro-qa.yml
git commit -m "feat: integrate professional workspace command center"
```
