# Professional Market Screener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and verification-before-completion.

**Goal:** 在现有市场情报页中增加真实多维行情筛选、排序、自选联动和最多四市场对比。

**Architecture:** 独立模块观察 `.module-overlay[data-module="markets"]`，等待现有市场情报渲染完成后注入筛选器。远端数据来自 Binance 公共 ticker/bookTicker；失败时只使用 10 分钟内缓存，否则显示部分数据。模块不修改模拟撮合账本。

## Task 1 — 失败验收

- Create `qa/atlas-x-pro/pro-market-screener.mjs`
- Modify `.github/workflows/atlas-x-pro-qa.yml`
- Playwright 拦截 24h ticker 与 bookTicker，返回固定 12 市场数据。
- 验证渲染、派生指标、搜索、排序、筛选、自选、4 个对比上限、持久化、切换交易对和手机布局。
- 当前页面无 `.pro-market-screener`，因此新增步骤必须单独失败。

## Task 2 — 数据获取与缓存

- Create `atlas-x-pro/pro-market-screener.js`
- 实现：
  - `fetchTicker24h()`；
  - `fetchBookTicker()`；
  - 8 秒超时；
  - 30 秒请求去重；
  - 10 分钟缓存；
  - 部分数据状态；
  - 振幅与点差派生值。
- 不可用字段保持 `null`，渲染为 `--`。

## Task 3 — 筛选器和对比托盘

- Create `atlas-x-pro/pro-market-screener.css`
- 替换基础排名面板，保留原热力图与市场广度。
- 桌面使用完整表格；手机使用卡片。
- 支持 query/filter/sort/direction/selected 持久化。
- 最多 4 个对比市场。

## Task 4 — 自选与打开交易

- 星标点击复用现有市场行或当前市场收藏控件，确保核心 favorites 同步。
- 打开交易复用现有 `[data-symbol]` 市场行点击，再关闭模块。
- 不直接写 `atlasX.pro.v1` 的订单和账户字段。

## Task 5 — 启动链与回归

- Modify `atlas-x-pro/bootstrap.js`
- 在 `market-intelligence.js` 后加载筛选器。
- 设置 `document.documentElement.dataset.marketScreener = 'ready'`。
- 四端完整 CI 全绿后下载 1440 与 390 实图审查。
