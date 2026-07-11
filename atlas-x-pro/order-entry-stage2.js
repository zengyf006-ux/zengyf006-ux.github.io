(() => {
  'use strict';
  if (window.__ATLAS_ORDER_ENTRY_STAGE2__) return;
  window.__ATLAS_ORDER_ENTRY_STAGE2__ = true;

  const PREF_KEY = 'atlasX.pro.mobileStage2.v1';
  const CORE_KEY = 'atlasX.pro.v1';
  const FEE_RATE = 0.0008;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const numberFrom = value => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  let selectedType = 'market';
  let unitMode = 'quantity';
  let systemSubmitting = false;
  let processingTriggers = false;
  let lastEstimate = null;
  let estimateFrame = 0;

  function readPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
  }
  function writePrefs(patch) {
    const next = { ...readPrefs(), ...patch };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch {}
    return next;
  }
  function readCore() {
    try { return JSON.parse(localStorage.getItem(CORE_KEY) || '{}'); } catch { return {}; }
  }
  function writeCore(core) {
    try { localStorage.setItem(CORE_KEY, JSON.stringify(core)); } catch {}
  }
  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2300);
  }
  function side() {
    return window.AtlasCoreTrading?.getSide?.() || (readCore().side === 'sell' ? 'sell' : 'buy');
  }
  function activeSymbol() {
    return String(readCore().activeSymbol || window.AtlasMarketDataEngine?.getState?.().symbol || 'BTCUSDT').toUpperCase();
  }
  function marketPrice() {
    return numberFrom(window.AtlasMarketDataEngine?.getState?.().ticker?.price || $('#lastPrice')?.textContent);
  }
  function baseAsset() {
    return ($('#activePair')?.textContent || 'BTC/USDT').split('/')[0];
  }
  function quantityDigits() {
    return marketPrice() >= 1000 ? 6 : marketPrice() >= 1 ? 4 : 2;
  }
  function format(value, digits = 2) {
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function normalizeLevels(levels) {
    return (levels || []).map(level => {
      const price = Array.isArray(level) ? Number(level[0]) : Number(level?.price);
      const quantity = Array.isArray(level) ? Number(level[1]) : Number(level?.quantity ?? level?.qty ?? level?.size);
      return { price, quantity };
    }).filter(level => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.quantity) && level.quantity > 0);
  }

  function walkDepth(requestedQuantity, orderSide = side(), book = window.AtlasMarketDataEngine?.getState?.().book || {}) {
    const requested = Math.max(0, Number(requestedQuantity) || 0);
    const levels = normalizeLevels(orderSide === 'buy' ? book.asks : book.bids)
      .sort((a, b) => orderSide === 'buy' ? a.price - b.price : b.price - a.price);
    const referencePrice = levels[0]?.price || marketPrice() || null;
    let remaining = requested;
    let filledQuantity = 0;
    let notional = 0;
    for (const level of levels) {
      if (remaining <= 1e-12) break;
      const fill = Math.min(remaining, level.quantity);
      filledQuantity += fill;
      notional += fill * level.price;
      remaining -= fill;
    }
    const vwap = filledQuantity > 0 ? notional / filledQuantity : null;
    const slippageBps = vwap && referencePrice
      ? (orderSide === 'buy' ? (vwap - referencePrice) : (referencePrice - vwap)) / referencePrice * 10000
      : null;
    const slippageCost = vwap && referencePrice
      ? Math.max(0, orderSide === 'buy' ? (vwap - referencePrice) * filledQuantity : (referencePrice - vwap) * filledQuantity)
      : null;
    return {
      requestedQuantity: requested,
      filledQuantity,
      unfilledQuantity: Math.max(0, requested - filledQuantity),
      notional,
      vwap,
      referencePrice,
      slippageBps,
      slippageCost,
      fee: notional * FEE_RATE,
      coverage: requested > 0 ? filledQuantity / requested : 0,
      levelCount: levels.length,
    };
  }

  function mount() {
    const legacyTabs = $('.order-type-tabs');
    const ticket = $('#orderTicket');
    const submit = $('#submitOrder');
    if (!legacyTabs || !ticket || !submit || $('.stage2-entry-controls')) return;

    const controls = document.createElement('section');
    controls.className = 'stage2-entry-controls';
    controls.innerHTML = `
      <div class="stage2-order-types" role="group" aria-label="订单类型">
        <button type="button" data-stage2-order-type="market">市价</button>
        <button type="button" data-stage2-order-type="limit">限价</button>
        <button type="button" data-stage2-order-type="stop_market">止损市价</button>
        <button type="button" data-stage2-order-type="stop_limit">止损限价</button>
      </div>
      <div class="stage2-unit-switch" role="group" aria-label="下单输入方式">
        <button type="button" data-entry-unit="quantity">按数量</button>
        <button type="button" data-entry-unit="total">按金额</button>
      </div>`;
    legacyTabs.after(controls);

    const estimate = document.createElement('section');
    estimate.className = 'stage2-estimate-panel';
    estimate.innerHTML = `
      <div><span>预计成交均价</span><b data-stage2-estimate="vwap">--</b></div>
      <div><span>预计手续费</span><b data-stage2-estimate="fee">--</b></div>
      <div><span>预计滑点</span><b data-stage2-estimate="slippage">--</b></div>
      <div class="coverage"><span>盘口覆盖率</span><b data-stage2-estimate="coverage">--</b></div>
      <div class="wide condition"><span>订单生效条件</span><small data-stage2-estimate="condition">--</small></div>`;
    submit.before(estimate);

    const prefs = readPrefs();
    selectedType = ['market', 'limit', 'stop_market', 'stop_limit'].includes(prefs.orderType) ? prefs.orderType : 'market';
    unitMode = ['quantity', 'total'].includes(prefs.unitMode) ? prefs.unitMode : 'quantity';
    applyUi();
  }

  function applyUi() {
    const ticket = $('#orderTicket');
    if (!ticket) return;
    ticket.dataset.stage2Type = selectedType;
    ticket.dataset.stage2Unit = unitMode;
    $$('[data-stage2-order-type]').forEach(button => {
      const active = button.dataset.stage2OrderType === selectedType;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $$('[data-entry-unit]').forEach(button => {
      const active = button.dataset.entryUnit === unitMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    window.AtlasCoreTrading?.setOrderType?.(selectedType);
    scheduleEstimate();
  }

  function setOrderType(type) {
    selectedType = ['market', 'limit', 'stop_market', 'stop_limit'].includes(type) ? type : 'market';
    writePrefs({ orderType: selectedType });
    applyUi();
    return selectedType;
  }

  function setUnitMode(mode) {
    unitMode = mode === 'total' ? 'total' : 'quantity';
    writePrefs({ unitMode });
    applyUi();
    return unitMode;
  }

  function requestedQuantity() {
    const quantity = numberFrom($('#orderQuantity')?.value);
    if (quantity > 0) return quantity;
    const total = numberFrom($('#orderTotal')?.value);
    const price = marketPrice();
    return total > 0 && price > 0 ? total / price : 0;
  }

  function estimate() {
    const qty = requestedQuantity();
    const currentSide = side();
    const price = numberFrom($('#orderPrice')?.value) || marketPrice();
    let result;
    if (selectedType === 'market' || selectedType === 'stop_market') {
      result = walkDepth(qty, currentSide);
    } else {
      const notional = qty * price;
      result = {
        requestedQuantity: qty,
        filledQuantity: 0,
        unfilledQuantity: qty,
        notional,
        vwap: price || null,
        referencePrice: price || null,
        slippageBps: null,
        slippageCost: null,
        fee: notional * FEE_RATE,
        coverage: null,
        levelCount: 0,
      };
    }
    result.type = selectedType;
    result.side = currentSide;
    return result;
  }

  function renderEstimate() {
    const panel = $('.stage2-estimate-panel');
    if (!panel) return;
    const value = estimate();
    lastEstimate = value;
    const set = (key, text) => {
      const element = $(`[data-stage2-estimate="${key}"]`, panel);
      if (element) element.textContent = text;
    };
    set('vwap', value.vwap ? `${format(value.vwap, Math.max(2, String(value.vwap).split('.')[1]?.length || 2))} USDT` : '--');
    set('fee', value.requestedQuantity > 0 ? `${format(value.fee, 4)} USDT` : '--');
    set('slippage', value.slippageBps == null ? '--' : `${format(value.slippageBps, 2)} bps`);
    set('coverage', value.coverage == null ? '等待成交' : `${format(value.coverage * 100, 1)}%`);
    const condition = ({
      market: value.coverage < 1 && value.requestedQuantity > 0 ? `当前盘口仅覆盖 ${format(value.coverage * 100, 1)}%，未覆盖部分不会被描述为已成交。` : '按当前盘口模拟市价执行。',
      limit: '价格达到限价条件后执行；不估算真实撮合队列。',
      stop_market: '触发价达到后按市场价执行；当前深度仅供触发时参考。',
      stop_limit: '先达到触发价，再按限价条件等待执行。',
    })[selectedType];
    set('condition', condition);
    const level = value.coverage == null || !value.requestedQuantity ? '' : value.coverage < .75 ? 'critical' : value.coverage < 1 ? 'warning' : '';
    panel.dataset.level = level;
    panel.dataset.coverage = value.coverage == null ? '' : String(value.coverage);
    panel.dataset.orderType = selectedType;
  }

  function scheduleEstimate() {
    cancelAnimationFrame(estimateFrame);
    estimateFrame = requestAnimationFrame(() => {
      estimateFrame = 0;
      renderEstimate();
    });
  }

  function newestOrder(core, predicate) {
    return (Array.isArray(core.orders) ? core.orders : [])
      .filter(predicate)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
  }

  function annotateStopMarket() {
    queueMicrotask(() => {
      const core = readCore();
      const order = newestOrder(core, item => item.type === 'stop' && !item.stage2Type);
      if (!order) return;
      order.type = 'stop_market';
      order.stage2Type = 'stop_market';
      writeCore(core);
    });
  }

  function submitStopLimit(event) {
    const bridge = window.AtlasCoreTrading;
    if (!bridge) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const trigger = numberFrom($('#triggerPrice')?.value);
    const limit = numberFrom($('#orderPrice')?.value);
    const quantity = numberFrom($('#orderQuantity')?.value);
    const total = numberFrom($('#orderTotal')?.value);
    const currentSide = side();
    if (!(trigger > 0) || !(limit > 0) || !(quantity > 0) || !(total > 0)) {
      showToast('止损限价需要有效的触发价、限价和数量');
      return;
    }

    const before = new Set((readCore().orders || []).map(order => order.id));
    const sentinel = currentSide === 'buy' ? 9e15 : 1e-15;
    bridge.setSide(currentSide);
    bridge.setOrderType('stop_market');
    bridge.setField('#orderPrice', limit);
    bridge.setField('#triggerPrice', sentinel);
    bridge.setField('#orderQuantity', quantity);
    bridge.setField('#orderTotal', total);
    systemSubmitting = true;
    bridge.submitOrder();
    systemSubmitting = false;

    queueMicrotask(() => {
      const core = readCore();
      const created = newestOrder(core, order => !before.has(order.id) && (order.type === 'stop' || order.type === 'stop_market'));
      if (!created) {
        showToast('止损限价创建失败，请检查订单字段');
        return;
      }
      created.stage2Type = 'stop_limit';
      created.stage2TriggerPrice = trigger;
      created.stage2LimitPrice = limit;
      created.status = 'waiting_trigger';
      created.originalTriggerPrice = trigger;
      writeCore(core);
      showToast('模拟止损限价单已提交');
      window.dispatchEvent(new CustomEvent('atlas:stage2-stop-limit-created', { detail: { orderId: created.id } }));
    });
  }

  async function activateStopLimit(order, price) {
    const cancel = $(`[data-cancel-order="${CSS.escape(String(order.id))}"]`);
    if (!cancel) return false;
    const bridge = window.AtlasCoreTrading;
    const snapshot = {
      type: selectedType,
      side: side(),
      quantity: $('#orderQuantity')?.value || '',
      total: $('#orderTotal')?.value || '',
      price: $('#orderPrice')?.value || '',
      trigger: $('#triggerPrice')?.value || '',
      sheetOpen: document.body.classList.contains('order-sheet-open'),
    };

    cancel.click();
    await new Promise(resolve => queueMicrotask(resolve));
    const before = new Set((readCore().orders || []).map(item => item.id));
    bridge.setSide(order.side);
    bridge.setOrderType('limit');
    bridge.setField('#orderPrice', order.stage2LimitPrice || order.price);
    bridge.setField('#orderQuantity', order.qty);
    bridge.setField('#orderTotal', Number(order.qty) * Number(order.stage2LimitPrice || order.price));
    systemSubmitting = true;
    bridge.submitOrder();
    systemSubmitting = false;

    await new Promise(resolve => queueMicrotask(resolve));
    const core = readCore();
    const child = newestOrder(core, item => !before.has(item.id) && item.type === 'limit');
    if (child) {
      child.stage2Type = 'stop_limit_child';
      child.parentStopLimitId = order.id;
      child.triggeredAt = Date.now();
      child.triggerPrice = order.stage2TriggerPrice;
      child.status = 'triggered';
      writeCore(core);
    }

    selectedType = snapshot.type;
    bridge.setSide(snapshot.side);
    bridge.setOrderType(snapshot.type);
    bridge.setField('#orderQuantity', snapshot.quantity);
    bridge.setField('#orderTotal', snapshot.total);
    bridge.setField('#orderPrice', snapshot.price);
    bridge.setField('#triggerPrice', snapshot.trigger);
    if (snapshot.sheetOpen) {
      document.body.classList.add('order-sheet-open');
      const backdrop = $('#sheetBackdrop');
      if (backdrop) backdrop.hidden = false;
    }
    applyUi();
    showToast(`止损限价已触发，限价单等待执行（${format(price, 2)}）`);
    return Boolean(child);
  }

  async function processStopLimits() {
    if (processingTriggers) return;
    processingTriggers = true;
    try {
      const core = readCore();
      const price = marketPrice();
      if (!(price > 0)) return;
      const pending = (core.orders || []).filter(order => order.stage2Type === 'stop_limit' && order.status === 'waiting_trigger');
      for (const order of pending) {
        const trigger = Number(order.stage2TriggerPrice);
        const reached = order.side === 'buy' ? price >= trigger : price <= trigger;
        if (reached) await activateStopLimit(order, price);
      }
    } finally {
      processingTriggers = false;
    }
  }

  function sellAvailableQuantity() {
    const core = readCore();
    const symbol = activeSymbol();
    return (core.positions || []).filter(position => position.symbol === symbol)
      .reduce((sum, position) => sum + Number(position.qty || 0), 0);
  }

  function bind() {
    document.addEventListener('click', event => {
      const type = event.target.closest('[data-stage2-order-type]')?.dataset.stage2OrderType;
      if (type) {
        event.preventDefault();
        setOrderType(type);
        return;
      }
      const unit = event.target.closest('[data-entry-unit]')?.dataset.entryUnit;
      if (unit) {
        event.preventDefault();
        setUnitMode(unit);
        return;
      }
      const percent = event.target.closest('[data-percent]')?.dataset.percent;
      if (percent !== undefined && side() === 'sell') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const ratio = clamp(Number(percent) || 0, 0, 100) / 100;
        const quantity = sellAvailableQuantity() * ratio;
        window.AtlasCoreTrading?.setField?.('#orderQuantity', quantity ? quantity.toFixed(quantityDigits()) : '');
        window.AtlasCoreTrading?.syncOrderFields?.('quantity');
        const slider = $('#orderPercent');
        if (slider) slider.value = String(Number(percent) || 0);
        scheduleEstimate();
        return;
      }
      const bookPrice = event.target.closest('[data-book-price]')?.dataset.bookPrice;
      if (bookPrice && innerWidth <= 820) {
        queueMicrotask(() => {
          setOrderType('limit');
          window.AtlasCoreTrading?.setField?.('#orderPrice', bookPrice);
          const bookSide = event.target.closest('[data-book-side]')?.dataset.bookSide;
          const targetSide = bookSide === 'ask' ? 'buy' : bookSide === 'bid' ? 'sell' : side();
          window.AtlasCoreTrading?.setSide?.(targetSide);
          document.body.classList.add('order-sheet-open');
          const backdrop = $('#sheetBackdrop');
          if (backdrop) backdrop.hidden = false;
          scheduleEstimate();
        });
      }
    }, true);

    $('#submitOrder')?.addEventListener('click', event => {
      if (systemSubmitting) return;
      if (selectedType === 'stop_limit') {
        submitStopLimit(event);
        return;
      }
      window.AtlasCoreTrading?.setOrderType?.(selectedType);
      if (selectedType === 'stop_market') annotateStopMarket();
    }, true);

    ['#orderQuantity', '#orderTotal', '#orderPrice', '#triggerPrice'].forEach(selector => {
      $(selector)?.addEventListener('input', scheduleEstimate);
    });
    document.addEventListener('click', event => {
      if (event.target.closest('[data-side]') || event.target.closest('[data-mobile-side]')) scheduleEstimate();
    });
    window.AtlasMarketDataEngine?.subscribe?.(() => {
      scheduleEstimate();
      processStopLimits();
    });
    window.addEventListener('atlas:order-book-stage2-render', scheduleEstimate);
  }

  window.AtlasOrderEntryStage2 = Object.freeze({
    getEstimate: () => structuredClone(lastEstimate || estimate()),
    walkDepth: (quantity, orderSide, book) => structuredClone(walkDepth(quantity, orderSide, book)),
    setUnitMode,
    setOrderType,
    processStopLimits,
  });

  function init() {
    mount();
    bind();
    applyUi();
    document.documentElement.dataset.orderEntryStage2 = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
