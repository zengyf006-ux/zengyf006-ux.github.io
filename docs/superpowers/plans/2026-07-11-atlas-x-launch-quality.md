# ATLAS X Launch Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ATLAS X 核心交易主屏完成为可公开展示、所有可见控件有反馈、状态可保存的第一版模拟交易终端。

**Architecture:** 继续使用零构建静态工程。`index.html` 负责语义结构和弹层容器，`styles.css`/`polish.css` 负责桌面与移动端布局，`app.js` 统一管理演示行情、交易状态、持久化和交互，`qa/visual-next/capture.mjs` 执行浏览器验收。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、Canvas、localStorage、Playwright Core、GitHub Actions。

## Global Constraints

- 不修改 `main` 或线上旧站。
- 不使用 iframe，不引用 v7—v14。
- 不接真实资产、充值提现或交易所密钥。
- 不增加链上、跟单、策略商城、闪兑、AI荐币、社区或理财。
- 必须通过 390×844、430×932、1440×900、1920×1080。
- 所有可见按钮必须有状态变化或明确反馈。

---

### Task 1: 完整化页面结构

**Files:**
- Modify: `atlas-x-next/index.html`
- Test: `qa/visual-next/capture.mjs`

**Interfaces:**
- Produces: `#marketPicker`, `#notificationPopover`, `#accountPopover`, `#moreMenu`, `#chartSettings`, `[data-account-view]`, `[data-nav-target]`。

- [ ] 增加交易对选择弹层、通知/账户/更多弹层和统一遮罩。
- [ ] 给主导航、收藏、图表设置、盘口设置、账户标签补充稳定的 `data-*` 接口。
- [ ] 保持现有语义和移动端下单面板不回退。
- [ ] 提交：`feat: add complete ATLAS interaction surfaces`。

### Task 2: 重构状态与交互

**Files:**
- Modify: `atlas-x-next/app.js`

**Interfaces:**
- Produces: `selectMarket(symbol)`, `setAccountView(view)`, `setBookMode(mode)`, `saveState()`, `restoreState()`。

- [ ] 将交易对、周期、自选、持仓、成交和当前视图集中到单一状态对象。
- [ ] 实现 BTC、ETH、SOL 切换并同步 DOM、Canvas、盘口和订单文案。
- [ ] 实现所有弹层、导航反馈、收藏、图表指标、全屏和盘口模式。
- [ ] 实现持仓、当前委托、历史成交真实切换和刷新持久化。
- [ ] 任何 localStorage 或 Fullscreen API 错误都退化为 toast，不抛未捕获异常。
- [ ] 提交：`feat: complete ATLAS simulated trading interactions`。

### Task 3: 上线级视觉收口

**Files:**
- Modify: `atlas-x-next/styles.css`
- Modify: `atlas-x-next/polish.css`

**Interfaces:**
- Consumes: Task 1 新增的弹层和状态类。

- [ ] 设计桌面锚定浮层与手机底部选择面板。
- [ ] 统一 hover、active、disabled、selected、loading、empty 状态。
- [ ] 优化手机顶部、盘口、账户标签、弹层和安全区。
- [ ] 增加 `prefers-reduced-motion` 与触控最小尺寸规则。
- [ ] 提交：`style: finish ATLAS launch-quality interaction design`。

### Task 4: 扩展真实浏览器验收

**Files:**
- Modify: `qa/visual-next/capture.mjs`

**Interfaces:**
- Consumes: Task 1/2 的稳定选择器和状态接口。

- [ ] 验证交易对切换到 ETH 后标题、价格、币种和下单按钮同步。
- [ ] 验证收藏、盘口模式、账户标签和导航反馈。
- [ ] 验证手机交易对面板和下单面板无遮挡。
- [ ] 验证 localStorage 状态在刷新后恢复。
- [ ] 输出主屏、交易对面板、盘口、下单、账户视图截图。
- [ ] 提交：`test: expand ATLAS launch-quality browser QA`。

### Task 5: 清理遗留实验文件

**Files:**
- Delete: `atlas-x-next/app-core.js`
- Delete: `atlas-x-next/styles-core.css`
- Delete: `qa/visual-next/build_v3.py`
- Delete: `qa/visual-next/patch_v3.py`

- [ ] 确认没有正式文件引用上述文件。
- [ ] 删除已废弃实验构建链。
- [ ] 重新运行完整 Actions。
- [ ] 提交：`chore: remove obsolete ATLAS prototype files`。
