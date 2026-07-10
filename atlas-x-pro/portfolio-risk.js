(() => {
  'use strict';
  if (window.__ATLAS_PORTFOLIO_RISK__) return;
  window.__ATLAS_PORTFOLIO_RISK__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'atlasX.pro.v1';
  const COLORS = ['#45d7bd', '#7c8cff', '#d99a52', '#d06b8b', '#69a8ff', '#8998aa'];
  let resizeTimer = 0;
  let refreshTimer = 0;

  function numberFrom(value) {
    return Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
  }

  function fmt(value, digits = 2) {
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function compact(value) {
    const absolute = Math.abs(Number(value) || 0);
    if (absolute >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (absolute >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (absolute >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
    return fmt(value, 2);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    })[character]);
  }

  function readState() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return state && typeof state === 'object' ? state : {};
    } catch {
      return {};
    }
  }

  function pairFor(symbol) {
    return symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
  }

  function marketPrices() {
    const prices = new Map();
    $$('#marketList [data-symbol]').forEach(row => {
      const symbol = row.dataset.symbol;
      const price = numberFrom($('.price-cell', row)?.textContent);
      if (symbol && price > 0) prices.set(symbol, price);
    });
    const activePair = ($('#activePair')?.textContent || '').replace('/', '');
    const activePrice = numberFrom($('#lastPrice')?.textContent);
    if (activePair && activePrice > 0) prices.set(activePair, activePrice);
    return prices;
  }

  function calculatePortfolio() {
    const state = readState();
    const prices = marketPrices();
    const positions = (Array.isArray(state.positions) ? state.positions : []).map(position => {
      const symbol = String(position.symbol || 'UNKNOWN');
      const quantity = Math.max(0, numberFrom(position.qty));
      const entry = Math.max(0, numberFrom(position.entry));
      const mark = prices.get(symbol) || entry;
      const value = quantity * mark;
      const pnl = (mark - entry) * quantity;
      return { id: position.id, symbol, pair: pairFor(symbol), quantity, entry, mark, value, pnl };
    }).filter(position => position.quantity > 0);

    const cash = Math.max(0, numberFrom(state.cash));
    const reservedCash = (Array.isArray(state.orders) ? state.orders : [])
      .filter(order => order.side === 'buy')
      .reduce((sum, order) => sum + numberFrom(order.total) + numberFrom(order.estimatedFee), 0);
    const availableCash = Math.max(0, cash - reservedCash);
    const invested = positions.reduce((sum, position) => sum + position.value, 0);
    const unrealized = positions.reduce((sum, position) => sum + position.pnl, 0);
    const equity = cash + invested;
    const allocations = [
      ...positions.map(position => ({ label: position.pair, value: position.value, type: 'position' })),
      { label: '现金 USDT', value: cash, type: 'cash' },
    ].filter(item => item.value > 0).sort((a, b) => b.value - a.value);

    allocations.forEach(item => { item.weight = equity > 0 ? item.value / equity * 100 : 0; });
    positions.forEach(position => { position.weight = equity > 0 ? position.value / equity * 100 : 0; });
    const totalWeight = allocations.reduce((sum, item) => sum + item.weight, 0);
    const largestWeight = positions.length ? Math.max(...positions.map(position => position.weight)) : 0;
    const investedRatio = equity > 0 ? invested / equity * 100 : 0;
    const cashRatio = equity > 0 ? cash / equity * 100 : 0;
    const reservedRatio = equity > 0 ? reservedCash / equity * 100 : 0;

    let riskLevel = '低';
    let riskClass = 'positive';
    if (largestWeight >= 45 || investedRatio >= 85 || reservedRatio >= 12) {
      riskLevel = '高';
      riskClass = 'negative';
    } else if (largestWeight >= 25 || investedRatio >= 65 || reservedRatio >= 3) {
      riskLevel = '中等';
      riskClass = 'warning';
    }

    return {
      state,
      positions,
      allocations,
      cash,
      availableCash,
      reservedCash,
      invested,
      unrealized,
      equity,
      totalWeight,
      largestWeight,
      investedRatio,
      cashRatio,
      reservedRatio,
      riskLevel,
      riskClass,
      stressMinus5: invested * -.05,
      stressMinus10: invested * -.10,
      stressPlus5: invested * .05,
    };
  }

  function stat(label, value, note, className = '') {
    return `<article class="portfolio-risk-stat"><span>${label}</span><b class="${className}">${value}</b><small>${note}</small></article>`;
  }

  function allocationLegend(data) {
    if (!data.allocations.length) return '<div class="portfolio-risk-empty">暂无资产配置数据。</div>';
    return data.allocations.map((item, index) => `<div class="portfolio-legend-row"><i style="--legend-color:${COLORS[index % COLORS.length]}"></i><span>${escapeHtml(item.label)}</span><b>${item.weight.toFixed(1)}%</b></div>`).join('');
  }

  function positionRows(data) {
    if (!data.positions.length) return '<div class="portfolio-risk-empty">完成一笔模拟买入后，将显示持仓敞口、权重和未实现盈亏。</div>';
    return data.positions.sort((a, b) => b.value - a.value).map(position => {
      const cls = position.pnl >= 0 ? 'positive' : 'negative';
      return `<div class="portfolio-position-row">
        <span class="pair" data-label="交易对">${escapeHtml(position.pair)}</span>
        <span data-label="市值">${compact(position.value)}</span>
        <span data-label="标记价">${fmt(position.mark, position.mark >= 1000 ? 1 : 4)}</span>
        <span class="${cls}" data-label="未实现盈亏">${position.pnl >= 0 ? '+' : ''}${fmt(position.pnl, 2)}</span>
        <span class="portfolio-weight-cell" data-label="账户权重"><b>${position.weight.toFixed(1)}%</b><i style="--weight:${Math.min(100, position.weight)}%"></i></span>
      </div>`;
    }).join('');
  }

  function riskSignals(data) {
    const concentrationStatus = data.largestWeight >= 45 ? '偏高' : data.largestWeight >= 25 ? '关注' : '分散';
    const liquidityStatus = data.cashRatio >= 30 ? '充足' : data.cashRatio >= 15 ? '一般' : '偏低';
    const freezeStatus = data.reservedRatio >= 12 ? '偏高' : data.reservedRatio >= 3 ? '关注' : '正常';
    return `
      <div class="portfolio-risk-signal"><div><b>单一持仓集中度</b><small>最大持仓占账户权益</small></div><span>${data.largestWeight.toFixed(1)}% · ${concentrationStatus}</span></div>
      <div class="portfolio-risk-signal"><div><b>现金缓冲</b><small>现金占账户权益比例</small></div><span>${data.cashRatio.toFixed(1)}% · ${liquidityStatus}</span></div>
      <div class="portfolio-risk-signal"><div><b>委托冻结资金</b><small>买入挂单占用的现金</small></div><span>${data.reservedRatio.toFixed(1)}% · ${freezeStatus}</span></div>`;
  }

  function renderDashboard(overlay) {
    if (!overlay || overlay.dataset.portfolioRiskReady === 'true') return;
    const data = calculatePortfolio();
    overlay.dataset.portfolioRiskReady = 'true';
    overlay.dataset.totalWeight = String(data.totalWeight);
    overlay.dataset.largestWeight = String(data.largestWeight);
    overlay.dataset.reservedCash = String(data.reservedCash);
    overlay.dataset.stressMinus5 = String(data.stressMinus5);
    overlay.dataset.stressMinus10 = String(data.stressMinus10);
    overlay.dataset.stressPlus5 = String(data.stressPlus5);
    overlay.innerHTML = `
      <div class="portfolio-risk-dashboard">
        <header class="module-header"><div><h1>组合风险中心</h1><p>根据当前模拟持仓、标记价格、现金和冻结委托实时计算。</p></div><button class="module-close" type="button">返回交易终端</button></header>
        <section class="portfolio-risk-summary">
          ${stat('账户权益', fmt(data.equity, 2), 'USDT')}
          ${stat('持仓市值', fmt(data.invested, 2), `${data.investedRatio.toFixed(1)}% 已投资`)}
          ${stat('未实现盈亏', `${data.unrealized >= 0 ? '+' : ''}${fmt(data.unrealized, 2)}`, '当前标记价格', data.unrealized >= 0 ? 'positive' : 'negative')}
          ${stat('可用现金', fmt(data.availableCash, 2), '扣除买入委托冻结')}
          ${stat('冻结资金', fmt(data.reservedCash, 2), `${data.reservedRatio.toFixed(1)}% 账户权益`)}
          ${stat('组合风险', data.riskLevel, `最大持仓 ${data.largestWeight.toFixed(1)}%`, data.riskClass)}
        </section>
        <section class="portfolio-risk-main">
          <article class="portfolio-risk-panel"><header><strong>资产配置</strong><span>现金与持仓权重</span></header><div class="portfolio-allocation-wrap"><div class="portfolio-canvas-wrap"><canvas id="portfolioAllocationCanvas" aria-label="组合资产配置图"></canvas><div class="portfolio-allocation-center"><b>${fmt(data.equity, 0)}</b><span>账户权益 USDT</span></div></div><div class="portfolio-allocation-legend">${allocationLegend(data)}</div></div></article>
          <article class="portfolio-risk-panel"><header><strong>持仓敞口</strong><span>${data.positions.length} 个持仓 · 按市值排序</span></header><div class="portfolio-position-head"><span>交易对</span><span>市值</span><span>标记价</span><span>未实现盈亏</span><span>账户权重</span></div><div class="portfolio-position-list">${positionRows(data)}</div></article>
        </section>
        <section class="portfolio-risk-lower">
          <article class="portfolio-risk-panel"><header><strong>组合压力测试</strong><span>假设全部持仓同步变动</span></header><div class="portfolio-stress-grid"><div class="portfolio-stress-card"><span>市场下跌 5%</span><b class="negative">${fmt(data.stressMinus5, 2)}</b><small>账户权益预计降至 ${fmt(data.equity + data.stressMinus5, 2)}</small></div><div class="portfolio-stress-card"><span>市场下跌 10%</span><b class="negative">${fmt(data.stressMinus10, 2)}</b><small>账户权益预计降至 ${fmt(data.equity + data.stressMinus10, 2)}</small></div><div class="portfolio-stress-card"><span>市场上涨 5%</span><b class="positive">+${fmt(data.stressPlus5, 2)}</b><small>账户权益预计升至 ${fmt(data.equity + data.stressPlus5, 2)}</small></div></div></article>
          <article class="portfolio-risk-panel"><header><strong>风险信号</strong><span id="portfolioRiskLevel">${data.riskLevel}风险</span></header><div class="portfolio-risk-signals">${riskSignals(data)}</div></article>
        </section>
        <p class="portfolio-risk-note">压力测试采用统一价格冲击假设，仅用于验证模拟账户风险敞口，不预测实际市场表现，也不构成投资建议。</p>
      </div>`;
    requestAnimationFrame(() => drawAllocation(data.allocations));
  }

  function drawAllocation(allocations) {
    const canvas = $('#portfolioAllocationCanvas');
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 140 || rect.height < 140) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const total = allocations.reduce((sum, item) => sum + item.value, 0);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(48, Math.min(width, height) * .34);
    const lineWidth = Math.max(17, radius * .22);
    let angle = -Math.PI / 2;
    if (total <= 0) {
      context.strokeStyle = '#263343';
      context.lineWidth = lineWidth;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.stroke();
    } else {
      allocations.forEach((item, index) => {
        const next = angle + item.value / total * Math.PI * 2;
        context.strokeStyle = COLORS[index % COLORS.length];
        context.lineWidth = lineWidth;
        context.lineCap = 'butt';
        context.beginPath();
        context.arc(centerX, centerY, radius, angle, next);
        context.stroke();
        angle = next;
      });
    }
    canvas.dataset.rendered = 'true';
    canvas.dataset.segments = String(allocations.length);
  }

  function inspect() {
    const overlay = $('.module-overlay[data-module="assets"]');
    if (!overlay || overlay.dataset.portfolioRiskReady === 'true') return;
    requestAnimationFrame(() => renderDashboard(overlay));
  }

  function refreshOpenPortfolio() {
    const overlay = $('.module-overlay[data-module="assets"]');
    if (!overlay) return;
    overlay.dataset.portfolioRiskReady = 'false';
    renderDashboard(overlay);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshOpenPortfolio, 90);
  }

  function init() {
    const shell = $('.pro-shell');
    if (shell) new MutationObserver(inspect).observe(shell, { childList: true });
    ['#positionsBody', '#ordersBody', '#accountEquity', '#availableBalance', '#marketList'].forEach(selector => {
      const element = $(selector);
      if (element) new MutationObserver(scheduleRefresh).observe(element, { childList: true, characterData: true, subtree: true });
    });
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const overlay = $('.module-overlay[data-module="assets"]');
        if (!overlay) return;
        drawAllocation(calculatePortfolio().allocations);
      }, 100);
    });
    inspect();
    document.documentElement.dataset.portfolioRisk = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
