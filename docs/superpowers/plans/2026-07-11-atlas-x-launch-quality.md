# ATLAS X Launch Quality Implementation Plan

> **Status:** Completed on 2026-07-11. Final verification: GitHub Actions run `29113683076`, all four viewport suites passed.

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
- Produces: `#marketPicker`, `#floatingMenu`, `[data-account-view]`, `[data-nav-target]`。

- [x] 增加交易对选择弹层、通知/账户/更多弹层和统一遮罩。
- [x] 给主导航、收藏、图表设置、盘口设置、账户标签补充稳定的 `data-*` 接口。
- [x] 保持现有语义和移动端下单面板不回退。
- [x] 完成交互结构提交。

### Task 2: 重构状态与交互

**Files:**
- Modify: `atlas-x-next/app.js`

**Interfaces:**
- Produces: 交易对切换、账户视图、盘口模式、状态保存与恢复。

- [x] 将交易对、周期、自选、持仓、成交和当前视图集中到单一状态对象。
- [x] 实现 BTC、ETH、SOL 切换并同步 DOM、Canvas、盘口和订单文案。
- [x] 实现所有弹层、导航反馈、收藏、图表指标、全屏和盘口模式。
- [x] 实现持仓、当前委托、历史成交真实切换和刷新持久化。
- [x] localStorage 或 Fullscreen API 错误均退化处理，不抛未捕获异常。
- [x] 完成模拟交易交互提交。

### Task 3: 上线级视觉收口

**Files:**
- Modify: `atlas-x-next/styles.css`
- Modify: `atlas-x-next/polish.css`
- Add: `atlas-x-next/enhancements.css`
- Add: `atlas-x-next/finalize.css`

**Interfaces:**
- Consumes: Task 1 新增的弹层和状态类。

- [x] 设计桌面锚定浮层与手机底部选择面板。
- [x] 统一 hover、active、selected、empty 等状态。
- [x] 优化手机顶部、盘口、账户标签、弹层和安全区。
- [x] 增加 `prefers-reduced-motion` 与触控规则。
- [x] 完成上线级交互视觉收口。

### Task 4: 扩展真实浏览器验收

**Files:**
- Modify: `qa/visual-next/capture.mjs`

**Interfaces:**
- Consumes: Task 1/2 的稳定选择器和状态接口。

- [x] 验证交易对切换到 ETH 后标题、价格、币种、指标和下单按钮同步。
- [x] 验证收藏、盘口模式、账户标签和导航反馈。
- [x] 验证手机交易对面板、盘口、下单面板和持仓卡片无遮挡。
- [x] 验证 localStorage 状态在刷新后恢复。
- [x] 输出主屏、交易对面板、盘口、下单、账户视图截图。
- [x] 禁止客户展示文案及误导性“公开行情/行情在线”文案。
- [x] 四种视口全部通过。

### Task 5: 清理遗留实验文件

**Files:**
- Delete: `atlas-x-next/app-core.js`
- Delete: `atlas-x-next/styles-core.css`
- Delete: `qa/visual-next/build_v3.py`
- Delete: `qa/visual-next/patch_v3.py`

- [x] 确认没有正式文件引用上述文件。
- [x] 删除已废弃实验构建链。
- [x] 清理后重新运行完整 Actions。
- [x] 完成遗留文件清理。

## Final Verification Evidence

- GitHub Actions run: `29113683076`
- Result: success
- Viewports: `390×844`, `430×932`, `1440×900`, `1920×1080`
- Structural failures: 0
- Interaction failures: 0
- Console errors: 0
- Page errors: 0
- Forbidden copy matches: 0
- Work branch: `atlas-x-rebuild-ui`
- Live/main branch: unchanged
