# ATLAS X Pro — 项目持续状态与交接记录

> 本文件是 ATLAS X Pro 的长期交接依据。更换聊天、人员或执行工具后，必须先读取本文件，再继续工作，不得依赖聊天记忆猜测。

最后更新：2026-07-11

## 1. 项目身份

- 项目名称：ATLAS X Pro
- GitHub 仓库：`zengyf006-ux/zengyf006-ux.github.io`
- 正式目录：`atlas-x-pro/`
- 线上分支：`main`
- 主开发分支：`atlas-x-pro-terminal`
- 主开发 PR：`#4 ATLAS X Pro：专业交易终端系统级重构`
- 阶段一分支：`atlas-x-realtime-chart-stage1`
- 阶段一 PR：`#5 ATLAS X Stage 1：实时行情与专业 K 线重构`
- 线上访问路径：`/atlas-x-pro/`
- 产品边界：公开行情驱动的高保真模拟交易平台；不接真实资金、充值、提现、真实交易所账户、API Key、Secret、私钥或助记词。

## 2. 当前阶段状态

### 阶段一：实时行情、专业 K 线与市场筛选器

状态：**开发、真实网络门禁、四端完整回归和人工视觉复核均已完成，下一步安全整合到主开发分支。**

- 最新已验证运行时代码提交：`ac64fbb94e304f1195bd3e4c91599e5513a182cf`
- `ATLAS X Pro acceptance`：Run `29150223095`，结论 `success`
  - Gateway contract：通过
  - Gateway real-network smoke：通过
  - iPhone 390 × 844：全部适用步骤通过
  - iPhone 430 × 932：全部适用步骤通过
  - Desktop 1440 × 900：全部适用步骤通过
  - Desktop 1920 × 1080：全部适用步骤通过
- 当前头部四端产物：
  - 390：Artifact `8247949784`
  - 430：Artifact `8247950524`
  - 1440：Artifact `8247951648`
  - 1920：Artifact `8247950684`
- 本文件之后若仅追加 Markdown 状态记录，不改变上述运行时代码验收结论。
- 阶段一尚未部署到 `main`；不得把当前状态称为最终成品。

### 当前实测性能

以下数据来自 Run `29150223095` 的确定性浏览器验收：

| 视口 | 首次进入实时状态 | 连续切换至 1D 后提交 | 最终周期 | 最终间隔 |
|---|---:|---:|---|---:|
| 390 × 844 | 373 ms | 241 ms | `1d` | 86,400,000 ms |
| 430 × 932 | 482 ms | 279 ms | `1d` | 86,400,000 ms |
| 1440 × 900 | 654 ms | 311 ms | `1d` | 86,400,000 ms |
| 1920 × 1080 | 640 ms | 297 ms | `1d` | 86,400,000 ms |

测试同时确认：快速切换时最后一次请求获胜，旧回包不会覆盖当前周期；最终请求代际为 `4`。

## 3. 已部署公共行情基础设施

### 主实时行情网关

- Supabase 项目：`vtcunypvhtudragsittb`
- Edge Function：`atlas-market-gateway`
- 部署 ID：`92975cba-f2d1-4b68-bd4c-66c602839102`
- 状态：`ACTIVE`
- 地址：`https://vtcunypvhtudragsittb.supabase.co/functions/v1/atlas-market-gateway`
- 接口：`/health`、`/markets`、`/snapshot`、`/candles`、`/stream`
- 上游：Binance、OKX、Bybit 公共行情
- 用途：历史 K 线、当前快照、订单簿、最近成交、SSE 实时流和健康状态

### 批量市场指标网关

- Edge Function：`atlas-market-gateway-markets`
- 部署 ID：`b51ec9a3-e983-4071-88a8-ab5f50701b70`
- 状态：`ACTIVE`
- 地址：`https://vtcunypvhtudragsittb.supabase.co/functions/v1/atlas-market-gateway-markets`
- 接口：`/health`、`/markets`
- 用途：一次请求获取 12 个市场的价格、涨跌、成交额、振幅、买一、卖一、点差和成交笔数
- 目的：避免筛选器为 12 个市场分别发起快照请求，不拖慢首屏和主实时流

### 安全边界

- 两个函数只处理公开行情。
- 不接收或保存用户账户、订单、余额、密钥、个人信息或支付数据。
- 公开函数关闭 Supabase JWT 校验，但函数内部实施 Origin 白名单、GET/OPTIONS 限制、参数白名单、超时、限流和标准化错误。
- 禁止任意 URL 代理，避免 SSRF。

## 4. 阶段一已完成能力

### 统一行情引擎

- 独立 `market-data-engine` 负责会话、缓存、请求代际、网络降级和新鲜度，不再把全部网络逻辑塞进旧 `app.js`。
- 交易对或周期切换时递增 `requestGeneration`、取消旧请求并关闭旧实时连接。
- 每次异步写入前校验代际，旧请求晚返回不能覆盖当前会话。
- IndexedDB 保存最近有效快照和 K 线，支持缓存优先首屏。
- 正常模式优先公开实时流；直连不可用时降级至 Supabase SSE。
- 连接状态明确区分：`booting`、`live`、`reconnecting`、`stale`、`offline`。
- 当前价格、订单簿、逐笔成交和当前 K 线使用同一行情会话。
- 数据过期后退出“实时”状态，不把随机数据伪装成实时。

### 正确周期体系

支持并验证：

- `1m`、`3m`、`5m`、`15m`、`30m`
- `1h`、`2h`、`4h`、`6h`、`12h`
- `1d`、`1w`

规则：

- 每个周期有明确毫秒映射。
- 测试与降级数据同样按真实周期生成时间戳，禁止固定 60 秒。
- 快速连续切换时只能提交最后一次选择。
- `30m`、`2h`、`1w` 等周期刷新页面后继续保持。

### 专业 K 线体验

- 选中蜡烛展示时间、周期、开盘、最高、最低、收盘、涨跌额、涨跌幅、振幅、成交量、成交额、EMA10、EMA20、数据源和收盘状态。
- 同一根再次点击、关闭按钮、Esc、空白区域、切周期、切交易对和重置均可取消选中。
- 显示可视区最高价、最低价、最新价线和当前蜡烛倒计时。
- 显示数据年龄以及实时、重连、过期、离线状态。
- 切周期时保留旧图作为过渡，不再长时间白屏。

### 专业市场筛选器

- 行情统一通过公共网关获取，不维护第二套浏览器直连 Binance REST。
- 支持搜索、成交额/涨跌幅/振幅/点差/价格排序与升降序。
- 支持高振幅、低点差筛选、自选同步和最多四市场对比。
- 偏好持久化。
- 网关失败时使用 10 分钟内有效缓存；缓存过期后进入部分数据模式，缺失指标显示 `--`。
- 桌面和手机均有独立入口以及合格触控尺寸。

### 数据健康与兼容

- 数据健康中心已接入 Stage 1 行情内核，展示统一会话、数据源、周期、延迟和连接状态。
- 保留旧官方端点路由作为回滚能力，但生产行情所有权已迁移到新引擎。
- 手机预警、审计、持仓卡片、筛选器入口和追踪止损标签均完成同步触控/几何加固，消除异步 CSS 竞态。

## 5. 阶段一主要文件

### 前端运行时

- `atlas-x-pro/market-data-engine.js`
- `atlas-x-pro/chart-experience.js`
- `atlas-x-pro/realtime-market-integration.js`
- `atlas-x-pro/realtime-market-chart.css`
- `atlas-x-pro/realtime-market-chart-fixes.css`
- `atlas-x-pro/interval-persistence-compat.js`
- `atlas-x-pro/data-health-stage1.js`
- `atlas-x-pro/pro-market-screener.js`
- `atlas-x-pro/pro-market-screener.css`
- `atlas-x-pro/pro-market-screener-touch.css`
- `atlas-x-pro/pro-alert-center-mobile.js`
- `atlas-x-pro/pro-alert-draft-stability.js`
- `atlas-x-pro/pro-alert-create-stability.js`
- `atlas-x-pro/pro-alert-tab-stability.js`
- `atlas-x-pro/order-execution-audit-mobile-critical.js`
- `atlas-x-pro/market-intelligence-entry-compat.js`
- `atlas-x-pro/continuous-hardening.css`

### 网关

- `supabase/functions/atlas-market-gateway/index.ts`
- `supabase/functions/atlas-market-gateway/normalizers.mjs`
- `supabase/functions/atlas-market-gateway/deno.json`
- `supabase/functions/atlas-market-gateway-markets/index.ts`

### 验收

- `qa/atlas-x-pro/gateway-contract.mjs`
- `qa/atlas-x-pro/gateway-smoke.mjs`
- `qa/atlas-x-pro/realtime-market-chart.mjs`
- `qa/atlas-x-pro/interval-persistence.mjs`
- `qa/atlas-x-pro/pro-market-screener.mjs`
- `qa/atlas-x-pro/market-data-router.mjs`
- `.github/workflows/atlas-x-pro-qa.yml`

## 6. 本轮同时修复的既有回归

- 旧演示 K 线固定 60 秒导致不同周期看起来相同。
- 周期请求没有代际隔离。
- QA 完全绕过真实网络，无法证明公开行情网关可用。
- 手机 K 线详情卡拦截同一蜡烛第二次点击。
- 测试预置的限价买单可立即成交，却要求它继续显示等待委托线。
- OCO 测试在新行情价格尚未同步时构造保护单。
- 实时价格刷新导致专业预警中心重绘表单并清空草稿。
- 手机市场入口 DOM 重排后丢失点击监听。
- 专业市场筛选器原先只有样式和测试，没有完整运行脚本。
- 筛选器维护第二套浏览器直连行情源。
- 多处手机触控尺寸因异步样式加载在测试和真实使用中不稳定。
- 追踪止损线容器几何高度为零，屏幕阅读与自动化无法可靠判断。
- 质量层在全部移动端模块加载完成前过早宣布 `ready`。

## 7. 当前完整产品能力

- 专业桌面工作区和手机独立交易流程。
- 公开实时行情、缓存首屏、实时/重连/过期/离线状态。
- 市场列表、自选、搜索、专业筛选器和最多四市场对比。
- 12 个 K 线周期、订单簿、深度图和逐笔成交。
- 市价、限价和高级模拟委托。
- 余额、持仓、委托、成交、费用、滑点和盈亏。
- 下单执行保护、大额确认、交易安全锁和二次解锁。
- 账本派生绩效分析、组合风险、风险仓位计算和交易计划。
- 图表交易层、OCO、追踪止损、分批退出和统一预留协调。
- 工作区模式、命令中心、预设和快捷键。
- 专业预警中心。
- 订单与成交审计中心。
- 中文语义字体、数据健康和高级视觉状态。

## 8. 人工视觉审查结论

审查基于 Run `29150223095` 的当前头部截图：390 × 844、430 × 932、1440 × 900、1920 × 1080。

已通过：

- 四端主屏无横向溢出、白屏、乱码、明显遮挡或关键控件裁切。
- 手机与桌面均可看到行情状态、完整周期栏、高低点和最新价。
- K 线详情字段完整，关闭入口明确，字体可读。
- 手机预警中心、审计中心、数据健康、下单面板和预留状态均可读可操作。
- 桌面四区工作台维持专业密度；新增功能进入抽屉、详情区或下方工作区，没有继续挤压核心 K 线。
- 1440 与 1920 下的订单簿、逐笔成交、下单票据和账户区对齐稳定。

必须继续处理的视觉债务：

- 手机交易主屏信息密度仍偏高，顶部状态与图表工具需要系统级重排。
- 手机蜡烛详情卡覆盖图表面积偏大，应改为轻量顶部数据条或可拖动底部信息层。
- 手机下单、盘口和图表仍像多个模块拼接，尚未形成最终成品的一体化节奏。
- 桌面低优先级文字偏小，后续通过信息密度档位解决，不做粗暴全局放大。

阶段一结论：**行情、周期、K 线与相关回归正确性达标；网站尚未达到最终成品。**

## 9. 已知风险

- 模拟账户、订单、策略、审计和提醒主要保存在当前浏览器本地；清理站点数据会丢失。
- 预警仅在页面运行期间监控，关闭页面后不会后台执行。
- 第三方公共行情与地区网络仍可能短时不可用；网关可切换上游并明确显示状态，但无法保证第三方永不故障。
- SSE 使用有限时长连接并自动重连，避免长期占用 Edge Function。
- 当前仍为模拟交易，不得对外宣称已接入真实账户或真实资金。

## 10. 不可回退的工程规则

- 不使用 iframe 套旧版。
- 不把随机演示价格标为实时。
- 不再维护第二套浏览器直连市场筛选行情源。
- 不在 `main` 直接试错。
- 不强制覆盖主开发分支或生产分支。
- 不通过删除断言、跳过测试或放宽核心规则制造绿灯。
- 运行时代码 HEAD 变化后，必须重新跑真实网关、四端完整验收和人工视觉复核。
- 新功能优先进入抽屉、详情页或按需展开区域，不继续无节制挤压主屏。

## 11. 下一阶段唯一优先任务

**阶段二：移动交易主屏、订单簿与下单流程系统级重排。**

目标：

1. 按“市场状态 → 周期工具 → K 线 → 盘口/成交 → 下单 → 持仓/审计”重新建立手机信息层级。
2. K 线详情改为更轻、更少遮挡的移动交互。
3. 增加手机全屏图表和底部指标/绘图工具面板。
4. 订单簿价格、数量、累计数量使用稳定列宽和等宽数字。
5. 支持订单簿精度聚合、仅买盘、仅卖盘和双边切换。
6. 下单面板完善市价、限价、止损限价、止损市价、数量/金额切换、仓位比例、手续费、滑点和成交均价预估。
7. 统一买卖按钮、风险提示、审计入口和退出策略入口。
8. 新增手机专项门禁，并继续跑四种视口完整回归。

阶段二未通过前，不进入模拟永续合约账本，也不宣称网站是最终成品。

## 12. 更新日志

### 2026-07-11：阶段一最终验收通过

- 已验证运行时代码：`ac64fbb94e304f1195bd3e4c91599e5513a182cf`
- 完整验收：Run `29150223095`，双网关与四端全部通过
- 完成当前头部四端人工截图复核
- 完成统一行情引擎、12 周期、缓存、实时状态、专业 K 线、市场筛选器、数据健康迁移和相关兼容加固
- 当前状态：准备整合到 `atlas-x-pro-terminal`，尚未部署到 `main`

### 2026-07-11：订单与成交审计中心部署

- 上线运行时代码：`8276f1cdae1f8198b094ad903c085df7a8f4ec9c`
- 部署方式：非强制快进 `main`
- 回滚分支：`rollback/atlas-x-pro-before-audit-20260711`
