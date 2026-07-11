# Professional Alert Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ATLAS X Pro 的静态通知铃铛升级为支持价格穿越规则、业务事件采集、未读计数、冷却去重和规则管理的专业预警中心。

**Architecture:** 新模块在捕获阶段接管通知铃铛，但继续复用 `#controlPopover` 与 `[data-close-popover]`，保持旧基础交互兼容。模块独立存储规则、事件和业务快照，不写核心交易账本；通过 DOM MutationObserver、storage 事件和显式 `evaluateNow()` 合并评估。

**Tech Stack:** 原生 HTML/CSS/JavaScript、localStorage、MutationObserver、Playwright Core、GitHub Actions。

## Global Constraints

- 不修改现金、持仓、委托、成交历史和模拟撮合逻辑。
- 不申请浏览器系统通知权限。
- 不声称页面关闭后仍监控。
- 最多保存 30 条规则、100 条事件。
- 四端验收：390×844、430×932、1440×900、1920×1080。
- 新选择器统一使用 `alert-center-` 或 `data-alert-*` 前缀。

---

### Task 1: 建立失败验收

**Files:**
- Create: `qa/atlas-x-pro/pro-alert-center.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

- [ ] **Step 1: 写失败测试**

固定 BTC 持仓与空事件状态，验证：

- 铃铛打开专业预警中心；
- 创建价格上穿规则；
- 阈值穿越产生一条未读；
- 持续位于阈值上方与冷却期内再次穿越不重复；
- 全部已读清除角标；
- 新成交、OCO 止损、退出策略完成各采集一次；
- 规则启停和删除；
- 手机无溢出和触控高度。

- [ ] **Step 2: 接入 CI**

在工作区命令中心后增加：

```yaml
- name: Verify professional alert center
  env:
    CHROME_BIN: /usr/bin/google-chrome
    ATLAS_VIEWPORT: ${{ matrix.viewport }}
  run: node qa/atlas-x-pro/pro-alert-center.mjs
```

上传 `qa-artifacts-pro/pro-alert-center-report.json`。

- [ ] **Step 3: 验证红灯**

Expected: 既有步骤先通过，新步骤因 `dataset.alertCenter` 不存在而失败。

### Task 2: 数据模型与价格规则引擎

**Files:**
- Create: `atlas-x-pro/pro-alert-center.js`

- [ ] **Step 1: 实现存储迁移与上限**

默认结构包含 `rules`、`events`、`snapshots`、`ui`。写入前裁剪规则 30 条、事件 100 条。

- [ ] **Step 2: 实现价格穿越**

每条规则独立保存 `lastObservedPrice`；只有真正跨越阈值时触发，且检查 `cooldownMs`。

- [ ] **Step 3: 实现未读派生值**

未读数量从事件 `read:false` 实时计算，不另存冗余计数。

- [ ] **Step 4: 暴露受控接口**

```js
window.AtlasAlertCenter = {
  getState,
  open,
  close,
  evaluateNow,
  createPriceRule,
  markAllRead,
};
```

### Task 3: 业务事件采集

**Files:**
- Modify: `atlas-x-pro/pro-alert-center.js`

- [ ] **Step 1: 核心成交快照**

首次启动只记录现有 history ID；后续新 ID 生成 `core-fill:<id>` 事件。

- [ ] **Step 2: OCO 状态转换**

只采集从已知旧状态变化到终态的事件，使用 `oco:<id>:<status>` 去重。

- [ ] **Step 3: 退出策略转换**

追踪止损完成为 critical；分批部分完成为 warning；全部完成为 info。

- [ ] **Step 4: 稳定去重**

所有业务事件写入前检查 `sourceKey`，重复评估不新增。

### Task 4: 预警中心界面

**Files:**
- Create: `atlas-x-pro/pro-alert-center.css`
- Modify: `atlas-x-pro/pro-alert-center.js`

- [ ] **Step 1: 接管通知按钮**

在捕获阶段阻止旧 `pro-polish.js` 通知处理器，调用新 `open()`。继续展示 `#controlPopover`。

- [ ] **Step 2: 构建摘要与页签**

摘要显示活动规则、未读、最近事件；页签：全部、未读、规则。

- [ ] **Step 3: 规则创建与管理**

表单包含方向、阈值、+1%/-1% 快捷值、创建按钮；规则支持启停和删除。

- [ ] **Step 4: 事件操作**

单条点击已读、全部已读、清空已读。

- [ ] **Step 5: 铃铛角标**

使用 `.alert-center-badge`，0 隐藏，1–99 准确，超过 99 显示 99+。

### Task 5: 启动链与观察器

**Files:**
- Modify: `atlas-x-pro/bootstrap.js`

- [ ] **Step 1: 加载样式与脚本**

在工作区命令中心之后、市场情报之前加载。

- [ ] **Step 2: 合并调度**

观察 `#lastPrice`、当前交易对、订单与策略列表；40ms 去抖后执行一次评估。

- [ ] **Step 3: 页面状态声明**

完成初始化后设置 `document.documentElement.dataset.alertCenter = 'ready'`。

### Task 6: 四端回归与人工审查

- [ ] **Step 1: 跑完整四端 CI**

Expected: 四个矩阵任务全部 success。

- [ ] **Step 2: 下载桌面和 390 手机截图**

检查弹层高度、页签密度、未读角标、规则卡片和触控可达性。

- [ ] **Step 3: 对照设计逐项验收**

确认没有系统通知权限、自动下单或后台持续运行表述。
