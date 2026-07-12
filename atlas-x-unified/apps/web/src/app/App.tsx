import { useMemo, useState } from 'react';
import { multiplyDecimal } from '@atlas-x/domain';
import {
  PRODUCT_PAGES,
  createDraft,
  estimateTicket,
  marketFixture,
  type Interval,
  type MobileTerminalPane,
  type ProductPage,
  type TicketInputMode,
  type TicketOrderType,
  type TicketState,
} from './model.js';
import {
  PaperAccountProvider,
  RESET_PAPER_ACCOUNT_CONFIRMATION,
  usePaperAccount,
} from './usePaperAccount.js';
import './styles.css';

const intervals: readonly Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const mobilePanes: readonly [MobileTerminalPane, string][] = [
  ['chart', '图表'], ['book', '盘口'], ['order', '下单'], ['trades', '成交'],
];
const orderTypes: readonly [TicketOrderType, string][] = [
  ['market', '市价'], ['limit', '限价'], ['stopMarket', '止损市价'], ['stopLimit', '止损限价'],
];
const inputModes: readonly [TicketInputMode, string][] = [
  ['quantity', '数量'], ['amount', '金额'], ['percentage', '比例'],
];
const markets = [
  ['BTC-USD', '118,420.35', '+2.18%'], ['ETH-USD', '4,286.14', '+1.42%'],
  ['SOL-USD', '184.72', '-0.64%'], ['LINK-USD', '21.48', '+3.06%'],
] as const;

function SourceBadge() {
  return <span className="source-badge" title="确定性回归数据，不是真实行情">测试数据 · fixture</span>;
}

function Chart({ interval }: { readonly interval: Interval }) {
  const bars = [42, 48, 44, 56, 52, 63, 59, 68, 72, 66, 78, 74, 82, 88, 84, 92];
  return (
    <section className="chart" aria-label={`${marketFixture.symbol} ${interval} K线图`}>
      <div className="chart-grid" aria-hidden="true" />
      <div className="candles" aria-hidden="true">
        {bars.map((value, index) => <i key={index} style={{ height: `${value}%` }} className={index % 3 === 0 ? 'down' : 'up'} />)}
      </div>
      <div className="price-line"><span>118,420.35</span></div>
    </section>
  );
}

function OrderBook() {
  return (
    <section className="panel book mobile-panel" aria-labelledby="book-title">
      <header><h2 id="book-title">订单簿</h2><span>价格 · 数量</span></header>
      <div className="book-side asks">{[...marketFixture.asks].reverse().map((row) => <div key={row.price}><b>{row.price}</b><span>{row.quantity}</span></div>)}</div>
      <strong className="mid-price">118,420.35</strong>
      <div className="book-side bids">{marketFixture.bids.map((row) => <div key={row.price}><b>{row.price}</b><span>{row.quantity}</span></div>)}</div>
    </section>
  );
}

function RecentTrades() {
  return (
    <section className="panel trades mobile-panel">
      <header><h2>最近成交</h2><span>测试序列</span></header>
      {[['118420.35', '0.024'], ['118418.20', '0.180'], ['118430.10', '0.042'], ['118405.00', '0.320']].map(([price, quantity], index) => (
        <div key={`${price}-${index}`}><b className={index % 2 === 0 ? 'positive' : 'negative'}>{price}</b><span>{quantity}</span><time>刚刚</time></div>
      ))}
    </section>
  );
}

function OrderTicket() {
  const [ticket, setTicket] = useState<TicketState>({
    side: 'buy', type: 'market', inputMode: 'quantity', inputValue: '0.1', limitPrice: '118400', stopPrice: '119000',
  });
  const [confirming, setConfirming] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const { snapshot, message, submit } = usePaperAccount();
  const preview = useMemo(() => {
    try {
      return { estimate: estimateTicket(ticket), error: '' } as const;
    } catch (error) {
      return { estimate: null, error: error instanceof Error ? error.message : '输入无效' } as const;
    }
  }, [ticket]);
  const estimate = preview.estimate;
  const ticketError = submitError !== '' ? submitError : preview.error;
  const cash = snapshot?.account.availableCash ?? '—';
  const coverage = estimate === null ? '—' : `${multiplyDecimal(estimate.coverageRate, '100')}%`;
  const needsLimit = ticket.type === 'limit' || ticket.type === 'stopLimit';
  const needsStop = ticket.type === 'stopMarket' || ticket.type === 'stopLimit';
  const inputLabel = ticket.inputMode === 'quantity' ? '数量 BTC' : ticket.inputMode === 'amount' ? '金额 USD' : '比例 %';

  function updateTicket(next: TicketState) {
    setSubmitError('');
    setTicket(next);
  }

  async function placeOrder() {
    try {
      const draft = createDraft(ticket, `web-${Date.now()}`, new Date().toISOString());
      const submitted = await submit(draft, marketFixture.last);
      if (submitted) {
        setSubmitError('');
        setConfirming(false);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '无法创建委托');
    }
  }

  return (
    <section className="panel ticket mobile-panel" aria-labelledby="ticket-title">
      <header><h2 id="ticket-title">模拟下单</h2><span>可用 USD {cash}</span></header>
      <div className="segmented" aria-label="买卖方向">
        {(['buy', 'sell'] as const).map((side) => <button key={side} className={ticket.side === side ? 'active' : ''} onClick={() => updateTicket({ ...ticket, side })}>{side === 'buy' ? '买入' : '卖出'}</button>)}
      </div>
      <div className="order-types" aria-label="订单类型">
        {orderTypes.map(([type, label]) => <button key={type} className={ticket.type === type ? 'active' : ''} onClick={() => updateTicket({ ...ticket, type })}>{label}</button>)}
      </div>
      <div className="input-modes" aria-label="输入方式">
        {inputModes.map(([inputMode, label]) => <button key={inputMode} className={ticket.inputMode === inputMode ? 'active' : ''} onClick={() => updateTicket({ ...ticket, inputMode })}>{label}</button>)}
      </div>
      {needsStop ? <label>触发价<input value={ticket.stopPrice} inputMode="decimal" onChange={(event) => updateTicket({ ...ticket, stopPrice: event.target.value })} /></label> : null}
      {needsLimit ? <label>限价<input value={ticket.limitPrice} inputMode="decimal" onChange={(event) => updateTicket({ ...ticket, limitPrice: event.target.value })} /></label> : null}
      <label>{inputLabel}<input value={ticket.inputValue} inputMode="decimal" onChange={(event) => updateTicket({ ...ticket, inputValue: event.target.value })} /></label>
      <div className="estimate" aria-label="下单预估">
        <div><span>预计成交</span><b>{estimate?.filledQuantity ?? '—'} BTC</b></div>
        <div><span>VWAP</span><b>{estimate?.vwap ?? '—'}</b></div>
        <div><span>手续费</span><b>{estimate?.fee ?? '—'} USD</b></div>
        <div><span>深度覆盖</span><b>{coverage}</b></div>
      </div>
      {estimate?.depthInsufficient === true ? <p className="warning">盘口深度不足，订单可能部分成交。</p> : null}
      {ticketError !== '' ? <p className="warning" role="alert">{ticketError}</p> : null}
      <button className={`submit ${ticket.side}`} disabled={estimate === null || snapshot === null} onClick={() => setConfirming(true)}>{ticket.side === 'buy' ? '复核买入' : '复核卖出'}</button>
      <p className="status" role="status">{message}</p>
      {confirming ? <div className="confirm" role="dialog" aria-modal="true" aria-label="确认模拟委托"><h3>确认模拟委托</h3><p>{ticket.side === 'buy' ? '买入' : '卖出'} {estimate?.requestedQuantity ?? '—'} BTC · {orderTypes.find(([type]) => type === ticket.type)?.[1]}</p><div><button onClick={() => setConfirming(false)}>返回修改</button><button className="primary" onClick={() => void placeOrder()}>确认提交</button></div></div> : null}
    </section>
  );
}

function Terminal() {
  const [interval, setInterval] = useState<Interval>('15m');
  const [mobilePane, setMobilePane] = useState<MobileTerminalPane>('chart');
  return (
    <>
      <div className="mobile-task-switch" aria-label="手机交易任务">
        {mobilePanes.map(([pane, label]) => <button key={pane} className={mobilePane === pane ? 'active' : ''} onClick={() => setMobilePane(pane)}>{label}</button>)}
      </div>
      <div className={`terminal-grid mobile-${mobilePane}`}>
        <section className="market-stage mobile-panel">
          <div className="market-heading"><div><p>{marketFixture.symbol}</p><h1>118,420.35</h1><strong>+2,526.20 · +2.18%</strong></div><SourceBadge /></div>
          <div className="intervals">{intervals.map((item) => <button key={item} className={item === interval ? 'active' : ''} onClick={() => setInterval(item)}>{item}</button>)}</div>
          <Chart interval={interval} />
        </section>
        <OrderBook />
        <OrderTicket />
        <RecentTrades />
      </div>
    </>
  );
}

function Markets({ watchlistOnly = false }: { readonly watchlistOnly?: boolean }) {
  const rows = watchlistOnly ? markets.slice(0, 2) : markets;
  return <section className="page"><header className="page-title"><div><h1>{watchlistOnly ? '自选' : '市场'}</h1><p>当前为确定性 fixture；接入公共行情后仍会逐行显示真实性与延迟。</p></div><SourceBadge /></header><div className="market-table"><div className="table-head"><span>市场</span><span>最新价</span><span>24h</span></div>{rows.map(([symbol, price, change]) => <button key={symbol}><b>{symbol}</b><span>{price}</span><strong className={change.startsWith('+') ? 'positive' : 'negative'}>{change}</strong></button>)}</div></section>;
}

function AccountPage({ page }: { readonly page: ProductPage }) {
  const { snapshot, cancel } = usePaperAccount();
  const cash = snapshot?.account.assets.find((asset) => asset.asset === 'USD');
  if (page === 'assets') return <section className="page"><header className="page-title"><div><h1>资产与持仓</h1><p>所有金额来自同一个可重放的模拟事件账本。</p></div><span className="source-badge simulated">模拟账户</span></header><div className="metric-grid"><article><span>总资产</span><b>{snapshot?.account.equity ?? '—'} USD</b></article><article><span>可用资金</span><b>{snapshot?.account.availableCash ?? '—'} USD</b></article><article><span>冻结金额</span><b>{cash?.locked ?? '—'} USD</b></article></div>{snapshot?.account.positions.length === 0 || snapshot === null ? <div className="empty-state"><h2>暂无持仓</h2><p>在交易终端完成模拟买入后，成本与盈亏将在此展示。</p></div> : <div className="list">{snapshot.account.positions.map((position) => <article key={position.positionId}><div><b>{position.symbol}</b><span>现货多头</span></div><div><b>{position.quantity}</b><span>均价 {position.averageEntryPrice ?? '—'}</span></div><strong className={position.unrealizedPnl?.startsWith('-') === true ? 'negative' : 'positive'}>{position.unrealizedPnl ?? '—'}</strong></article>)}</div>}</section>;
  if (page === 'orders') return <section className="page"><header className="page-title"><div><h1>当前委托</h1><p>撤单通过领域事件释放冻结资金，状态在页面间保持一致。</p></div></header><div className="list">{snapshot?.orders.length === 0 || snapshot === null ? <div className="empty-state"><h2>暂无未完成委托</h2><p>提交限价或止损模拟委托后会显示在此处。</p></div> : snapshot.orders.map((order) => <article key={order.orderId}><div><b>{order.draft.symbol}</b><span>{order.draft.side} · {order.draft.type}</span></div><div><b>{order.remainingQuantity}</b><span>{order.status}</span></div><button onClick={() => void cancel(order.orderId)}>撤单</button></article>)}</div></section>;
  return <section className="page"><header className="page-title"><div><h1>成交记录</h1><p>每笔成交保留价格、数量、费用和稳定事件标识。</p></div></header><div className="list">{snapshot?.fills.length === 0 || snapshot === null ? <div className="empty-state"><h2>暂无成交</h2><p>市价模拟成交后会立即写入本地事件账本。</p></div> : snapshot.fills.map((fill) => <article key={fill.fillId}><div><b>{fill.symbol}</b><span>{fill.side}</span></div><div><b>{fill.quantity} @ {fill.price}</b><span>费用 {fill.fee} {fill.feeAsset}</span></div><span>{fill.metadata.receivedAt}</span></article>)}</div></section>;
}

function AlertsPage() {
  const [threshold, setThreshold] = useState('120000');
  const [enabled, setEnabled] = useState(false);
  return <section className="page"><header className="page-title"><div><h1>提醒</h1><p>本地价格提醒不会下单，也不会读取真实资金。</p></div></header><div className="settings-form"><label>BTC-USD 高于<input value={threshold} inputMode="decimal" onChange={(event) => setThreshold(event.target.value)} /></label><button className={enabled ? 'primary-action' : ''} onClick={() => setEnabled((value) => !value)}>{enabled ? '提醒已启用' : '启用提醒'}</button><p role="status">{enabled ? `当测试价格高于 ${threshold} 时显示提醒。` : '提醒当前关闭。'}</p></div></section>;
}

function SettingsPage() {
  const { persistence, reset, message } = usePaperAccount();
  const [confirmation, setConfirmation] = useState('');
  return <section className="page"><header className="page-title"><div><h1>设置</h1><p>管理本地模拟账本；重置必须输入完整确认短语。</p></div></header><div className="settings-grid"><article><h2>本地持久化</h2><p>{persistence === 'indexeddb' ? 'IndexedDB 已启用，刷新页面后账本可重放。' : persistence === 'memory' ? '当前仅保存在本次会话。' : '正在检测浏览器存储。'}</p></article><article><h2>重置模拟账户</h2><label>输入 {RESET_PAPER_ACCOUNT_CONFIRMATION}<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="danger-action" disabled={confirmation !== RESET_PAPER_ACCOUNT_CONFIRMATION} onClick={() => void reset(confirmation).then((ok) => { if (ok) setConfirmation(''); })}>重置为 100,000 USD</button><p role="status">{message}</p></article></div></section>;
}

function InformationPage({ page }: { readonly page: ProductPage }) {
  const { persistence } = usePaperAccount();
  if (page === 'alerts') return <AlertsPage />;
  if (page === 'settings') return <SettingsPage />;
  const title = page === 'health' ? '数据健康与来源' : '使用说明与风险';
  return <section className="page"><header className="page-title"><div><h1>{title}</h1><p>{page === 'health' ? '任何缓存、模拟或测试数据都不会伪装成实时行情。' : 'ATLAS X Unified Pro 当前仅支持模拟交易。'}</p></div>{page === 'health' ? <SourceBadge /> : null}</header><div className="info-grid"><article><h2>行情真实性</h2><p>当前终端为 fixture。公共 Coinbase 链路由独立 smoke 验证，尚未在本屏冒充实时数据。</p></article><article><h2>账本状态</h2><p>{persistence === 'indexeddb' ? '模拟事件已持久化到 IndexedDB。' : '模拟事件当前使用会话内存。'}</p></article><article><h2>安全边界</h2><p>不接入真实资金，不自动部署，不修改生产网关或 Supabase。</p></article></div></section>;
}

function ProductShell() {
  const [page, setPage] = useState<ProductPage>('terminal');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = (next: ProductPage) => {
    setPage(next);
    setMobileMenuOpen(false);
  };
  const content = page === 'terminal' ? <Terminal /> : page === 'markets' ? <Markets /> : page === 'watchlist' ? <Markets watchlistOnly /> : ['assets', 'orders', 'fills'].includes(page) ? <AccountPage page={page} /> : <InformationPage page={page} />;
  return <div className="app-shell"><header className="topbar"><button className="brand" onClick={() => navigate('terminal')} aria-label="返回交易终端"><span>AX</span><b>ATLAS X</b></button><nav aria-label="主要导航">{PRODUCT_PAGES.map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}>{label}</button>)}</nav><button className="mobile-more" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>更多</button><div className="top-actions"><SourceBadge /><button onClick={() => navigate('health')}>数据状态</button></div></header><main>{content}</main>{mobileMenuOpen ? <nav className="mobile-more-sheet" aria-label="更多页面">{PRODUCT_PAGES.slice(5).map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}>{label}</button>)}</nav> : null}<nav className="mobile-nav" aria-label="手机导航">{PRODUCT_PAGES.slice(0, 5).map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}>{label}</button>)}</nav></div>;
}

export function App() {
  return <PaperAccountProvider><ProductShell /></PaperAccountProvider>;
}
