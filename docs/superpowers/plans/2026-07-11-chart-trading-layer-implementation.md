# 图表交易层 Implementation Plan

**Goal:** 在现有 K 线叠加当前持仓、委托、交易计划止损/目标，并允许从图表点击取价写回订单与交易计划。

**Architecture:** 扩展现有 `chart-pro-tools.js`，继续由单一标记层负责价格坐标换算和交易线渲染；新增专用 CSS 语义；独立 Playwright 测试使用固定账本与固定计划验证线条和取价。核心撮合与图表绘制逻辑不修改。

## Task 1：先写失败验收

- 新建 `qa/atlas-x-pro/chart-trading-layer.mjs`；
- 固定 BTC 持仓、BTC 限价委托和 BTC 止损/目标计划；
- 断言四类自动线、标签信息、交易对隔离、委托价取价、止损取价、目标取价及手机 Sheet；
- 接入四端 GitHub Actions；
- 确认只在新步骤失败。

## Task 2：扩展图表数据收集与渲染

- 持仓按当前交易对聚合数量和加权成本；
- 委托读取方向、类型、价格、数量、已成交，显示剩余数量；
- 从 `atlasX.pro.riskPlans.v1` 读取当前交易对止损和目标；
- 使用专用 marker type：`position`、`buy-order`、`sell-order`、`plan-stop`、`plan-target`、`user`；
- 切币、本地计划变化、账本变化和画布范围变化时重绘。

## Task 3：实现图表取价

- 工具栏增加 `order-price`、`plan-stop`、`plan-target`；
- 点击画布按现有 `priceForY` 计算价格；
- 委托价：打开手机订单 Sheet（如需要），切限价，填入订单价格并触发原 input；
- 止损/目标：打开并展开交易计划，填入字段并触发原 input；
- 完成后回到十字光标；
- 不提交订单。

## Task 4：样式与全套验收

- 增加买入/卖出/止损/目标线语义；
- 桌面工具栏保持纵向紧凑；手机改为可横向排列但不得溢出；
- 四端完整流水线全绿；
- 下载 1440×900 和 390×844 实图人工审查；
- 任何缺陷先加守卫后修复。
