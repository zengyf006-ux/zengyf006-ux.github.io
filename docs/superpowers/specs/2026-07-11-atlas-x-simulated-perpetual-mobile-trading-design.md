# ATLAS X Pro 模拟永续合约与移动交易系统设计

最后更新：2026-07-11

## 1. 目标

把 ATLAS X Pro 从“实时行情驱动的专业模拟现货终端”升级为“具备完整 USDT 本位永续合约语义、专业移动交易流程和可审计风险模型的高保真模拟交易平台”。

本阶段必须同时解决：

1. 模拟永续合约账本和风险模型缺失。
2. 手机主屏、K 线、订单簿、下单、持仓和审计像独立模块拼接的问题。
3. 当前订单类型、保证金、强平、资金费和持仓模式不完整的问题。
4. 现货账本、合约账本、行情会话和审计视图之间的数据边界问题。

## 2. 产品边界

- 只做模拟交易，不接真实资金。
- 不提供充值、提现、真实交易所账户连接。
- 不保存 API Key、Secret、私钥或助记词。
- 行情、指数、标记价和资金费只使用公开数据或明确标注的模拟降级值。
- 不把随机价格、过期行情或推导值标成实时官方数据。
- 模拟强平只影响浏览器中的模拟合约账本，不影响现货模拟账本。
- 所有高风险动作必须有明确确认、审计和可回滚状态。

## 3. 范围

### 3.1 首批合约

- `BTC-USDT-SWAP`
- `ETH-USDT-SWAP`

架构必须允许后续扩展到 SOL、BNB、XRP、DOGE 等 USDT 本位永续，不允许把 BTC/ETH 写死在风险核心中。

### 3.2 持仓和保证金

- 全仓模式。
- 逐仓模式。
- 单向持仓模式。
- 双向持仓模式。
- 做多、做空、加仓、减仓、反向和平仓。
- 1x–125x 杠杆选择；每个交易对有独立最大杠杆和风险档位。
- 初始保证金、维持保证金、冻结保证金、可用保证金、账户权益和保证金率。
- 标记价格、指数价格、预估强平价、破产价和风险等级。

### 3.3 委托能力

- 市价。
- 限价。
- 止损市价。
- 止损限价。
- 条件市价。
- 条件限价。
- 只减仓。
- Post Only。
- IOC。
- FOK。
- 仓位级止盈止损。
- 追踪止损。
- 分批止盈和分批减仓。
- 一键全平和按市价全部撤单。

### 3.4 费用与结算

- Maker/Taker 手续费。
- 下单前手续费预估。
- 滑点预估和实际滑点。
- 成交均价。
- 未实现盈亏、已实现盈亏、收益率。
- 模拟资金费率、下一结算倒计时和资金费结算事件。
- 强平手续费和强平事件。

## 4. 方案比较

### 方案 A：直接扩展现货账本

优点：改动文件少，能快速显示合约字段。

缺点：现货余额、持仓和合约保证金语义完全不同；会导致预留、绩效、审计和强平互相污染。后续很难迁移服务端。

结论：拒绝。

### 方案 B：独立合约事件账本，资产总览只读汇总

优点：现货和合约边界清晰；保证金、资金费、强平和双向持仓可独立演进；审计可追踪每个事件；未来可迁移服务端。

缺点：需要新增一组模型、派生器和兼容层。

结论：采用。

### 方案 C：立即改成服务端账户和撮合系统

优点：跨设备、多人账户和长期持久化更完整。

缺点：当前项目要求零额外付费和快速产品展示；会把认证、隐私、并发、数据库和运维同时引入，显著扩大风险。

结论：本阶段不采用，但所有接口设计必须允许以后迁移。

## 5. 核心架构

### 5.1 独立合约账本

存储键：`atlasX.pro.perpetual.v1`

账本只保存事实状态和不可变事件索引：

```text
PerpetualLedger
├── version
├── account
│   ├── walletBalance
│   ├── realizedPnl
│   ├── feesPaid
│   ├── fundingPaid
│   └── positionMode
├── preferences
│   ├── marginModeBySymbol
│   ├── leverageBySymbol
│   └── orderDefaults
├── positions[]
├── orders[]
├── fills[]
├── fundingEvents[]
├── liquidationEvents[]
├── auditEvents[]
└── nextId
```

现货账本 `atlasX.pro.v1` 保持不变。资产总览通过只读投影显示“现货净值 + 合约账户权益”，不把两套状态写回同一个余额字段。

### 5.2 文件边界

- `perpetual-ledger.js`：账本读写、版本迁移、不可变事件。
- `perpetual-risk-engine.js`：保证金、盈亏、强平、风险档位和价格计算。
- `perpetual-order-engine.js`：订单校验、冻结、撮合、成交和状态机。
- `perpetual-funding-engine.js`：资金费率、倒计时、结算和降级标记。
- `perpetual-controller.js`：把行情、账本、风险和 UI 连接起来。
- `perpetual-trading-ui.js`：桌面和手机合约交易视图。
- `perpetual-trading.css`：合约布局和视觉样式。
- `mobile-trading-shell.js`：手机交易主屏导航、抽屉和全屏图表。
- `mobile-trading-shell.css`：手机信息层级和触控尺寸。

每个文件只有一个明确职责，不把合约逻辑继续塞入旧 `app.js`。

## 6. 数据模型

### 6.1 Position

```js
{
  id,
  symbol,
  side: 'long' | 'short',
  positionMode: 'one_way' | 'hedge',
  marginMode: 'cross' | 'isolated',
  leverage,
  quantity,
  entryPrice,
  markPrice,
  isolatedMargin,
  initialMargin,
  maintenanceMargin,
  unrealizedPnl,
  realizedPnl,
  liquidationPrice,
  bankruptcyPrice,
  takeProfit,
  stopLoss,
  trailingStop,
  createdAt,
  updatedAt
}
```

### 6.2 Order

```js
{
  id,
  clientOrderId,
  symbol,
  side: 'buy' | 'sell',
  positionSide: 'long' | 'short' | 'net',
  type: 'market' | 'limit' | 'stop_market' | 'stop_limit' | 'trigger_market' | 'trigger_limit',
  timeInForce: 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY',
  quantity,
  price,
  triggerPrice,
  triggerDirection,
  reduceOnly,
  marginMode,
  leverage,
  status,
  filledQuantity,
  averagePrice,
  reservedMargin,
  estimatedFee,
  createdAt,
  updatedAt
}
```

### 6.3 Fill

```js
{
  id,
  orderId,
  symbol,
  side,
  positionSide,
  quantity,
  price,
  referencePrice,
  fee,
  liquidity: 'maker' | 'taker',
  realizedPnl,
  slippageBps,
  createdAt
}
```

## 7. 风险计算

所有计算使用标记价格，不使用最后成交价触发强平。

```text
notional = abs(quantity) × markPrice
initialMargin = notional ÷ leverage
maintenanceMargin = notional × maintenanceRate + maintenanceAmount
unrealizedPnl(long) = quantity × (markPrice - entryPrice)
unrealizedPnl(short) = quantity × (entryPrice - markPrice)
positionEquity(isolated) = isolatedMargin + unrealizedPnl
accountEquity(cross) = walletBalance + realizedPnl + crossUnrealizedPnl - feesPaid - fundingPaid
marginRatio = maintenanceMargin ÷ max(effectiveEquity, epsilon)
```

### 7.1 强平条件

- 逐仓：该仓位权益小于等于该仓位维持保证金与强平费用缓冲之和。
- 全仓：合约账户有效权益小于等于全部全仓仓位维持保证金和强平费用缓冲之和。
- 强平事件必须使用单一事务更新：关闭仓位、记录成交、扣除费用、释放保证金、写入强平事件和审计事件。
- 强平逻辑不得修改现货账本。

### 7.2 风险档位

每个交易对使用分层配置：

```js
[
  { maxNotional: 50_000, maintenanceRate: 0.004, maintenanceAmount: 0, maxLeverage: 125 },
  { maxNotional: 250_000, maintenanceRate: 0.005, maintenanceAmount: 50, maxLeverage: 75 },
  { maxNotional: 1_000_000, maintenanceRate: 0.01, maintenanceAmount: 1_300, maxLeverage: 50 }
]
```

显示给用户的最大杠杆必须受当前名义价值档位约束。

## 8. 标记价、指数价和资金费

### 8.1 数据优先级

1. 公共交易所衍生品指数价、标记价和资金费接口。
2. 多来源现货指数的中位数或加权中位数。
3. 明确标记为“模拟推导”的基差模型。
4. 过期后进入 `stale`，禁止继续显示实时标签。

### 8.2 资金费

- 默认每 8 小时结算一次。
- 资金费金额：`positionNotional × fundingRate`。
- 正费率时多头支付、空头收取；负费率时方向相反。
- 每次结算写入独立 FundingEvent 和 AuditEvent。
- 浏览器关闭期间不逐秒后台执行；重新打开后最多补记一个已跨越的结算窗口，并明确标注“离线补结算”。

## 9. 订单状态机

```text
created
→ validated
→ reserved
→ open / triggered
→ partially_filled
→ filled
→ canceled / expired / rejected
```

规则：

- Market：按订单簿深度或可解释滑点模型成交。
- Limit GTC：满足价格时成交，否则等待。
- Post Only：会立即成交时拒绝，不自动改为 Taker。
- IOC：立即成交可成交部分，其余取消。
- FOK：不能全部立即成交则全部取消。
- Stop/Trigger：触发后转换为明确的子订单。
- Reduce Only：不得扩大仓位或反向开仓。
- 双向持仓模式必须明确 positionSide，禁止模糊净额处理。

## 10. 移动交易主屏

### 10.1 信息层级

```text
市场标题与实时状态
→ 价格、涨跌、标记价、资金费倒计时
→ 周期与指标工具
→ K 线
→ 盘口 / 成交切换
→ 固定买入做多 / 卖出做空操作区
→ 下单抽屉
→ 持仓 / 委托 / 成交 / 资金费 / 审计
```

### 10.2 K 线详情

- 默认使用顶部轻量 OHLC 数据条，不覆盖大面积图表。
- 详细字段放入可拖动底部信息层。
- 同一根再次点击、空白点击、关闭按钮和切周期均可取消。
- 全屏模式使用独立工具栏，不把桌面工具缩小塞入手机。

### 10.3 订单簿

- 三列：价格、数量、累计。
- 等宽数字和稳定列宽。
- 精度聚合：自动、0.1、1、10、100，具体值按价格数量级调整。
- 双边、仅卖盘、仅买盘。
- 当前价、标记价和点差清晰分层。
- 深度背景不能遮挡数字。

### 10.4 下单抽屉

- 开仓/平仓语义明确。
- 全仓/逐仓和杠杆位于交易上下文，不藏在深层设置。
- 数量/金额切换。
- 25%、50%、75%、100% 快捷比例。
- 下单前显示：预计保证金、手续费、滑点、成交均价、强平价、保证金率变化和风险级别。
- 只减仓、TP/SL 和高级选项按需展开，不挤压首屏。

## 11. 桌面端

- 保持左市场、中 K 线、右盘口/下单、下方账户与风险工作区。
- 合约上下文在顶部增加标记价、指数价、资金费和倒计时。
- 右侧下单票据增加全仓/逐仓、杠杆、开平仓和合约订单类型。
- 下方账户区增加合约持仓、合约委托、资金费、强平记录和合约审计。
- 不把全部新增字段塞进主 K 线区域。

## 12. 审计与可解释性

所有关键动作写入合约审计事件：

- 修改杠杆。
- 修改保证金模式。
- 创建、确认、触发、成交、撤销、拒绝订单。
- 加仓、减仓、反向和平仓。
- 设置或触发 TP/SL、追踪止损和分批退出。
- 资金费结算。
- 强平。
- 手续费、滑点和已实现盈亏变化。

审计中心必须能从合约订单、成交、持仓、资金费和强平记录进入同一关联链。

## 13. 错误与降级

- 标记价不可用时禁止新开仓，允许只减仓和平仓。
- 数据过期时显示明确状态，不继续更新强平价为“实时”。
- 本地存储损坏时保留原始备份键并创建干净账本，显示恢复提示。
- 数字输入统一校验 NaN、Infinity、负值、精度和最小名义价值。
- 所有账本写入必须单线程串行，避免双击或行情事件造成重复成交。
- 页面刷新后恢复未完成订单、持仓、保证金冻结和资金费窗口。

## 14. 验收标准

### 14.1 数学和账本

- 多头/空头盈亏方向正确。
- 加仓后加权均价正确。
- 减仓只结算对应数量盈亏。
- 反向订单先平旧仓再开新仓。
- 全仓和逐仓强平互不混淆。
- 只减仓不能扩大仓位。
- Post Only、IOC、FOK 语义正确。
- 资金费方向、金额和补结算正确。
- 强平不修改现货账本。
- 账本刷新后可恢复且不重复结算。

### 14.2 UI

- iPhone 390 × 844。
- iPhone 430 × 932。
- Desktop 1440 × 900。
- Desktop 1920 × 1080。
- 手机所有主要触控目标至少 42px，核心交易按钮至少 48px。
- 无横向溢出、白屏、控制台错误或页面错误。
- K 线、订单簿、下单和持仓之间价格源一致。
- 合约模式和模拟边界始终可见。

### 14.3 性能和网络

- 有缓存时首个可用交易视图目标 500ms 内出现。
- 正常网络下 1.5s 内进入实时或明确重连状态。
- 切交易对和周期时旧请求不能覆盖新会话。
- 弱网和断网时不伪造实时价格。

## 15. 实施顺序

1. 合约账本与迁移。
2. 风险引擎和数学测试。
3. 订单引擎和执行语义。
4. 标记价、指数价和资金费数据层。
5. 合约控制器和审计。
6. 桌面合约视图。
7. 手机主屏和下单抽屉。
8. 订单簿专业化。
9. 四端回归、弱网、截图复核和部署。

## 16. 非目标

- 不接真实资金。
- 不接真实交易所账户。
- 不做币本位永续或交割合约。
- 不做真实清算保险基金或自动减仓队列。
- 不在本阶段引入付费后端、付费行情或额外服务器。
