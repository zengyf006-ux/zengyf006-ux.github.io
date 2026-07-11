# ATLAS X Pro 专业市场筛选器设计

日期：2026-07-11

## 目标

在现有“实时市场情报”页基础上增加专业筛选器，而不是再造第二个市场页面。保留现有市场广度、热力图和强弱分布，补齐顶级交易终端常见的多维筛选、排序、自选联动和对比能力。

## 数据原则

- 价格与涨跌继续使用当前观察列表。
- 24h 高低、成交额和成交笔数优先读取 Binance 公共 24h ticker。
- 买卖点差优先读取 Binance 公共 book ticker。
- 远端请求失败时可使用 10 分钟内的本地缓存。
- 无实时数据且无有效缓存时显示 `--`，不使用估算值冒充真实指标。
- 页面必须明确标注 `公开行情 / 本地缓存 / 部分数据`。

## 数据模型

存储键：`atlasX.pro.marketScreener.v1`

```json
{
  "version": 1,
  "query": "",
  "filter": "all",
  "sort": "change",
  "direction": "desc",
  "selected": [],
  "favorites": [],
  "updatedAt": 0
}
```

缓存键：`atlasX.pro.marketScreener.cache.v1`

每个市场包含：

```json
{
  "symbol": "BTCUSDT",
  "last": 64000,
  "change": 1.2,
  "high": 65000,
  "low": 62000,
  "quoteVolume": 1200000000,
  "tradeCount": 1200000,
  "bid": 63999.9,
  "ask": 64000.1,
  "rangePercent": 4.69,
  "spreadBps": 0.03,
  "source": "live",
  "updatedAt": 0
}
```

## 界面

### 筛选工具条

- 搜索交易对或名称；
- 筛选：全部、自选、上涨、下跌、高成交额、低点差、高振幅；
- 排序：涨跌、成交额、振幅、点差、最新价；
- 升序/降序；
- 数据源状态与更新时间。

### 桌面表格

列：

1. 自选 / 选择；
2. 交易对；
3. 最新价；
4. 24h 涨跌；
5. 24h 成交额；
6. 24h 振幅；
7. 点差；
8. 数据状态；
9. 打开交易。

### 手机卡片

不采用横向滚动表格。每个卡片显示交易对、价格、涨跌、成交额、振幅和点差；选择与打开交易保持独立按钮。

### 对比托盘

- 最多选择 4 个市场；
- 显示统一指标对比，不生成虚假收益曲线；
- 可逐个移除或清空；
- “打开最佳流动性”根据最低有效点差，其次最高成交额选择；
- 对比选择刷新后恢复。

## 交互

- 点击交易对主体进入该市场并关闭市场页；
- 星标同步核心模拟账户的 `favorites`；
- 筛选器自己的选择不改变自选；
- 列标题或排序下拉改变排序；
- 远端数据更新时保持用户的筛选、排序和选择；
- 打开市场页时自动刷新，30 秒内不重复请求。

## 架构

新增：

- `atlas-x-pro/pro-market-screener.js`
- `atlas-x-pro/pro-market-screener.css`
- `qa/atlas-x-pro/pro-market-screener.mjs`

模块监听现有 `.module-overlay[data-module="markets"]`，在 `market-intelligence.js` 完成渲染后替换基础排名面板为专业筛选器，不修改 `app.js` 闭包或模拟撮合账本。

公开接口：

```js
window.AtlasMarketScreener = {
  getState(),
  getMarkets(),
  refresh(),
  applyFilter(filter),
  applySort(sort, direction),
  toggleCompare(symbol),
};
```

## 安全与边界

- 不执行交易；
- 不修改现金、订单、持仓和历史；
- 不把演示数据标成公开实时数据；
- 不以成交额或涨跌幅提供投资建议；
- 不显示不存在的数据。

## 验收

四端必须验证：

1. 市场情报页出现专业筛选器；
2. 测试注入的公开 ticker 和 book ticker 数据正确计算成交额、振幅和点差；
3. 成交额排序正确；
4. 搜索 ETH 只保留 ETH；
5. 高振幅与低点差筛选正确；
6. 自选切换同步核心 favorites；
7. 最多选择 4 个市场，第 5 个被阻止；
8. 对比托盘刷新后恢复；
9. 点击打开交易切换当前交易对并关闭市场页；
10. 请求失败时使用有效缓存，缓存过期时显示部分数据而非伪造指标；
11. 手机无横向溢出，主要触控目标不低于 40px；
12. 所有既有交易、预警、审计、风险、图表和市场情报验收零回归。
