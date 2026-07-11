# 追踪止损与分批止盈 Implementation Plan

**Goal:** 在现货模拟终端中增加追踪止损本地预留与三档分批止盈核心委托，并整合现有卖出执行保护。

**Architecture:** 新建 `advanced-exit-strategies.js/.css` 与独立验收。追踪止损保存在 `atlasX.pro.exitStrategies.v1` 并通过原市价卖出入口触发；分批止盈通过原核心创建三笔只减仓限价单。执行保护、OCO 和风险仓位读取活动追踪止损预留，避免重复占用持仓。

## Task 1：失败验收

- 新建 `qa/atlas-x-pro/exit-strategies.mjs`；
- 固定 BTC 持仓 0.6；
- 创建 0.1 BTC、2% 回撤追踪止损，验证无核心订单但本地预留 0.1；
- 验证普通卖出 0.55 被执行保护阻止；
- 提高价格后确认 peak 和 trigger 上移；降低到 trigger 以下后确认核心市价卖出、持仓减至 0.5；
- 创建总量 0.3、30/30/40 三档止盈，验证三笔核心只减仓限价卖单与数量合计；
- 注入一腿成交并立即评估，验证部分完成；注入全部成交验证完成；
- 验证重复策略、交易对隔离、手机无横向溢出；
- 接入四端流水线，确认新步骤红灯。

## Task 2：执行保护与统一可用数量

- `execution-guard.js` 读取 `atlasX.pro.exitStrategies.v1`；
- 仅统计 `kind=trailing_stop` 且状态为 `waiting_activation` 或 `active` 的数量；
- `sellAvailable = held - coreReserved - trailingReserved`；
- 提示分别显示核心冻结和退出策略预留；
- OCO 的可用数量口径加入追踪预留；
- 风险仓位卖出建议数量改为真实可用数量。

## Task 3：追踪止损

- 新建退出策略面板和追踪页签；
- 校验数量、激活价、回撤比例、有效期和重复策略；
- 保存状态、peak、trigger、expiresAt；
- 观察当前价格和交易对；
- 触发前将状态改为 `triggering`，通过原订单表单提交只减仓市价卖单；
- 成功后 `completed`，失败 `error`；
- 取消和过期释放本地预留；
- 暴露 `window.AtlasExitStrategies.evaluateAtPrice(price)` 供确定性验收。

## Task 4：分批止盈

- 三档价格与比例，默认 30/30/40；
- 最后一档吸收数量精度余数；
- 顺序通过原表单创建三笔只减仓限价卖单；
- 创建失败回滚已创建腿；
- 保存 coreOrderId；
- 观察核心订单与历史，更新每腿 `pending/filled/canceled`；
- 汇总活动、部分完成、完成、取消、过期状态；
- 取消组撤销所有未完成腿。

## Task 5：图表、样式与全套验证

- 图表交易层读取活动追踪止损并显示触发线；
- 分批止盈沿用现有委托线；
- 桌面折叠态紧凑，手机按钮至少 40px；
- 四端完整流水线全绿；
- 下载 1440 与 390 实图人工检查；
- 任何缺陷先加守卫再修复。
