# ATLAS X Pro 专业预警中心设计

日期：2026-07-11

## 目标

把当前铃铛内的两条静态说明升级为统一的本地预警中心，使价格规则、模拟成交、OCO 和退出策略事件进入同一条可审计通知流。

本轮只做浏览器内提醒，不申请系统通知权限，不接短信、邮件、Telegram 或营销推送，也不制造“实时云端监控”假象。页面关闭后不会继续监控，所有规则和事件只保存在当前浏览器。

## 设计原则

1. **事件驱动，不轮询刷屏**：价格提醒只在阈值被真正穿越时触发；成交与策略事件只在状态发生变化时写入。
2. **冷却去重**：同一规则默认 5 分钟冷却；业务事件使用稳定来源键去重。
3. **风险优先**：止损、追踪止损和异常到期使用更高严重级别；普通成交与止盈使用信息级别。
4. **有限留存**：最多保存 100 条事件和 30 条规则，避免 localStorage 无限增长。
5. **兼容现有入口**：继续复用 `#controlPopover`，因此旧通知按钮和基础验收仍成立。
6. **不伪造后台能力**：界面明确标注“仅当前浏览器运行时监控”。

## 功能范围

### 1. 价格规则

用户可针对当前交易对创建：

- 价格上穿指定值；
- 价格下穿指定值。

表单默认使用当前价格，并提供：

- 当前价 +1%；
- 当前价 -1%；
- 5 分钟冷却（固定为本轮默认）。

规则字段：

```json
{
  "id": "alert-rule-*",
  "symbol": "BTCUSDT",
  "type": "price_above",
  "threshold": 65000,
  "enabled": true,
  "cooldownMs": 300000,
  "lastTriggeredAt": 0,
  "lastObservedPrice": 64000,
  "createdAt": 0,
  "updatedAt": 0
}
```

触发条件：

- `price_above`：上一次有效价格 `< threshold`，本次价格 `>= threshold`；
- `price_below`：上一次有效价格 `> threshold`，本次价格 `<= threshold`。

新建规则不会因当前价格已经位于阈值另一侧而立即触发；必须先形成真实穿越。

### 2. 业务事件采集

统一读取三个既有存储：

- 核心账本：`atlasX.pro.v1`；
- OCO：`atlasX.pro.advancedOrders.v1`；
- 退出策略：`atlasX.pro.exitStrategies.v1`。

采集事件：

- 新模拟成交；
- OCO 止盈完成、止损完成、到期、取消；
- 追踪止损触发；
- 分批止盈部分完成、全部完成、取消、到期。

每条事件使用稳定 `sourceKey` 去重。例如：

- `core-fill:<historyId>`；
- `oco:<orderId>:completed_stop`；
- `exit:<strategyId>:completed`。

初始化时只建立快照，不把历史存量全部标记为“新通知”；后续新增或状态变化才写事件。

### 3. 未读与事件流

事件结构：

```json
{
  "id": "alert-event-*",
  "sourceKey": "core-fill:123",
  "kind": "price",
  "severity": "info",
  "symbol": "BTCUSDT",
  "title": "BTC/USDT 已上穿 65,000",
  "message": "当前价格 65,012.30，规则已触发并进入 5 分钟冷却。",
  "read": false,
  "createdAt": 0
}
```

铃铛右上角显示未读数量：

- 0 时隐藏；
- 1–99 显示准确数量；
- 超过 99 显示 `99+`。

操作：

- 全部 / 未读 / 规则 三个页签；
- 全部标记已读；
- 单条事件点击后标记已读；
- 清空已读事件；
- 规则启停与删除。

### 4. 控制弹层

继续使用现有 `#controlPopover`：

- 标题改为“专业预警中心”；
- 桌面宽度扩大到 390px；
- 手机端保持左右 8px，最大高度不超过可视区；
- 内部采用顶部摘要、页签、滚动内容区和底部状态说明；
- 原 `[data-close-popover]` 保留。

通知按钮点击由新模块在捕获阶段接管，阻止旧静态内容覆盖新内容。侧栏市场设置仍继续使用原弹层逻辑。

## 存储

键名：`atlasX.pro.alertCenter.v1`

```json
{
  "version": 1,
  "rules": [],
  "events": [],
  "snapshots": {
    "historyIds": [],
    "ocoStatuses": {},
    "exitStatuses": {}
  },
  "ui": {
    "tab": "all"
  },
  "updatedAt": 0
}
```

读取失败或版本不兼容时回退默认结构，不影响核心交易账本。

## 架构

新增：

- `atlas-x-pro/pro-alert-center.js`
- `atlas-x-pro/pro-alert-center.css`
- `qa/atlas-x-pro/pro-alert-center.mjs`

公开受控接口：

```js
window.AtlasAlertCenter = {
  getState(),
  open(),
  close(),
  evaluateNow(),
  createPriceRule(input),
  markAllRead(),
};
```

`evaluateNow()` 供自动验收和同页其他模块在关键状态变化后主动触发；正常运行同时监听：

- `#lastPrice` 文本变化；
- `#positionsBody`、`#ordersBody`、`#advancedOcoList`、`#advancedExitList` DOM 变化；
- `storage` 事件；
- 当前交易对切换。

采用 40ms 合并调度，避免同一次核心渲染产生多次评估。

## 严重级别

- `info`：价格提醒、普通成交、止盈完成；
- `warning`：规则到期、分批止盈部分完成；
- `critical`：OCO 止损、追踪止损触发。

严重级别只影响视觉和排序提示，不自动执行任何交易。

## 安全与边界

- 预警中心不会创建、撤销或提交订单；
- 不修改现金、持仓、委托、成交历史；
- 不依赖外部通知权限；
- 不声称页面关闭后仍运行；
- 价格规则只使用页面当前已声明的数据源状态；演示行情下事件标题仍明确属于模拟终端。

## 验收

四种视口：390×844、430×932、1440×900、1920×1080。

必须验证：

1. 铃铛打开 `#controlPopover`，内容为专业预警中心而非旧静态通知；
2. 创建 BTC 上穿规则并持久化；
3. 模拟价格从阈值下方穿越到上方后产生一条未读事件；
4. 价格持续停留阈值上方不会重复触发；
5. 冷却期内再次穿越不会新增事件；
6. 标记全部已读后铃铛未读角标清零；
7. 新核心成交被采集一次，重复评估不重复；
8. OCO 止损和退出策略完成事件能被采集并分配正确严重级别；
9. 规则可以停用、恢复和删除；
10. 手机端无横向溢出，主要操作触控高度不低于 38px；
11. 全部既有交易、工作区、风险、图表与市场数据验收零回归。

## 非目标

- 系统级推送；
- 后台持续监控；
- 邮件、短信、Telegram；
- 大额转账或链上监控；
- 技术指标组合规则；
- 拖拽式策略编排；
- 自动下单。
