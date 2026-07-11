(() => {
  'use strict';
  if (window.__ATLAS_EXECUTION_GUARD__) return;
  window.__ATLAS_EXECUTION_GUARD__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'atlasX.pro.v1';
  const EXIT_STORAGE_KEY = 'atlasX.pro.exitStrategies.v1';
  const MIN_NOTIONAL = 5;
  const DUPLICATE_WINDOW_MS = 850;
  let bypassOnce = false;
  let pendingContext = null;
  let lastSubmission = { fingerprint: '', at: 0 };

  function numberFrom(value) {
    return Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
  }

  function readState() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return state && typeof state === 'object' ? state : {};
    } catch {
      return {};
    }
  }

  function readExitStore() {
    try {
      const store = JSON.parse(localStorage.getItem(EXIT_STORAGE_KEY) || 'null');
      return store && typeof store === 'object' && Array.isArray(store.strategies)
        ? store
        : { strategies: [] };
    } catch {
      return { strategies: [] };
    }
  }

  function activeValue(selector, dataName, fallback) {
    return $(`${selector}.active`)?.dataset?.[dataName] || fallback;
  }

  function activeSymbol() {
    const pair = ($('#activePair')?.textContent || 'BTC/USDT').trim();
    return pair.replace('/', '');
  }

  function currentPrice() {
    return numberFrom($('#lastPrice')?.textContent);
  }

  function bestPrice(side) {
    const selector = side === 'ask' ? '#asksRows [data-book-price]' : '#bidsRows [data-book-price]';
    const prices = $$(selector).map(row => numberFrom(row.dataset.bookPrice)).filter(price => price > 0);
    if (!prices.length) return currentPrice();
    return side === 'ask' ? Math.min(...prices) : Math.max(...prices);
  }

  function positionQuantity(state, symbol) {
    return (Array.isArray(state.positions) ? state.positions : [])
      .filter(position => position.symbol === symbol)
      .reduce((sum, position) => sum + numberFrom(position.qty), 0);
  }

  function coreReservedSellQuantity(state, symbol) {
    return (Array.isArray(state.orders) ? state.orders : [])
      .filter(order => order.symbol === symbol && order.side === 'sell')
      .reduce((sum, order) => sum + Math.max(0, numberFrom(order.qty) - numberFrom(order.filled)), 0);
  }

  function trailingReservedSellQuantity(symbol) {
    return readExitStore().strategies
      .filter(strategy => strategy.kind === 'trailing_stop'
        && strategy.symbol === symbol
        && ['waiting_activation', 'active'].includes(strategy.status))
      .reduce((sum, strategy) => sum + Math.max(0, numberFrom(strategy.quantity)), 0);
  }

  function accountEquity() {
    return numberFrom($('#accountEquity')?.textContent) || 100000;
  }

  function buildContext() {
    const state = readState();
    const symbol = activeSymbol();
    const pair = ($('#activePair')?.textContent || symbol).trim();
    const side = activeValue('.side-selector [data-side]', 'side', 'buy');
    const orderType = activeValue('[data-order-type]', 'orderType', 'market');
    const quantity = numberFrom($('#orderQuantity')?.value);
    const total = numberFrom($('#orderTotal')?.value);
    const limitPrice = numberFrom($('#orderPrice')?.value);
    const triggerPrice = numberFrom($('#triggerPrice')?.value);
    const price = orderType === 'market' ? currentPrice() : limitPrice;
    const held = positionQuantity(state, symbol);
    const coreReservedSell = coreReservedSellQuantity(state, symbol);
    const trailingReservedSell = trailingReservedSellQuantity(symbol);
    const reservedSell = coreReservedSell + trailingReservedSell;
    const sellAvailable = Math.max(0, held - reservedSell);
    const availableCash = numberFrom($('#ticketAvailable')?.textContent);
    const postOnly = Boolean($('#postOnly')?.checked);
    const reduceOnly = Boolean($('#reduceOnly')?.checked);
    const bestAsk = bestPrice('ask');
    const bestBid = bestPrice('bid');
    const deviation = currentPrice() > 0 && price > 0 ? Math.abs(price / currentPrice() - 1) * 100 : 0;
    return {
      state, symbol, pair, side, orderType, quantity, total, price, limitPrice, triggerPrice,
      held, coreReservedSell, trailingReservedSell, reservedSell, sellAvailable, availableCash,
      postOnly, reduceOnly, bestAsk, bestBid, deviation, equity: accountEquity(),
    };
  }

  function orderFingerprint(context) {
    return [
      context.symbol,
      context.side,
      context.orderType,
      Number(context.price || 0).toPrecision(12),
      Number(context.triggerPrice || 0).toPrecision(12),
      Number(context.quantity || 0).toPrecision(12),
      Number(context.total || 0).toPrecision(12),
      context.postOnly ? 'P' : '-',
      context.reduceOnly ? 'R' : '-',
    ].join('|');
  }

  function isIdenticalDuplicate(context) {
    const fingerprint = orderFingerprint(context);
    return fingerprint === lastSubmission.fingerprint && Date.now() - lastSubmission.at < DUPLICATE_WINDOW_MS;
  }

  function rememberSubmission(context) {
    lastSubmission = { fingerprint: orderFingerprint(context), at: Date.now() };
  }

  function validate(context) {
    if (isIdenticalDuplicate(context)) return { ok: false, level: 'warning', message: '检测到相同订单重复提交，已自动阻止' };
    if (!(context.quantity > 0) || !(context.total > 0)) return { ok: false, level: 'danger', message: '请输入有效的数量和总额' };
    if (context.total < MIN_NOTIONAL) return { ok: false, level: 'danger', message: `最小模拟成交额为 ${MIN_NOTIONAL.toFixed(2)} USDT` };
    if (!(context.price > 0)) return { ok: false, level: 'danger', message: '委托价格无效' };
    if (context.orderType === 'stop' && !(context.triggerPrice > 0)) return { ok: false, level: 'danger', message: '止盈止损订单必须设置有效触发价' };
    if (context.orderType !== 'market' && context.deviation > 20) return { ok: false, level: 'danger', message: `委托价偏离最新价 ${context.deviation.toFixed(1)}%，已阻止异常订单` };
    if (context.postOnly && context.orderType !== 'limit') return { ok: false, level: 'danger', message: 'Post Only 仅适用于限价订单' };
    if (context.postOnly && context.side === 'buy' && context.limitPrice >= context.bestAsk) return { ok: false, level: 'danger', message: '该买单会立即成交，不符合 Post Only' };
    if (context.postOnly && context.side === 'sell' && context.limitPrice <= context.bestBid) return { ok: false, level: 'danger', message: '该卖单会立即成交，不符合 Post Only' };
    if (context.reduceOnly && context.side !== 'sell') return { ok: false, level: 'danger', message: '现货只减仓仅允许卖出已有持仓' };
    if (context.side === 'buy' && context.total * 1.001 > context.availableCash) return { ok: false, level: 'danger', message: '可用 USDT 余额不足（已包含冻结委托）' };
    if (context.side === 'sell' && context.quantity > context.sellAvailable + 1e-10) {
      const reservations = [];
      if (context.coreReservedSell > 0) reservations.push(`核心卖单冻结 ${context.coreReservedSell.toFixed(6)}`);
      if (context.trailingReservedSell > 0) reservations.push(`退出策略预留 ${context.trailingReservedSell.toFixed(6)}`);
      const reservedCopy = reservations.length ? `，其中 ${reservations.join('，')}` : '';
      return { ok: false, level: 'danger', message: `当前最多可卖 ${context.sellAvailable.toFixed(6)}${reservedCopy}` };
    }
    if (context.reduceOnly && context.held <= 0) return { ok: false, level: 'danger', message: '当前交易对没有可减持仓' };
    if (context.orderType === 'market' && context.total > Math.max(25000, context.equity * 0.35)) {
      return { ok: true, level: 'warning', message: '大额市价单可能产生明显冲击成本', confirm: true };
    }
    if (context.total >= Math.max(10000, context.equity * 0.1)) {
      return { ok: true, level: 'warning', message: '订单占账户权益比例较高，请确认后提交', confirm: true };
    }
    return { ok: true, level: 'normal', message: executionSummary(context), confirm: false };
  }

  function executionSummary(context) {
    if (!(context.total > 0)) return '等待输入订单数量';
    if (context.side === 'sell') {
      const parts = [`可卖 ${context.sellAvailable.toFixed(6)}`];
      if (context.coreReservedSell > 0) parts.push(`核心冻结 ${context.coreReservedSell.toFixed(6)}`);
      if (context.trailingReservedSell > 0) parts.push(`策略预留 ${context.trailingReservedSell.toFixed(6)}`);
      return parts.join(' · ');
    }
    if (context.postOnly) return `Post Only · 不主动吃单 · 最优卖价 ${formatPrice(context.bestAsk)}`;
    if (context.reduceOnly) return `只减仓 · 当前持仓 ${context.held.toFixed(6)}`;
    return `${context.orderType === 'market' ? '市价撮合' : context.orderType === 'limit' ? '限价挂单' : '条件触发'} · 最小成交额 ${MIN_NOTIONAL.toFixed(2)} USDT`;
  }

  function formatPrice(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function createExecutionStatus() {
    if ($('#executionStatus')) return;
    const note = $('.risk-note');
    if (!note) return;
    const status = document.createElement('div');
    status.id = 'executionStatus';
    status.className = 'execution-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.innerHTML = '<div><strong>订单执行检查</strong><span id="executionStatusCopy">等待输入订单数量</span></div><b id="executionStatusFlag">正常</b>';
    note.before(status);
  }

  function updateExecutionStatus() {
    const status = $('#executionStatus');
    if (!status) return;
    const context = buildContext();
    const result = context.total > 0 || context.quantity > 0 ? validate({ ...context }) : { ok: true, level: 'normal', message: executionSummary(context) };
    status.className = `execution-status${result.level && result.level !== 'normal' ? ` ${result.level}` : ''}`;
    $('#executionStatusCopy').textContent = result.message;
    $('#executionStatusFlag').textContent = result.ok ? (result.confirm ? '需确认' : '正常') : '已阻止';
  }

  function createConfirmationDialog() {
    if ($('#orderConfirmDialog')) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'orderConfirmBackdrop';
    backdrop.className = 'order-confirm-backdrop';
    backdrop.hidden = true;
    const dialog = document.createElement('section');
    dialog.id = 'orderConfirmDialog';
    dialog.className = 'order-confirm-dialog';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'orderConfirmTitle');
    dialog.innerHTML = `
      <header><div><strong id="orderConfirmTitle">确认模拟订单</strong><small id="confirmPair">--</small></div><button type="button" data-cancel-order-confirm aria-label="关闭">×</button></header>
      <div class="order-confirm-grid">
        <div><span>方向 / 类型</span><b id="confirmSideType">--</b></div>
        <div><span>委托价格</span><b id="confirmPrice">--</b></div>
        <div><span>数量</span><b id="confirmQuantity">--</b></div>
        <div><span>总额</span><b id="confirmTotal">--</b></div>
        <div><span>预计手续费</span><b id="confirmFee">--</b></div>
        <div><span>权益占用</span><b id="confirmExposure">--</b></div>
      </div>
      <p class="order-confirm-warning" id="confirmWarning">请核对订单参数。此操作仅影响本地模拟账户。</p>
      <div class="order-confirm-actions"><button type="button" data-cancel-order-confirm>返回修改</button><button type="button" id="confirmOrderSubmit">确认提交</button></div>`;
    document.body.append(backdrop, dialog);
  }

  function openConfirmation(context, validation) {
    pendingContext = context;
    const sideText = context.side === 'buy' ? '买入' : '卖出';
    const typeText = context.orderType === 'market' ? '市价' : context.orderType === 'limit' ? '限价' : '止盈止损';
    $('#confirmPair').textContent = context.pair;
    $('#confirmSideType').textContent = `${sideText} · ${typeText}`;
    $('#confirmPrice').textContent = context.orderType === 'market' ? `市场价 ≈ ${formatPrice(context.price)}` : `${formatPrice(context.price)} USDT`;
    $('#confirmQuantity').textContent = context.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 });
    $('#confirmTotal').textContent = `${context.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
    $('#confirmFee').textContent = `${(context.total * 0.0008).toFixed(2)} USDT`;
    $('#confirmExposure').textContent = `${Math.min(999, context.total / Math.max(context.equity, 1) * 100).toFixed(2)}%`;
    $('#confirmWarning').textContent = validation.message;
    const confirm = $('#confirmOrderSubmit');
    confirm.textContent = `确认${sideText}`;
    confirm.className = context.side === 'buy' ? 'confirm-buy' : 'confirm-sell';
    $('#orderConfirmBackdrop').hidden = false;
    $('#orderConfirmDialog').hidden = false;
    confirm.focus();
  }

  function closeConfirmation() {
    const backdrop = $('#orderConfirmBackdrop');
    const dialog = $('#orderConfirmDialog');
    if (backdrop) backdrop.hidden = true;
    if (dialog) dialog.hidden = true;
  }

  function allowOriginalSubmit() {
    const context = pendingContext || buildContext();
    rememberSubmission(context);
    bypassOnce = true;
    pendingContext = null;
    closeConfirmation();
    $('#submitOrder')?.click();
    setTimeout(updateExecutionStatus, 80);
  }

  function interceptSubmit(event) {
    const submit = event.target.closest?.('#submitOrder');
    if (!submit) return;
    if (bypassOnce) {
      bypassOnce = false;
      return;
    }
    const context = buildContext();
    const validation = validate(context);
    if (!validation.ok) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showToast(validation.message);
      updateExecutionStatus();
      return;
    }
    if (validation.confirm) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openConfirmation(context, validation);
      return;
    }
    rememberSubmission(context);
  }

  function bind() {
    document.addEventListener('click', interceptSubmit, true);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-cancel-order-confirm]') || event.target === $('#orderConfirmBackdrop')) {
        pendingContext = null;
        closeConfirmation();
      }
    });
    $('#confirmOrderSubmit')?.addEventListener('click', allowOriginalSubmit);
    ['#orderQuantity', '#orderTotal', '#orderPrice', '#triggerPrice', '#postOnly', '#reduceOnly']
      .forEach(selector => {
        const element = $(selector);
        if (!element) return;
        element.addEventListener('input', updateExecutionStatus);
        element.addEventListener('change', updateExecutionStatus);
      });
    document.addEventListener('click', event => {
      if (event.target.closest('[data-side], [data-order-type], [data-book-price], [data-cancel-order], [data-close-position]')) {
        requestAnimationFrame(updateExecutionStatus);
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('#orderConfirmDialog')?.hidden) {
        pendingContext = null;
        closeConfirmation();
      }
    });
    const available = $('#ticketAvailable');
    if (available) new MutationObserver(updateExecutionStatus).observe(available, { childList: true, characterData: true, subtree: true });
    window.addEventListener('storage', event => {
      if ([STORAGE_KEY, EXIT_STORAGE_KEY].includes(event.key)) updateExecutionStatus();
    });
    window.addEventListener('atlas:exit-strategies-updated', updateExecutionStatus);
  }

  function init() {
    createExecutionStatus();
    createConfirmationDialog();
    bind();
    updateExecutionStatus();
    document.documentElement.dataset.executionGuard = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
