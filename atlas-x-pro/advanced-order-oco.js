(() => {
  'use strict';
  if (window.__ATLAS_ADVANCED_OCO__) return;
  window.__ATLAS_ADVANCED_OCO__ = true;

  const CORE_KEY = 'atlasX.pro.v1';
  const STORE_KEY = 'atlasX.pro.advancedOrders.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const TERMINAL_STATUSES = new Set(['completed_take_profit', 'completed_stop', 'expired', 'canceled', 'error']);
  let evaluating = false;
  let refreshTimer = 0;

  function numberFrom(value) {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function readCore() {
    return readJson(CORE_KEY, {});
  }

  function readStore() {
    const stored = readJson(STORE_KEY, { version: 1, orders: [] });
    return {
      version: 1,
      orders: Array.isArray(stored.orders) ? stored.orders : [],
    };
  }

  function writeStore(store) {
    store.version = 1;
    store.orders = (Array.isArray(store.orders) ? store.orders : [])
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 30);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
  }

  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function activePair() {
    return ($('#activePair')?.textContent || 'BTC/USDT').trim();
  }

  function activeSymbol() {
    return activePair().replace('/', '');
  }

  function activeBase() {
    return activePair().split('/')[0] || '资产';
  }

  function currentPrice() {
    return numberFrom($('#lastPrice')?.textContent);
  }

  function formatPrice(value) {
    const priceText = String($('#lastPrice')?.textContent || '').replace(/,/g, '');
    const decimals = priceText.includes('.') ? priceText.split('.')[1].replace(/[^0-9]/g, '').length : 2;
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: Math.min(8, Math.max(2, decimals)),
      maximumFractionDigits: Math.min(8, Math.max(2, decimals)),
    });
  }

  function formatQuantity(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  function heldQuantity(symbol = activeSymbol()) {
    const state = readCore();
    return (Array.isArray(state.positions) ? state.positions : [])
      .filter(position => position.symbol === symbol)
      .reduce((sum, position) => sum + numberFrom(position.qty), 0);
  }

  function reservedSellQuantity(symbol = activeSymbol()) {
    const state = readCore();
    return (Array.isArray(state.orders) ? state.orders : [])
      .filter(order => order.symbol === symbol && order.side === 'sell')
      .reduce((sum, order) => sum + Math.max(0, numberFrom(order.qty) - numberFrom(order.filled)), 0);
  }

  function availableQuantity(symbol = activeSymbol()) {
    return Math.max(0, heldQuantity(symbol) - reservedSellQuantity(symbol));
  }

  function expiryFor(tif, createdAt = Date.now()) {
    if (tif === '15m') return createdAt + 15 * 60 * 1000;
    if (tif === '1h') return createdAt + 60 * 60 * 1000;
    if (tif === 'day') {
      const date = new Date(createdAt);
      date.setHours(23, 59, 59, 999);
      return date.getTime();
    }
    return 0;
  }

  function statusLabel(status) {
    return ({
      creating: '创建中',
      active: '监控中',
      triggering_stop: '止损执行中',
      completed_take_profit: '止盈完成',
      completed_stop: '止损完成',
      expired: '已过期',
      canceled: '已取消',
      error: '执行异常',
    })[status] || status;
  }

  function tifLabel(tif) {
    return ({ gtc: '长期有效', '15m': '15 分钟', '1h': '1 小时', day: '当日有效' })[tif] || '长期有效';
  }

  function showStatus(message, level = 'normal') {
    const element = $('#advancedOcoStatus');
    if (!element) return;
    element.textContent = message;
    element.className = `advanced-oco-status ${level}`;
  }

  function markup() {
    return `<section class="advanced-oco-panel">
      <button class="advanced-oco-toggle" type="button" aria-expanded="false">
        <span><b>高级委托</b><small>OCO · 止盈与止损互斥执行</small></span>
        <strong id="advancedOcoCompact">OCO</strong><i aria-hidden="true"></i>
      </button>
      <div class="advanced-oco-body" hidden>
        <header class="advanced-oco-heading"><div><b>OCO 保护单</b><small>只冻结一次持仓；任一腿完成后另一腿自动失效。</small></div><span id="ocoAvailableBadge">可用 --</span></header>
        <div class="advanced-oco-inputs">
          <label><span>数量</span><input id="ocoQuantity" inputmode="decimal" autocomplete="off" placeholder="0.000000"><b id="ocoQuantityUnit">BTC</b></label>
          <label><span>止盈价</span><input id="ocoTakeProfit" inputmode="decimal" autocomplete="off" placeholder="高于当前价"><b>USDT</b></label>
          <label><span>止损触发</span><input id="ocoStopTrigger" inputmode="decimal" autocomplete="off" placeholder="低于当前价"><b>USDT</b></label>
          <label><span>有效期</span><select id="ocoTif"><option value="gtc">长期有效</option><option value="15m">15 分钟</option><option value="1h">1 小时</option><option value="day">当日有效</option></select><b>TIF</b></label>
        </div>
        <div class="advanced-oco-summary">
          <div><span>当前价格</span><b id="ocoCurrentPrice">--</b></div>
          <div><span>止盈名义金额</span><b id="ocoTakeProfitNotional">--</b></div>
          <div><span>止损距离</span><b id="ocoStopDistance">--</b></div>
          <div><span>冻结数量</span><b id="ocoReservedQuantity">--</b></div>
        </div>
        <p id="advancedOcoStatus" class="advanced-oco-status normal">输入数量、止盈价和止损触发价。</p>
        <button id="createOcoOrder" class="advanced-oco-create" type="button">创建 OCO 保护单</button>
        <div class="advanced-oco-list" id="advancedOcoList"></div>
        <small class="advanced-oco-disclaimer">止损腿为本地条件监控，触发后先撤止盈委托，再通过原模拟撮合执行市价减仓。</small>
      </div>
    </section>`;
  }

  function mount() {
    if ($('.advanced-oco-panel')) return true;
    const anchor = $('.risk-sizing-panel') || $('.advanced-options');
    if (!anchor) return false;
    anchor.insertAdjacentHTML('afterend', markup());
    bindPanel();
    syncForm();
    renderList();
    return true;
  }

  function renderList() {
    const list = $('#advancedOcoList');
    if (!list) return;
    const symbol = activeSymbol();
    const orders = readStore().orders.filter(order => order.symbol === symbol).slice(0, 5);
    if (!orders.length) {
      list.innerHTML = '<div class="advanced-oco-empty">当前交易对暂无 OCO 记录</div>';
      return;
    }
    list.innerHTML = orders.map(order => {
      const terminal = TERMINAL_STATUSES.has(order.status);
      const expiry = order.expiresAt ? new Date(order.expiresAt).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }) : tifLabel(order.tif);
      return `<article class="advanced-oco-row ${terminal ? 'terminal' : 'active'}" data-oco-id="${order.id}">
        <div><b>${statusLabel(order.status)}</b><small>${formatQuantity(order.quantity)} ${activeBase()} · ${expiry}</small></div>
        <span><small>止盈</small><b>${formatPrice(order.takeProfit)}</b></span>
        <span><small>止损</small><b>${formatPrice(order.stopTrigger)}</b></span>
        ${order.status === 'active' ? `<button type="button" data-cancel-oco="${order.id}">取消</button>` : '<i></i>'}
      </article>`;
    }).join('');
  }

  function syncForm() {
    if (!mount()) return;
    const current = currentPrice();
    const available = availableQuantity();
    const quantity = numberFrom($('#ocoQuantity')?.value);
    const takeProfit = numberFrom($('#ocoTakeProfit')?.value);
    const stop = numberFrom($('#ocoStopTrigger')?.value);
    $('#ocoQuantityUnit').textContent = activeBase();
    $('#ocoAvailableBadge').textContent = `可用 ${formatQuantity(available)} ${activeBase()}`;
    $('#ocoCurrentPrice').textContent = current > 0 ? `${formatPrice(current)} USDT` : '--';
    $('#ocoTakeProfitNotional').textContent = quantity > 0 && takeProfit > 0 ? `${(quantity * takeProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT` : '--';
    $('#ocoStopDistance').textContent = current > 0 && stop > 0 ? `${Math.abs((stop / current - 1) * 100).toFixed(2)}%` : '--';
    $('#ocoReservedQuantity').textContent = quantity > 0 ? `${formatQuantity(quantity)} ${activeBase()}` : '--';
    $('#advancedOcoCompact').textContent = `${readStore().orders.filter(order => order.symbol === activeSymbol() && order.status === 'active').length} 活动`;
  }

  function validateDraft() {
    const symbol = activeSymbol();
    const price = currentPrice();
    const quantity = numberFrom($('#ocoQuantity')?.value);
    const takeProfit = numberFrom($('#ocoTakeProfit')?.value);
    const stopTrigger = numberFrom($('#ocoStopTrigger')?.value);
    const tif = $('#ocoTif')?.value || 'gtc';
    const available = availableQuantity(symbol);
    if (!(heldQuantity(symbol) > 0)) return { ok: false, message: '当前交易对没有可卖现货持仓' };
    if (!(quantity > 0)) return { ok: false, message: '请输入有效的 OCO 数量' };
    if (quantity > available + 1e-10) return { ok: false, message: `当前最多可用 ${formatQuantity(available)} ${activeBase()}` };
    if (!(price > 0)) return { ok: false, message: '当前市场价格无效' };
    if (!(takeProfit > price)) return { ok: false, message: '止盈价必须高于当前价格' };
    if (!(stopTrigger < price) || !(stopTrigger > 0)) return { ok: false, message: '止损触发价必须低于当前价格' };
    if (!(stopTrigger < takeProfit)) return { ok: false, message: '止损触发价必须低于止盈价' };
    if (quantity * takeProfit < 5) return { ok: false, message: 'OCO 止盈腿名义金额不得低于 5 USDT' };
    const duplicate = readStore().orders.some(order => order.symbol === symbol
      && order.status === 'active'
      && Math.abs(numberFrom(order.quantity) - quantity) < 1e-10
      && Math.abs(numberFrom(order.takeProfit) - takeProfit) < 1e-8
      && Math.abs(numberFrom(order.stopTrigger) - stopTrigger) < 1e-8);
    if (duplicate) return { ok: false, message: '检测到相同参数的重复 OCO，已阻止' };
    return { ok: true, symbol, pair: activePair(), quantity, takeProfit, stopTrigger, tif, price };
  }

  function snapshotTicket() {
    return {
      side: $('.side-selector [data-side].active')?.dataset.side || 'buy',
      orderType: $('[data-order-type].active')?.dataset.orderType || 'market',
      orderPrice: $('#orderPrice')?.value || '',
      triggerPrice: $('#triggerPrice')?.value || '',
      quantity: $('#orderQuantity')?.value || '',
      total: $('#orderTotal')?.value || '',
      percent: $('#orderPercent')?.value || '0',
      postOnly: Boolean($('#postOnly')?.checked),
      reduceOnly: Boolean($('#reduceOnly')?.checked),
    };
  }

  function setChecked(element, checked) {
    if (!element || element.checked === checked) return;
    element.checked = checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setInput(selector, value, eventName = 'input') {
    const input = $(selector);
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  function restoreTicket(snapshot) {
    $(`.side-selector [data-side="${snapshot.side}"]`)?.click();
    $(`[data-order-type="${snapshot.orderType}"]`)?.click();
    setInput('#orderPrice', snapshot.orderPrice);
    setInput('#triggerPrice', snapshot.triggerPrice);
    setInput('#orderQuantity', snapshot.quantity);
    setInput('#orderTotal', snapshot.total);
    setInput('#orderPercent', snapshot.percent);
    setChecked($('#postOnly'), snapshot.postOnly);
    setChecked($('#reduceOnly'), snapshot.reduceOnly);
  }

  async function waitFor(predicate, timeout = 5000, interval = 35) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = predicate();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    return null;
  }

  async function clickSubmitWithAuthorizedConfirmation() {
    $('#submitOrder')?.click();
    await new Promise(resolve => setTimeout(resolve, 25));
    const dialog = $('#orderConfirmDialog');
    if (dialog && !dialog.hidden) $('#confirmOrderSubmit')?.click();
  }

  async function createCoreTakeProfit(draft) {
    const before = new Set((readCore().orders || []).map(order => order.id));
    const snapshot = snapshotTicket();
    try {
      $('.side-selector [data-side="sell"]')?.click();
      $('[data-order-type="limit"]')?.click();
      setChecked($('#postOnly'), false);
      setChecked($('#reduceOnly'), true);
      setInput('#orderPrice', String(draft.takeProfit));
      setInput('#orderQuantity', String(draft.quantity));
      await clickSubmitWithAuthorizedConfirmation();
      const created = await waitFor(() => (readCore().orders || []).find(order => !before.has(order.id)), 6000);
      return created || null;
    } finally {
      setTimeout(() => restoreTicket(snapshot), 0);
    }
  }

  function matchingTakeProfitHistory(order, core = readCore()) {
    return (Array.isArray(core.history) ? core.history : []).find(history => history.symbol === order.symbol
      && history.side === 'sell'
      && numberFrom(history.createdAt) >= numberFrom(order.createdAt) - 1000
      && Math.abs(numberFrom(history.qty) - numberFrom(order.quantity)) < 1e-8
      && Math.abs(numberFrom(history.price) - numberFrom(order.takeProfit)) <= Math.max(0.02, numberFrom(order.takeProfit) * 0.001));
  }

  async function cancelCoreOrder(orderId) {
    if (!(readCore().orders || []).some(order => order.id === orderId)) return true;
    const button = $(`[data-cancel-order="${CSS.escape(orderId)}"]`);
    if (!button) return false;
    button.click();
    return Boolean(await waitFor(() => !(readCore().orders || []).some(order => order.id === orderId), 4500));
  }

  async function executeCoreMarketSell(order) {
    const beforeHistory = new Set((readCore().history || []).map(history => history.id));
    const snapshot = snapshotTicket();
    try {
      $('.side-selector [data-side="sell"]')?.click();
      $('[data-order-type="market"]')?.click();
      setChecked($('#postOnly'), false);
      setChecked($('#reduceOnly'), true);
      setInput('#orderQuantity', String(order.quantity));
      await clickSubmitWithAuthorizedConfirmation();
      return Boolean(await waitFor(() => (readCore().history || []).find(history => !beforeHistory.has(history.id)
        && history.symbol === order.symbol
        && history.side === 'sell'
        && Math.abs(numberFrom(history.qty) - numberFrom(order.quantity)) < 1e-8), 6500));
    } finally {
      setTimeout(() => restoreTicket(snapshot), 0);
    }
  }

  async function createOco() {
    const button = $('#createOcoOrder');
    if (button?.disabled) return;
    const draft = validateDraft();
    if (!draft.ok) {
      showStatus(draft.message, 'danger');
      return;
    }
    button.disabled = true;
    showStatus('正在通过原交易引擎创建止盈腿…', 'warning');
    const createdAt = Date.now();
    const pending = {
      id: uid('oco'),
      kind: 'oco',
      symbol: draft.symbol,
      pair: draft.pair,
      quantity: draft.quantity,
      takeProfit: draft.takeProfit,
      stopTrigger: draft.stopTrigger,
      tif: draft.tif,
      expiresAt: expiryFor(draft.tif, createdAt),
      status: 'creating',
      createdAt,
      tpOrderId: '',
      error: '',
    };
    const store = readStore();
    store.orders.unshift(pending);
    writeStore(store);
    renderList();

    const coreOrder = await createCoreTakeProfit(draft);
    const latest = readStore();
    const record = latest.orders.find(order => order.id === pending.id);
    if (!record) return;
    if (!coreOrder) {
      record.status = 'error';
      record.error = '核心止盈委托创建失败';
      record.completedAt = Date.now();
      writeStore(latest);
      showStatus('核心止盈委托创建失败，请检查订单执行提示', 'danger');
    } else {
      record.tpOrderId = coreOrder.id;
      record.status = 'active';
      record.activatedAt = Date.now();
      writeStore(latest);
      showStatus('OCO 已创建：止盈腿已挂单，止损腿开始监控', 'positive');
      setInput('#ocoQuantity', '');
      setInput('#ocoTakeProfit', '');
      setInput('#ocoStopTrigger', '');
    }
    button.disabled = false;
    syncForm();
    renderList();
  }

  async function cancelOco(id, status = 'canceled') {
    const store = readStore();
    const order = store.orders.find(item => item.id === id);
    if (!order || TERMINAL_STATUSES.has(order.status)) return;
    if (order.tpOrderId) await cancelCoreOrder(order.tpOrderId);
    const latest = readStore();
    const record = latest.orders.find(item => item.id === id);
    if (record) {
      record.status = status;
      record.completedAt = Date.now();
      writeStore(latest);
    }
    renderList();
    syncForm();
  }

  async function triggerStop(id) {
    const store = readStore();
    const order = store.orders.find(item => item.id === id);
    if (!order || order.status !== 'active') return;
    order.status = 'triggering_stop';
    order.triggeredAt = Date.now();
    writeStore(store);
    renderList();
    showStatus('止损已触发：正在撤销止盈腿并执行市价减仓', 'warning');

    const canceled = await cancelCoreOrder(order.tpOrderId);
    const executed = canceled && await executeCoreMarketSell(order);
    const latest = readStore();
    const record = latest.orders.find(item => item.id === id);
    if (!record) return;
    record.status = executed ? 'completed_stop' : 'error';
    record.completedAt = Date.now();
    record.error = executed ? '' : canceled ? '止损市价减仓未完成' : '止盈腿撤销失败';
    writeStore(latest);
    showStatus(executed ? 'OCO 止损腿已通过原撮合引擎完成' : record.error, executed ? 'positive' : 'danger');
    renderList();
    syncForm();
  }

  async function evaluateNow() {
    if (evaluating) return;
    evaluating = true;
    try {
      const symbol = activeSymbol();
      const price = currentPrice();
      const ids = readStore().orders
        .filter(order => order.symbol === symbol && order.status === 'active')
        .map(order => order.id);

      for (const id of ids) {
        let store = readStore();
        let order = store.orders.find(item => item.id === id);
        if (!order || order.status !== 'active') continue;
        const core = readCore();
        const coreOrderExists = (core.orders || []).some(item => item.id === order.tpOrderId);
        if (!coreOrderExists) {
          const fill = matchingTakeProfitHistory(order, core);
          order.status = fill ? 'completed_take_profit' : 'canceled';
          order.completedAt = Date.now();
          writeStore(store);
          continue;
        }
        if (order.expiresAt && Date.now() >= Number(order.expiresAt)) {
          await cancelOco(order.id, 'expired');
          continue;
        }
        if (price > 0 && price <= Number(order.stopTrigger)) {
          await triggerStop(order.id);
        }
      }
      renderList();
      syncForm();
    } finally {
      evaluating = false;
    }
  }

  function bindPanel() {
    const toggle = $('.advanced-oco-toggle');
    const body = $('.advanced-oco-body');
    toggle?.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      if (body) body.hidden = expanded;
      if (!expanded) {
        syncForm();
        renderList();
      }
    });
    ['#ocoQuantity', '#ocoTakeProfit', '#ocoStopTrigger'].forEach(selector => {
      $(selector)?.addEventListener('input', syncForm);
    });
    $('#ocoTif')?.addEventListener('change', syncForm);
    $('#createOcoOrder')?.addEventListener('click', createOco);
    $('#advancedOcoList')?.addEventListener('click', event => {
      const id = event.target.closest('[data-cancel-oco]')?.dataset.cancelOco;
      if (id) cancelOco(id);
    });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      syncForm();
      renderList();
      evaluateNow();
    }, 45);
  }

  function observe() {
    const observer = new MutationObserver(scheduleRefresh);
    ['#lastPrice', '#ordersBody', '#historyBody', '#activePair', '#positionsBody'].forEach(selector => {
      const element = $(selector);
      if (element) observer.observe(element, { childList: true, characterData: true, subtree: true });
    });
    window.addEventListener('storage', event => {
      if ([CORE_KEY, STORE_KEY].includes(event.key)) scheduleRefresh();
    });
    setInterval(evaluateNow, 1000);
  }

  function init() {
    if (!mount()) {
      const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    observe();
    setTimeout(evaluateNow, 120);
    window.AtlasAdvancedOco = { evaluateNow, readStore };
    document.documentElement.dataset.advancedOco = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
