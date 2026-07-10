(() => {
  'use strict';
  if (window.__ATLAS_PERFORMANCE_ACCOUNTING__) return;
  window.__ATLAS_PERFORMANCE_ACCOUNTING__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'atlasX.pro.v1';
  let scheduled = 0;

  function numberFrom(value) {
    return Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
  }

  function fmt(value, digits = 2) {
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function signed(value) {
    return `${value >= 0 ? '+' : ''}${fmt(value, 2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    })[character]);
  }

  function readHistory() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return Array.isArray(state?.history) ? state.history : [];
    } catch {
      return [];
    }
  }

  function calculate(historyNewest) {
    const history = [...historyNewest].reverse();
    const books = new Map();
    const contributions = new Map();
    const results = new Map();
    const closed = [];

    history.forEach((fill, index) => {
      const symbol = String(fill.symbol || 'UNKNOWN');
      const side = fill.side === 'sell' ? 'sell' : 'buy';
      const price = numberFrom(fill.price);
      const quantity = Math.max(0, numberFrom(fill.qty));
      const fee = Math.max(0, numberFrom(fill.fee));
      const key = fill.id || `fill-${index}`;
      const book = books.get(symbol) || { quantity: 0, average: 0, entryFees: 0 };

      if (side === 'buy') {
        const nextQuantity = book.quantity + quantity;
        book.average = nextQuantity > 0
          ? (book.average * book.quantity + price * quantity) / nextQuantity
          : 0;
        book.quantity = nextQuantity;
        book.entryFees += fee;
        results.set(key, { realized: null, net: null, entryFee: fee, exitFee: 0 });
      } else {
        const quantityBefore = book.quantity;
        const closeQuantity = Math.min(quantity, quantityBefore);
        const entryFee = quantityBefore > 0 ? book.entryFees * (closeQuantity / quantityBefore) : 0;
        const exitFee = quantity > 0 ? fee * (closeQuantity / quantity) : 0;
        const gross = closeQuantity > 0 ? (price - book.average) * closeQuantity : 0;
        const net = gross - entryFee - exitFee;

        if (closeQuantity > 0) {
          closed.push(net);
          contributions.set(symbol, (contributions.get(symbol) || 0) + net);
        }

        book.quantity = Math.max(0, quantityBefore - closeQuantity);
        book.entryFees = Math.max(0, book.entryFees - entryFee);
        if (book.quantity <= 1e-10) {
          book.quantity = 0;
          book.average = 0;
          book.entryFees = 0;
        }
        results.set(key, { realized: gross, net: closeQuantity > 0 ? net : null, entryFee, exitFee });
      }
      books.set(symbol, book);
    });

    const wins = closed.filter(value => value > 0);
    const losses = closed.filter(value => value < 0);
    const grossProfit = wins.reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));

    return {
      historyNewest,
      results,
      contributions: [...contributions.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])),
      realizedNet: closed.reduce((sum, value) => sum + value, 0),
      closedCount: closed.length,
      winRate: closed.length ? wins.length / closed.length * 100 : null,
      averageWin: wins.length ? grossProfit / wins.length : 0,
      averageLoss: losses.length ? grossLoss / losses.length : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    };
  }

  function findCard(root, selector, label) {
    return $$(selector, root).find(card => $(card.matches('.performance-stat') ? 'span' : '.performance-metric span', card)?.textContent.trim() === label);
  }

  function setCard(root, selector, label, value, className = '') {
    const card = findCard(root, selector, label);
    const output = card?.querySelector('b');
    if (!output) return;
    output.textContent = value;
    output.className = className;
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
    const total = data.historyNewest.length;
    return data.historyNewest.slice(0, 14).map((fill, index) => {
      const symbol = String(fill.symbol || '--');
      const pair = symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
      const result = data.results.get(fill.id || `fill-${total - 1 - index}`);
      const net = result?.net;
      const cls = net == null ? '' : net >= 0 ? 'positive' : 'negative';
      return `<div class="performance-trade-row"><span class="pair">${escapeHtml(pair)}</span><span class="${fill.side === 'sell' ? 'negative' : 'positive'}">${fill.side === 'sell' ? '卖出' : '买入'}</span><span>${fmt(fill.price, Number(fill.price) >= 1000 ? 1 : 4)}</span><span>${fmt(fill.fee, 2)}</span><span class="${cls}">${net == null ? '--' : signed(net)}</span></div>`;
    }).join('');
  }

  function applyAccounting() {
    const overlay = $('.module-overlay[data-module="analytics"]');
    if (!overlay || overlay.dataset.performanceReady !== 'true') return;
    const history = readHistory();
    const signature = history.map(fill => `${fill.id || ''}:${fill.side}:${fill.qty}:${fill.price}:${fill.fee}`).join('|');
    if (overlay.dataset.accountingSignature === signature) return;

    const data = calculate(history);
    overlay.dataset.accountingSignature = signature;
    overlay.dataset.realizedNet = String(data.realizedNet);
    overlay.dataset.winRate = data.winRate == null ? '' : String(data.winRate);
    overlay.dataset.closedCount = String(data.closedCount);

    setCard(overlay, '.performance-stat', '已实现净盈亏', signed(data.realizedNet), data.realizedNet >= 0 ? 'positive' : 'negative');
    setCard(overlay, '.performance-stat', '交易胜率', data.winRate == null ? '--' : `${data.winRate.toFixed(1)}%`);
    setCard(overlay, '.performance-metric', '盈亏比', data.profitFactor == null ? '--' : data.profitFactor === Infinity ? '∞' : data.profitFactor.toFixed(2));
    setCard(overlay, '.performance-metric', '平均盈利', signed(data.averageWin), 'positive');
    setCard(overlay, '.performance-metric', '平均亏损', data.averageLoss ? `-${fmt(data.averageLoss, 2)}` : '+0.00', 'negative');
    setCard(overlay, '.performance-metric', '已平仓样本', String(data.closedCount));

    const realizedCard = findCard(overlay, '.performance-stat', '已实现净盈亏');
    const realizedNote = realizedCard?.querySelector('small');
    if (realizedNote) realizedNote.textContent = '按平仓比例分摊进出场手续费';

    const contributions = $('.contribution-list', overlay);
    if (contributions) contributions.innerHTML = contributionMarkup(data);
    const trades = $('.performance-trade-list', overlay);
    if (trades) trades.innerHTML = recentTradeMarkup(data);
  }

  function schedule() {
    clearTimeout(scheduled);
    scheduled = setTimeout(applyAccounting, 40);
  }

  function init() {
    const shell = $('.pro-shell');
    if (shell) new MutationObserver(schedule).observe(shell, { childList: true, subtree: true });
    const historyCount = $('#historyCount');
    if (historyCount) new MutationObserver(schedule).observe(historyCount, { childList: true, characterData: true, subtree: true });
    schedule();
    window.AtlasPerformanceAccounting = { calculate };
    document.documentElement.dataset.performanceAccounting = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
