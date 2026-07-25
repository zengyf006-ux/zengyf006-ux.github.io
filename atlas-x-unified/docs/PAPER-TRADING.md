# Paper Trading Ledger

ATLAS X Unified Pro 的纸面交易账本只处理模拟资金和模拟订单，不连接真实账户、真实资金或交易所下单接口。

## Architecture

- `PaperTradingLedger` 接收强类型命令，并产生不可变领域事件。
- `replayPaperTradingEvents` 是状态恢复的唯一入口；页面刷新后由事件流重建账户。
- `MemoryPaperTradingEventStore` 用于确定性单元测试。
- `IndexedDbPaperTradingEventStore` 是 Web/PWA 的本地持久化适配器；业务真相不写入 localStorage。
- 所有金额、价格、数量、费用和 PnL 继续使用规范十进制字符串与统一 decimal.js 计算上下文。

## Supported lifecycle

- market、limit、stopMarket、stopLimit
- 买入和卖出
- quote/base 资产预留与释放
- waitingTrigger、pending、partiallyFilled、filled、canceled
- 部分成交和完整成交
- 精确手续费、持仓成本、已实现和未实现 PnL
- 市场标记价格更新
- 命令和事件幂等
- 确认令牌保护的模拟账户重置

## Persistence and failure policy

IndexedDB 事件按稳定 `eventId` 存储并按 `sequence` 重放。重复的相同事件被忽略；冲突事件、序列缺口和持久化失败被拒绝。存储错误统一映射到稳定 `STORAGE_FAILURE` code，且内存状态不会在持久化失败时提前变更。

## Safety boundaries

- 所有来源标记为 `simulated`。
- 不调用真实交易接口。
- 不读取 API Key、Secret、私钥或助记词。
- 不部署、不接触生产 Supabase 或网关。
- 重置只删除模拟账户事件，且必须使用精确确认令牌。
