(() => {
  'use strict';
  if (window.__ATLAS_PERFORMANCE_ANALYTICS__) return;
  window.__ATLAS_PERFORMANCE_ANALYTICS__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const STORAGE_KEY = 'atlasX.pro.v1';
  const STARTING_EQUITY = 100000;
  let resizeTimer = 0;

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

  function calculatePerformance() {
    const state = readState();
    const historyNewest = Array.isArray(state.history) ? state.history : [];
    const history = [...historyNewest].reverse();
    const books = new Map();
    const contributions = new Map();
    const tradeResults = new Map();
    const curve = [{ time: history[0]?.createdAt || Date.now(), equity: STARTING_EQUITY }];
    let realizedGross = 0;
    let totalFees = 0;
    let turnover = 0;
    const closedTrades = [];

    history.forEach((fill, index) => {
      const symbol = String(fill.symbol || 'UNKNOWN');
      const side = fill.side === 'sell' ? 'sell' : 'buy';
      const price = numberFrom(fill.price);
      const quantity = numberFrom(fill.qty);
      const fee = numberFrom(fill.fee);
      const book = books.get(symbol) || { quantity: 0, average: 0 };
      const notional = price * quantity;
      totalFees += fee;
      turnover += notional;

      if (side === 'buy') {
        const nextQuantity = book.quantity + quantity;
        book.average = nextQuantity > 0
          ? (book.average * book.quantity + price * quantity) / nextQuantity
          : 0;
        book.quantity = nextQuantity;
        tradeResults.set(fill.id || `fill-${index}`, { realized: null, net: -fee });
      } else {
        const closeQuantity = Math.min(quantity, book.quantity);
        const gross = closeQuantity > 0 ? (price - book.average) * closeQuantity : 0;
        const net = gross - fee;
        realizedGross += gross;
        book.quantity = Math.max(0, book.quantity - closeQuantity);
        if (book.quantity <= 1e-10) book.average = 0;
        contributions.set(symbol, (contributions.get(symbol) || 0) + net);
        tradeResults.set(fill.id || `fill-${index}`, { realized: gross, net });
        closedTrades.push(net);
      }
      books.set(symbol, book);
      curve.push({
        time: Number(fill.createdAt) || Date.now(),
        equity: STARTING_EQUITY + realizedGross - totalFees,
      });
    });

    const unrealized = numberFrom($('#unrealizedPnl')?.textContent);
    const displayedEquity = numberFrom($('#accountEquity')?.textContent) || STARTING_EQUITY + realizedGross - totalFees + unrealized;
    if (curve.length === 1 || Math.abs(curve.at(-1).equity - displayedEquity) > 0.005) {
      curve.push({ time: Date.now(), equity: displayedEquity });
    }

    const wins = closedTrades.filter(value => value > 0);
    const losses = closedTrades.filter(value => value < 0);
    const grossProfit = wins.reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
    const winRate = closedTrades.length ? wins.length / closedTrades.length * 100 : null;
    const averageWin = wins.length ? grossProfit / wins.length : 0;
    const averageLoss = losses.length ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;

    let peak = curve[0].equity;
    let maxDrawdown = 0;
    curve.forEach(point => {
      peak = Math.max(peak, point.equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak * 100);
    });

    return {
      state,
      historyNewest,
      curve,
      tradeResults,
      contributions: [...contributions.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])),
      realizedGross,
      realizedNet: realizedGross - totalFees,
      unrealized,
      totalFees,
      turnover,
      displayedEquity,
      closedCount: closedTrades.length,
      winRate,
      averageWin,
      averageLoss,
      profitFactor,
      maxDrawdown,
      tradeCount: historyNewest.length,
    };
  }

  function signed(value) {
    return `${value >= 0 ? '+' : ''}${fmt(value, 2)}`;
  }

  function stat(label, value, note, className = '') {
    return `<article class="performance-stat"><span>${label}</span><b class="${className}">${value}</b><small>${note}</small></article>`;
  }

  function contributionMarkup(data) {
    if (!data.contributions.length) return '<div class="performance-empty">完成一组买入与卖出后，将显示各交易对对已实现盈亏的贡献。</div>';
    const max = Math.max(...data.contributions.map(([, value]) => Math.abs(value)), 1);
    return data.contributions.map(([symbol, value]) => {
      const pair = symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
      const percentage = Math.max(3, Math.abs(value) / max * 100);
      const cls = value >= 0 ? 'positive' : 'negative';
      return `<div class="contribution-row"><div><b>${escapeHtml(pair)}</b><span>已实现净贡献</span><div class="contribution-bar ${cls}"><i style="--contribution:${percentage}%"></i></div></div><strong class="${cls}">${signed(value)}</strong></div>`;
    }).join('');
  }

  function recentTradeMarkup(data) {
    if (!data.historyNewest.length) return '<div class="performance-empty">暂无成交数据。模拟订单成交后，费用、成交额和表现将自动进入分析账本。</div>';
    return data.historyNewest.slice(0, 14).map((fill, index) => {
      const symbol = String(fill.symbol || '--');
      const pair = symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
      const result = data.tradeResults.get(fill.id || `fill-${data.historyNewest.length - 1 - index}`);
      const net = result?.realized == null ? null : result.net;
      const cls = net == null ? '' : net >= 0 ? 'positive' : 'negative';
      return `<div class="performance-trade-row"><span class="pair">${escapeHtml(pair)}</span><span class="${fill.side === 'sell' ? 'negative' : 'positive'}">${fill.side === 'sell' ? '卖出' : '买入'}</span><span>${fmt(fill.price, Number(fill.price) >= 1000 ? 1 : 4)}</span><span>${fmt(fill.fee, 2)}</span><span class="${cls}">${net == null ? '--' : signed(net)}</span></div>`;
    }).join('');
  }

  function renderDashboard(overlay) {
    if (!overlay || overlay.dataset.performanceReady === 'true') return;
    const data = calculatePerformance();
    overlay.dataset.performanceReady = 'true';
    overlay.innerHTML = `
      <div class="performance-dashboard">
        <header class="module-header"><div><h1>账户分析</h1><p>根据本地模拟成交账本计算，不预测未来收益，不构成投资建议。</p></div><button class="module-close" type="button">返回交易终端</button></header>
        <section class="performance-summary-grid">
          ${stat('模拟账户权益', fmt(data.displayedEquity, 2), 'USDT', data.displayedEquity >= STARTING_EQUITY ? 'positive' : 'negative')}
          ${stat('已实现净盈亏', signed(data.realizedNet), '已扣全部手续费', data.realizedNet >= 0 ? 'positive' : 'negative')}
          ${stat('未实现盈亏', signed(data.unrealized), '当前持仓标记价格', data.unrealized >= 0 ? 'positive' : 'negative')}
          ${stat('交易胜率', data.winRate == null ? '--' : `${data.winRate.toFixed(1)}%`, `${data.closedCount} 笔已平仓交易`)}
          ${stat('累计手续费', fmt(data.totalFees, 2), 'USDT')}
          ${stat('累计成交额', compact(data.turnover), 'USDT')}
        </section>
        <section class="performance-main-grid">
          <article class="performance-panel"><header><strong>模拟权益曲线</strong><span>起始权益 ${fmt(STARTING_EQUITY, 0)} USDT</span></header><div class="performance-chart-wrap"><div class="performance-chart-legend"><span><i></i>账户权益</span><span><i class="benchmark"></i>起始基准</span></div><canvas id="performanceChart" aria-label="模拟账户权益曲线"></canvas></div></article>
          <article class="performance-panel"><header><strong>执行质量</strong><span>基于成交账本</span></header><div class="performance-metrics">
            <div class="performance-metric"><span>盈亏比</span><b>${data.profitFactor == null ? '--' : data.profitFactor === Infinity ? '∞' : data.profitFactor.toFixed(2)}</b><small>盈利总额 / 亏损总额</small></div>
            <div class="performance-metric"><span>最大回撤</span><b>${data.maxDrawdown.toFixed(2)}%</b><small>权益曲线峰谷回撤</small></div>
            <div class="performance-metric"><span>平均盈利</span><b class="positive">${signed(data.averageWin)}</b><small>每笔盈利平仓</small></div>
            <div class="performance-metric"><span>平均亏损</span><b class="negative">${data.averageLoss ? `-${fmt(data.averageLoss, 2)}` : '+0.00'}</b><small>每笔亏损平仓</small></div>
            <div class="performance-metric"><span>成交笔数</span><b>${data.tradeCount}</b><small>买入与卖出成交</small></div>
            <div class="performance-metric"><span>已平仓样本</span><b>${data.closedCount}</b><small>用于胜率与盈亏比</small></div>
          </div></article>
        </section>
        <section class="performance-lower-grid">
          <article class="performance-panel"><header><strong>币种贡献</strong><span>已实现净盈亏</span></header><div class="contribution-list">${contributionMarkup(data)}</div></article>
          <article class="performance-panel"><header><strong>最近成交</strong><span>成交价 · 手续费 · 平仓净结果</span></header><div class="performance-trade-head"><span>交易对</span><span>方向</span><span>成交价</span><span>手续费</span><span>净结果</span></div><div class="performance-trade-list">${recentTradeMarkup(data)}</div></article>
        </section>
        <p class="performance-disclaimer">统计仅基于当前浏览器中的模拟成交记录。清除浏览器数据会同时清除账户和分析账本；真实行情不可用时，系统会明确使用演示行情。</p>
      </div>`;
    overlay.dataset.tradeCount = String(data.tradeCount);
    overlay.dataset.realizedNet = String(data.realizedNet);
    overlay.dataset.winRate = data.winRate == null ? '' : String(data.winRate);
    requestAnimationFrame(() => drawChart(data.curve));
  }

  function drawChart(points) {
    const canvas = $('#performanceChart');
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 120) return;
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

    const padding = { top: 38, right: 62, bottom: 28, left: 12 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const values = points.map(point => point.equity);
    let min = Math.min(...values, STARTING_EQUITY);
    let max = Math.max(...values, STARTING_EQUITY);
    const rawRange = Math.max(1, max - min);
    min -= rawRange * 0.16;
    max += rawRange * 0.16;
    const range = max - min;
    const toX = index => padding.left + (points.length <= 1 ? 0 : index / (points.length - 1)) * chartWidth;
    const toY = value => padding.top + ((max - value) / range) * chartHeight;

    context.lineWidth = 1;
    context.strokeStyle = '#1b2633';
    context.fillStyle = '#65758a';
    context.font = '8px SFMono-Regular,Consolas,monospace';
    context.textBaseline = 'middle';
    for (let line = 0; line <= 4; line += 1) {
      const y = padding.top + chartHeight / 4 * line;
      context.beginPath();
      context.moveTo(padding.left, y + .5);
      context.lineTo(width - padding.right, y + .5);
      context.stroke();
      context.fillText(fmt(max - range / 4 * line, 0), width - padding.right + 8, y);
    }

    const benchmarkY = toY(STARTING_EQUITY);
    context.setLineDash([4, 4]);
    context.strokeStyle = '#425066';
    context.beginPath();
    context.moveTo(padding.left, benchmarkY);
    context.lineTo(width - padding.right, benchmarkY);
    context.stroke();
    context.setLineDash([]);

    const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
    gradient.addColorStop(0, 'rgba(69,215,189,.22)');
    gradient.addColorStop(1, 'rgba(69,215,189,0)');
    context.beginPath();
    points.forEach((point, index) => {
      const x = toX(index);
      const y = toY(point.equity);
      index ? context.lineTo(x, y) : context.moveTo(x, y);
    });
    context.lineTo(toX(points.length - 1), padding.top + chartHeight);
    context.lineTo(toX(0), padding.top + chartHeight);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    points.forEach((point, index) => {
      const x = toX(index);
      const y = toY(point.equity);
      index ? context.lineTo(x, y) : context.moveTo(x, y);
    });
    context.strokeStyle = '#45d7bd';
    context.lineWidth = 1.7;
    context.stroke();

    const last = points.at(-1);
    const lastX = toX(points.length - 1);
    const lastY = toY(last.equity);
    context.fillStyle = '#45d7bd';
    context.beginPath();
    context.arc(lastX, lastY, 3, 0, Math.PI * 2);
    context.fill();
    canvas.dataset.rendered = 'true';
    canvas.dataset.points = String(points.length);
  }

  function inspect() {
    const overlay = $('.module-overlay[data-module="analytics"]');
    if (!overlay || overlay.dataset.performanceReady === 'true') return;
    requestAnimationFrame(() => renderDashboard(overlay));
  }

  function refreshOpenAnalytics() {
    const overlay = $('.module-overlay[data-module="analytics"]');
    if (!overlay) return;
    overlay.dataset.performanceReady = 'false';
    renderDashboard(overlay);
  }

  function init() {
    const shell = $('.pro-shell');
    if (shell) new MutationObserver(inspect).observe(shell, { childList: true });
    const historyCount = $('#historyCount');
    if (historyCount) new MutationObserver(() => {
      clearTimeout(refreshOpenAnalytics.timer);
      refreshOpenAnalytics.timer = setTimeout(refreshOpenAnalytics, 80);
    }).observe(historyCount, { childList: true, characterData: true, subtree: true });
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const overlay = $('.module-overlay[data-module="analytics"]');
        if (!overlay) return;
        const data = calculatePerformance();
        drawChart(data.curve);
      }, 100);
    });
    inspect();
    document.documentElement.dataset.performanceAnalytics = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
