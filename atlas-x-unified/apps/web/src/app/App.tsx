import { useMemo, useState } from 'react';
import { PRODUCT_PAGES, createDraft, estimateTicket, marketFixture, type Interval, type ProductPage, type TicketState } from './model.js';
import { usePaperAccount } from './usePaperAccount.js';
import './styles.css';

const intervals: readonly Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
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
    <section className="panel book" aria-labelledby="book-title">
      <header><h2 id="book-title">订单簿</h2><span>价格 · 数量</span></header>
      <div className="book-side asks">{[...marketFixture.asks].reverse().map((row) => <div key={row.price}><b>{row.price}</b><span>{row.quantity}</span></div>)}</div>
      <strong className="mid-price">118,420.35</strong>
      <div className="book-side bids">{marketFixture.bids.map((row) => <div key={row.price}><b>{row.price}</b><span>{row.quantity}</span></div>)}</div>
    </section>
  );
}

function OrderTicket() {
  const [ticket, setTicket] = useState<TicketState>({ side: 'buy', type: 'market', quantity: '0.1', limitPrice: '118400' });
  const [confirming, setConfirming] = useState(false);
  const { snapshot, message, submit } = usePaperAccount();
  const estimate = useMemo(() => {
    try { return estimateTicket(ticket); } catch { return null; }
  }, [ticket]);
  const cash = snapshot?.account.availableCash ?? '—';

  async function placeOrder() {
    const draft = createDraft(ticket, `web-${Date.now()}`, new Date().toISOString());
    await submit(draft, marketFixture.last);
    setConfirming(false);
  }

  return (
    <section className="panel ticket" aria-labelledby="ticket-title">
      <header><h2 id="ticket-title">模拟下单</h2><span>可用 USD {cash}</span></header>
      <div className="segmented" aria-label="买卖方向">
        {(['buy', 'sell'] as const).map((side) => <button key={side} className={ticket.side === side ? 'active' : ''} onClick={() => setTicket({ ...ticket, side })}>{side === 'buy' ? '买入' : '卖出'}</button>)}
      </div>
      <div className="order-types">
        {(['market', 'limit'] as const).map((type) => <button key={type} className={ticket.type === type ? 'active' : ''} onClick={() => setTicket({ ...ticket, type })}>{type === 'market' ? '市价' : '限价'}</button>)}
      </div>
      {ticket.type === 'limit' ? <label>限价<input value={ticket.limitPrice} inputMode="decimal" onChange={(event) => setTicket({ ...ticket, limitPrice: event.target.value })} /></label> : null}
      <label>数量 BTC<input value={ticket.quantity} inputMode="decimal" onChange={(event) => setTicket({ ...ticket, quantity: event.target.value })} /></label>
      <div className="estimate">
        <div><span>预计成交</span><b>{estimate?.filledQuantity ?? '—'} BTC</b></div>
        <div><span>VWAP</span><b>{estimate?.vwap ?? '—'}</b></div>
        <div><span>手续费</span><b>{estimate?.fee ?? '—'} USD</b></div>
        <div><span>深度覆盖</span><b>{estimate === null ? '—' : `${Number(estimate.coverageRate) * 100}%`}</b></div>
      </div>
      {estimate?.depthInsufficient === true ? <p className="warning">盘口深度不足，订单可能部分成交。</p> : null}
      <button className={`submit ${ticket.side}`} disabled={estimate === null} onClick={() => setConfirming(true)}>{ticket.side === 'buy' ? '复核买入' : '复核卖出'}</button>
      <p className="status" role="status">{message}</p>
      {confirming ? <div className="confirm" role="dialog" aria-modal="true" aria-label="确认模拟委托"><h3>确认模拟委托</h3><p>{ticket.side === 'buy' ? '买入' : '卖出'} {ticket.quantity} BTC · {ticket.type === 'market' ? '市价' : ticket.limitPrice}</p><div><button onClick={() => setConfirming(false)}>返回修改</button><button className="primary" onClick={() => void placeOrder()}>确认提交</button></div></div> : null}
    </section>
  );
}

function Terminal() {
  const [interval, setInterval] = useState<Interval>('15m');
  return (
    <div className="terminal-grid">
      <section className="market-stage">
        <div className="market-heading"><div><p>{marketFixture.symbol}</p><h1>118,420.35</h1><strong>+2,526.20 · +2.18%</strong></div><SourceBadge /></div>
        <div className="intervals">{intervals.map((item) => <button key={item} className={item === interval ? 'active' : ''} onClick={() => setInterval(item)}>{item}</button>)}</div>
        <Chart interval={interval} />
      </section>
      <OrderBook />
      <OrderTicket />
      <section className="panel trades"><header><h2>最近成交</h2><span>测试序列</span></header>{[['118420.35','0.024'],['118418.20','0.180'],['118430.10','0.042'],['118405.00','0.320']].map(([price, quantity], index) => <div key={`${price}-${index}`}><b className={index % 2 === 0 ? 'positive' : 'negative'}>{price}</b><span>{quantity}</span><time>刚刚</time></div>)}</section>
    </div>
  );
}

function Markets({ watchlistOnly = false }: { readonly watchlistOnly?: boolean }) {
  const rows = watchlistOnly ? markets.slice(0, 2) : markets;
  return <section className="page"><header className="page-title"><div><h1>{watchlistOnly ? '自选' : '市场'}</h1><p>明确区分测试、缓存与真实行情来源。</p></div><SourceBadge /></header><div className="market-table"><div className="table-head"><span>市场</span><span>最新价</span><span>24h</span></div>{rows.map(([symbol, price, change]) => <button key={symbol}><b>{symbol}</b><span>{price}</span><strong className={change.startsWith('+') ? 'positive' : 'negative'}>{change}</strong></button>)}</div></section>;
}

function AccountPage({ page }: { readonly page: ProductPage }) {
  const { snapshot, cancel } = usePaperAccount();
  if (page === 'assets') return <section className="page"><header className="page-title"><div><h1>资产与持仓</h1><p>所有金额来自模拟事件账本。</p></div><span className="source-badge simulated">模拟账户</span></header><div className="metric-grid"><article><span>总资产</span><b>{snapshot?.account.equity ?? '—'} USD</b></article><article><span>可用资金</span><b>{snapshot?.account.availableCash ?? '—'} USD</b></article><article><span>冻结金额</span><b>{snapshot?.account.assets[0]?.locked ?? '—'} USD</b></article></div><div className="empty-state"><h2>暂无持仓</h2><p>在交易终端完成模拟买入后，成本与盈亏将在此展示。</p></div></section>;
  if (page === 'orders') return <section className="page"><header className="page-title"><div><h1>当前委托</h1><p>撤单会通过领域事件释放冻结资金。</p></div></header><div className="list">{snapshot?.orders.length === 0 || snapshot === null ? <div className="empty-state"><h2>暂无未完成委托</h2><p>提交模拟限价单后会显示在此处。</p></div> : snapshot.orders.map((order) => <article key={order.orderId}><div><b>{order.draft.symbol}</b><span>{order.draft.side} · {order.draft.type}</span></div><div><b>{order.remainingQuantity}</b><span>{order.status}</span></div><button onClick={() => void cancel(order.orderId)}>撤单</button></article>)}</div></section>;
  return <section className="page"><header className="page-title"><div><h1>{page === 'fills' ? '成交记录' : '历史委托'}</h1><p>完整记录将由模拟账本提供。</p></div></header><div className="empty-state"><h2>暂无记录</h2><p>完成模拟交易后，此处会显示可审计的事件历史。</p></div></section>;
}

function InformationPage({ page }: { readonly page: ProductPage }) {
  const copy: Record<string, [string, string]> = {
    alerts: ['提醒', '价格与连接状态提醒将在后续批次接入。'],
    settings: ['设置', '管理显示、交易确认和模拟账户偏好。'],
    health: ['数据健康与来源', '当前行情为 fixture，绝不冒充真实市场数据。'],
    help: ['使用说明与风险', '本产品仅提供模拟交易，不连接真实资金或真实下单。'],
  };
  const [title, description] = copy[page] ?? ['ATLAS X', '统一专业交易工作区'];
  return <section className="page"><header className="page-title"><div><h1>{title}</h1><p>{description}</p></div>{page === 'health' ? <SourceBadge /> : null}</header><div className="info-grid"><article><h2>可信状态</h2><p>unknown、cachedReal、real、simulated 与 fixture 在契约和界面中保持严格分离。</p></article><article><h2>精确计算</h2><p>价格、数量、手续费与盈亏全部使用规范十进制字符串和 decimal.js。</p></article><article><h2>安全边界</h2><p>不接入真实资金，不自动部署，不修改生产网关或 Supabase。</p></article></div></section>;
}

export function App() {
  const [page, setPage] = useState<ProductPage>('terminal');
  const content = page === 'terminal' ? <Terminal /> : page === 'markets' ? <Markets /> : page === 'watchlist' ? <Markets watchlistOnly /> : ['assets','orders','fills'].includes(page) ? <AccountPage page={page} /> : <InformationPage page={page} />;
  return <div className="app-shell"><header className="topbar"><button className="brand" onClick={() => setPage('terminal')} aria-label="返回交易终端"><span>AX</span><b>ATLAS X</b></button><nav aria-label="主要导航">{PRODUCT_PAGES.slice(0, 7).map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>)}</nav><div className="top-actions"><SourceBadge /><button onClick={() => setPage('health')}>数据状态</button></div></header><main>{content}</main><nav className="mobile-nav" aria-label="手机导航">{PRODUCT_PAGES.slice(0, 5).map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>)}</nav></div>;
}
