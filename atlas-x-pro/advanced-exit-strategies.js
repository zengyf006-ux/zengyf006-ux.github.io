(() => {
  'use strict';
  if (window.__ATLAS_EXIT_STRATEGIES__) return;
  window.__ATLAS_EXIT_STRATEGIES__ = true;

  const CORE_KEY = 'atlasX.pro.v1';
  const STORE_KEY = 'atlasX.pro.exitStrategies.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const TRAILING_RESERVED_STATUSES = new Set(['waiting_activation', 'active']);
  const TERMINAL_STATUSES = new Set(['completed', 'expired', 'canceled', 'error']);
  let activeTab = 'trailing';
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
    const stored = readJson(STORE_KEY, { version: 1, strategies: [] });
    return {
      version: 1,
      strategies: Array.isArray(stored.strategies) ? stored.strategies : [],
    };
  }

  function writeStore(store) {
    store.version = 1;
    store.strategies = (Array.isArray(store.strategies) ? store.strategies : [])
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 40);
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
    const text = String($('#lastPrice')?.textContent || '').replace(/,/g, '');
    const decimals = text.includes('.') ? text.split('.')[1].replace(/[^0-9]/g, '').length : 2;
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: Math.min(8, Math.max(2, decimals)),
      maximumFractionDigits: Math.min(8, Math.max(2, decimals)),
    });
  }

  function formatQuantity(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  function heldQuantity(symbol = activeSymbol()) {
    return (Array.isArray(readCore().positions) ? readCore().positions : [])
      .filter(position => position.symbol === symbol)
      .reduce((sum, position) => sum + numberFrom(position.qty), 0);
  }

  function coreReservedSell(symbol = activeSymbol()) {
    return (Array.isArray(readCore().orders) ? readCore().orders : [])
      .filter(order => order.symbol === symbol && order.side === 'sell')
      .reduce((sum, order) => sum + Math.max(0, numberFrom(order.qty) - numberFrom(order.filled)), 0);
  }

  function trailingReserved(symbol = activeSymbol(), excludingId = '') {
    return readStore().strategies
      .filter(strategy => strategy.kind === 'trailing_stop'
        && strategy.symbol === symbol
        && TRAILING_RESERVED_STATUSES.has(strategy.status)
        && strategy.id !== excludingId)
      .reduce((sum, strategy) => sum + numberFrom(strategy.quantity), 0);
  }

  function availableQuantity(symbol = activeSymbol(), excludingId = '') {
    return Math.max(0, heldQuantity(symbol) - coreReservedSell(symbol) - trailingReserved(symbol, excludingId));
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

  function tifLabel(tif) {
    return ({ gtc: '长期有效', '15m': '15 分钟', '1h': '1 小时', day: '当日有效' })[tif] || '长期有效';
  }

  function statusLabel(strategy) {
    const labels = {
      waiting_activation: '等待激活',
      active: '运行中',
      triggering: '执行中',
      creating: '创建中',
      partially_completed: '部分完成',
      partially_canceled: '部分取消',
      completed: '已完成',
      expired: '已过期',
      canceled: '已取消',
      error: '执行异常',
    };
    return labels[strategy.status] || strategy.status;
  }

  function setInput(selector, value, eventName = 'input') {
    const input = $(selector);
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  function setChecked(element, checked) {
    if (!element || element.checked === checked) return;
    element.checked = checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
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

  async function waitFor(predicate, timeout = 6000, interval = 35) {
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

  async function createCoreLimitSell(price, quantity) {
    const before = new Set((readCore().orders || []).map(order => order.id));
    $('.side-selector [data-side="sell"]')?.click();
    $('[data-order-type="limit"]')?.click();
    setChecked($('#postOnly'), false);
    setChecked($('#reduceOnly'), true);
    setInput('#orderPrice', String(price));
    setInput('#orderQuantity', String(quantity));
    await clickSubmitWithAuthorizedConfirmation();
    return waitFor(() => (readCore().orders || []).find(order => !before.has(order.id)), 6500);
  }

  async function executeCoreMarketSell(strategy) {
    const before = new Set((readCore().history || []).map(history => history.id));
    const snapshot = snapshotTicket();
    try {
      $('.side-selector [data-side="sell"]')?.click();
      $('[data-order-type="market"]')?.click();
      setChecked($('#postOnly'), false);
      setChecked($('#reduceOnly'), true);
      setInput('#orderQuantity', String(strategy.quantity));
      await clickSubmitWithAuthorizedConfirmation();
      return Boolean(await waitFor(() => (readCore().history || []).find(history => !before.has(history.id)
        && history.symbol === strategy.symbol
        && history.side === 'sell'
        && Math.abs(numberFrom(history.qty) - numberFrom(strategy.quantity)) < 1e-8), 7000));
    } finally {
      setTimeout(() => restoreTicket(snapshot), 0);
    }
  }

  async function cancelCoreOrder(orderId) {
    if (!(readCore().orders || []).some(order => order.id === orderId)) return true;
    const button = $(`[data-cancel-order="${CSS.escape(orderId)}"]`);
    if (!button) return false;
    button.click();
    return Boolean(await waitFor(() => !(readCore().orders || []).some(order => order.id === orderId), 5000));
  }

  function matchingFill(strategy, leg, core = readCore()) {
    return (Array.isArray(core.history) ? core.history : []).find(history => history.symbol === strategy.symbol
      && history.side === 'sell'
      && numberFrom(history.createdAt) >= numberFrom(strategy.createdAt) - 1000
      && Math.abs(numberFrom(history.qty) - numberFrom(leg.quantity)) < 1e-8
      && Math.abs(numberFrom(history.price) - numberFrom(leg.price)) <= Math.max(0.02, numberFrom(leg.price) * 0.001));
  }

  function markup() {
    return `<section class="advanced-exit-panel" data-trailing-reserved="0" data-exit-symbol="">
      <button class="advanced-exit-toggle" type="button" aria-expanded="false">
        <span><b>退出策略</b><small>追踪止损 · 三档分批止盈</small></span>
        <strong id="advancedExitCompact">0 活动</strong><i aria-hidden="true"></i>
      </button>
      <div class="advanced-exit-body" hidden>
        <nav class="advanced-exit-tabs" aria-label="退出策略类型">
          <button class="active" type="button" data-exit-tab="trailing">追踪止损</button>
          <button type="button" data-exit-tab="scaled">分批止盈</button>
        </nav>
        <section class="advanced-exit-pane" data-exit-pane="trailing">
          <header><div><b>追踪止损</b><small>价格创新高时自动上移触发线。</small></div><span id="trailingAvailableBadge">可用 --</span></header>
          <div class="advanced-exit-fields">
            <label><span>数量</span><input id="trailingQuantity" inputmode="decimal" placeholder="0.000000"><b id="trailingQuantityUnit">BTC</b></label>
            <label><span>激活价</span><input id="trailingActivation" inputmode="decimal" placeholder="留空立即激活"><b>USDT</b></label>
            <label><span>回撤比例</span><input id="trailingPercent" inputmode="decimal" value="2"><b>%</b></label>
            <label><span>有效期</span><select id="trailingTif"><option value="gtc">长期有效</option><option value="15m">15 分钟</option><option value="1h">1 小时</option><option value="day">当日有效</option></select><b>TIF</b></label>
          </div>
          <div class="advanced-exit-metrics"><div><span>当前价</span><b id="trailingCurrentPrice">--</b></div><div><span>预计激活</span><b id="trailingActivationPreview">立即</b></div><div><span>预计触发</span><b id="trailingTriggerPreview">--</b></div><div><span>本地预留</span><b id="trailingReservedPreview">--</b></div></div>
          <p id="trailingStatus" class="advanced-exit-status">输入数量和回撤比例。</p>
          <button id="createTrailingStop" class="advanced-exit-create" type="button">创建追踪止损</button>
        </section>
        <section class="advanced-exit-pane" data-exit-pane="scaled" hidden>
          <header><div><b>三档分批止盈</b><small>每一档都通过原撮合创建只减仓限价单。</small></div><span id="scaledAvailableBadge">可用 --</span></header>
          <div class="scaled-exit-main-fields"><label><span>总数量</span><input id="scaledTotalQuantity" inputmode="decimal" placeholder="0.000000"><b id="scaledQuantityUnit">BTC</b></label><label><span>有效期</span><select id="scaledTif"><option value="gtc">长期有效</option><option value="15m">15 分钟</option><option value="1h">1 小时</option><option value="day">当日有效</option></select><b>TIF</b></label></div>
          <div class="scaled-exit-levels">
            <div><strong>01</strong><label><span>止盈价</span><input id="scaledPrice1" inputmode="decimal"><b>USDT</b></label><label><span>比例</span><input id="scaledPercent1" inputmode="decimal" value="30"><b>%</b></label></div>
            <div><strong>02</strong><label><span>止盈价</span><input id="scaledPrice2" inputmode="decimal"><b>USDT</b></label><label><span>比例</span><input id="scaledPercent2" inputmode="decimal" value="30"><b>%</b></label></div>
            <div><strong>03</strong><label><span>止盈价</span><input id="scaledPrice3" inputmode="decimal"><b>USDT</b></label><label><span>比例</span><input id="scaledPercent3" inputmode="decimal" value="40"><b>%</b></label></div>
          </div>
          <div class="advanced-exit-metrics"><div><span>当前价</span><b id="scaledCurrentPrice">--</b></div><div><span>比例合计</span><b id="scaledPercentTotal">100.00%</b></div><div><span>预计冻结</span><b id="scaledReservedPreview">--</b></div><div><span>核心委托</span><b>3 笔</b></div></div>
          <p id="scaledStatus" class="advanced-exit-status">设置三档价格与比例。</p>
          <button id="createScaledExit" class="advanced-exit-create" type="button">创建三档止盈</button>
        </section>
        <div class="advanced-exit-list" id="advancedExitList"></div>
        <small class="advanced-exit-disclaimer">追踪止损为本地条件监控；分批止盈为真实模拟限价委托。所有执行均经过原订单保护。</small>
      </div>
    </section>`;
  }

  function mount() {
    if ($('.advanced-exit-panel')) return true;
    const anchor = $('.advanced-oco-panel') || $('.risk-sizing-panel') || $('.advanced-options');
    if (!anchor) return false;
    anchor.insertAdjacentHTML('afterend', markup());
    bindPanel();
    syncPanel();
    renderList();
    return true;
  }

  function showStatus(kind, message, level = 'normal') {
    const element = kind === 'scaled' ? $('#scaledStatus') : $('#trailingStatus');
    if (!element) return;
    element.textContent = message;
    element.className = `advanced-exit-status ${level}`;
  }

  function syncTabs() {
    $$('[data-exit-tab]').forEach(button => button.classList.toggle('active', button.dataset.exitTab === activeTab));
    $$('[data-exit-pane]').forEach(pane => { pane.hidden = pane.dataset.exitPane !== activeTab; });
  }

  function syncPanel() {
    if (!mount()) return;
    const symbol = activeSymbol();
    const current = currentPrice();
    const available = availableQuantity(symbol);
    const reserved = trailingReserved(symbol);
    const panel = $('.advanced-exit-panel');
    panel.dataset.trailingReserved = String(reserved);
    panel.dataset.exitSymbol = symbol;
    $('#advancedExitCompact').textContent = `${readStore().strategies.filter(strategy => strategy.symbol === symbol && !TERMINAL_STATUSES.has(strategy.status)).length} 活动`;
    $('#trailingQuantityUnit').textContent = activeBase();
    $('#scaledQuantityUnit').textContent = activeBase();
    $('#trailingAvailableBadge').textContent = `可用 ${formatQuantity(available)} ${activeBase()}`;
    $('#scaledAvailableBadge').textContent = `可用 ${formatQuantity(available)} ${activeBase()}`;
    $('#trailingCurrentPrice').textContent = current > 0 ? `${formatPrice(current)} USDT` : '--';
    $('#scaledCurrentPrice').textContent = current > 0 ? `${formatPrice(current)} USDT` : '--';

    const trailingQty = numberFrom($('#trailingQuantity')?.value);
    const activation = numberFrom($('#trailingActivation')?.value);
    const trail = numberFrom($('#trailingPercent')?.value);
    const reference = activation > current ? activation : current;
    $('#trailingActivationPreview').textContent = activation > current ? `${formatPrice(activation)} USDT` : '立即';
    $('#trailingTriggerPreview').textContent = reference > 0 && trail > 0 ? `${formatPrice(reference * (1 - trail / 100))} USDT` : '--';
    $('#trailingReservedPreview').textContent = trailingQty > 0 ? `${formatQuantity(trailingQty)} ${activeBase()}` : '--';

    const scaledQty = numberFrom($('#scaledTotalQuantity')?.value);
    const percentTotal = [1, 2, 3].reduce((sum, index) => sum + numberFrom($(`#scaledPercent${index}`)?.value), 0);
    $('#scaledPercentTotal').textContent = `${percentTotal.toFixed(2)}%`;
    $('#scaledReservedPreview').textContent = scaledQty > 0 ? `${formatQuantity(scaledQty)} ${activeBase()}` : '--';
    syncTabs();
  }

  function renderList() {
    const list = $('#advancedExitList');
    if (!list) return;
    const symbol = activeSymbol();
    const strategies = readStore().strategies.filter(strategy => strategy.symbol === symbol).slice(0, 5);
    if (!strategies.length) {
      list.innerHTML = '<div class="advanced-exit-empty">当前交易对暂无退出策略记录</div>';
      return;
    }
    list.innerHTML = strategies.map(strategy => {
      const trailing = strategy.kind === 'trailing_stop';
      const detail = trailing
        ? `${formatQuantity(strategy.quantity)} ${activeBase()} · 回撤 ${numberFrom(strategy.trailPercent).toFixed(2)}%`
        : `${formatQuantity(strategy.totalQuantity)} ${activeBase()} · ${strategy.legs?.filter(leg => leg.status === 'filled').length || 0}/3 完成`;
      const price = trailing
        ? `触发 ${strategy.triggerPrice > 0 ? formatPrice(strategy.triggerPrice) : '--'}`
        : `区间 ${formatPrice(strategy.legs?.[0]?.price)}–${formatPrice(strategy.legs?.[2]?.price)}`;
      const cancelable = ['waiting_activation', 'active', 'partially_completed', 'partially_canceled'].includes(strategy.status);
      return `<article class="advanced-exit-row ${TERMINAL_STATUSES.has(strategy.status) ? 'terminal' : 'active'}" data-exit-id="${strategy.id}">
        <div><b>${trailing ? '追踪止损' : '分批止盈'} · ${statusLabel(strategy)}</b><small>${detail}</small></div>
        <span><small>${tifLabel(strategy.tif)}</small><b>${price}</b></span>
        ${cancelable ? `<button type="button" data-cancel-exit="${strategy.id}">取消</button>` : '<i></i>'}
      </article>`;
    }).join('');
  }

  function validateTrailing() {
    const symbol = activeSymbol();
    const price = currentPrice();
    const quantity = numberFrom($('#trailingQuantity')?.value);
    const activationPrice = numberFrom($('#trailingActivation')?.value);
    const trailPercent = numberFrom($('#trailingPercent')?.value);
    const tif = $('#trailingTif')?.value || 'gtc';
    const available = availableQuantity(symbol);
    if (!(heldQuantity(symbol) > 0)) return { ok: false, message: '当前交易对没有可卖现货持仓' };
    if (!(quantity > 0)) return { ok: false, message: '请输入有效的追踪数量' };
    if (quantity > available + 1e-10) return { ok: false, message: `当前最多可用 ${formatQuantity(available)} ${activeBase()}` };
    if (!(price > 0)) return { ok: false, message: '当前市场价格无效' };
    if (quantity * price < 5) return { ok: false, message: '追踪止损名义金额不得低于 5 USDT' };
    if (!(trailPercent >= 0.1 && trailPercent <= 20)) return { ok: false, message: '回撤比例必须在 0.1%–20%' };
    if (activationPrice < 0) return { ok: false, message: '激活价无效' };
    const duplicate = readStore().strategies.some(strategy => strategy.kind === 'trailing_stop'
      && strategy.symbol === symbol
      && TRAILING_RESERVED_STATUSES.has(strategy.status)
      && Math.abs(numberFrom(strategy.quantity) - quantity) < 1e-10
      && Math.abs(numberFrom(strategy.activationPrice) - activationPrice) < 1e-8
      && Math.abs(numberFrom(strategy.trailPercent) - trailPercent) < 1e-8);
    if (duplicate) return { ok: false, message: '检测到相同参数的重复追踪止损' };
    return { ok: true, symbol, pair: activePair(), price, quantity, activationPrice, trailPercent, tif };
  }

  function createTrailing() {
    const draft = validateTrailing();
    if (!draft.ok) {
      showStatus('trailing', draft.message, 'danger');
      return;
    }
    const createdAt = Date.now();
    const active = !(draft.activationPrice > draft.price);
    const strategy = {
      id: uid('trail'), kind: 'trailing_stop', symbol: draft.symbol, pair: draft.pair,
      quantity: draft.quantity, activationPrice: draft.activationPrice, trailPercent: draft.trailPercent,
      tif: draft.tif, expiresAt: expiryFor(draft.tif, createdAt), createdAt,
      status: active ? 'active' : 'waiting_activation',
      activatedAt: active ? createdAt : 0,
      peakPrice: active ? draft.price : 0,
      triggerPrice: active ? draft.price * (1 - draft.trailPercent / 100) : 0,
      completedAt: 0, error: '',
    };
    const store = readStore();
    store.strategies.unshift(strategy);
    writeStore(store);
    setInput('#trailingQuantity', '');
    setInput('#trailingActivation', '');
    showStatus('trailing', active ? '追踪止损已激活并开始上移触发线' : '追踪止损已创建，等待激活价', 'positive');
    syncPanel();
    renderList();
  }

  function scaledDraft() {
    const symbol = activeSymbol();
    const current = currentPrice();
    const totalQuantity = numberFrom($('#scaledTotalQuantity')?.value);
    const prices = [1, 2, 3].map(index => numberFrom($(`#scaledPrice${index}`)?.value));
    const percentages = [1, 2, 3].map(index => numberFrom($(`#scaledPercent${index}`)?.value));
    const tif = $('#scaledTif')?.value || 'gtc';
    const available = availableQuantity(symbol);
    if (!(heldQuantity(symbol) > 0)) return { ok: false, message: '当前交易对没有可卖现货持仓' };
    if (!(totalQuantity > 0)) return { ok: false, message: '请输入有效的分批总数量' };
    if (totalQuantity > available + 1e-10) return { ok: false, message: `当前最多可用 ${formatQuantity(available)} ${activeBase()}` };
    if (!(current > 0)) return { ok: false, message: '当前市场价格无效' };
    if (percentages.some(value => !(value > 0))) return { ok: false, message: '每档比例必须大于零' };
    if (Math.abs(percentages.reduce((sum, value) => sum + value, 0) - 100) > 0.001) return { ok: false, message: '三档比例合计必须等于 100%' };
    if (!(prices[0] > current && prices[1] > prices[0] && prices[2] > prices[1])) return { ok: false, message: '三档价格必须高于当前价并严格递增' };

    const totalUnits = Math.floor(totalQuantity * 1e8 + 1e-6);
    const units1 = Math.floor(totalUnits * percentages[0] / 100);
    const units2 = Math.floor(totalUnits * percentages[1] / 100);
    const units3 = totalUnits - units1 - units2;
    const quantities = [units1, units2, units3].map(units => units / 1e8);
    if (quantities.some((quantity, index) => quantity <= 0 || quantity * prices[index] < 5)) return { ok: false, message: '每档数量或名义金额过小' };
    const duplicate = readStore().strategies.some(strategy => strategy.kind === 'scaled_exit'
      && strategy.symbol === symbol
      && ['creating', 'active', 'partially_completed', 'partially_canceled'].includes(strategy.status)
      && Math.abs(numberFrom(strategy.totalQuantity) - totalUnits / 1e8) < 1e-10
      && strategy.legs?.every((leg, index) => Math.abs(numberFrom(leg.price) - prices[index]) < 1e-8
        && Math.abs(numberFrom(leg.percent) - percentages[index]) < 1e-8));
    if (duplicate) return { ok: false, message: '检测到相同参数的重复分批止盈' };
    return { ok: true, symbol, pair: activePair(), current, totalQuantity: totalUnits / 1e8, prices, percentages, quantities, tif };
  }

  async function createScaled() {
    const button = $('#createScaledExit');
    if (button?.disabled) return;
    const draft = scaledDraft();
    if (!draft.ok) {
      showStatus('scaled', draft.message, 'danger');
      return;
    }
    button.disabled = true;
    const createdAt = Date.now();
    const strategy = {
      id: uid('scale'), kind: 'scaled_exit', symbol: draft.symbol, pair: draft.pair,
      totalQuantity: draft.totalQuantity, tif: draft.tif, expiresAt: expiryFor(draft.tif, createdAt),
      createdAt, status: 'creating', completedAt: 0, error: '',
      legs: draft.prices.map((price, index) => ({
        id: uid(`leg${index + 1}`), price, percent: draft.percentages[index], quantity: draft.quantities[index],
        coreOrderId: '', status: 'pending', completedAt: 0,
      })),
    };
    const store = readStore();
    store.strategies.unshift(strategy);
    writeStore(store);
    renderList();
    showStatus('scaled', '正在通过原交易引擎创建三档限价委托…', 'warning');

    const snapshot = snapshotTicket();
    const createdOrderIds = [];
    let failed = '';
    try {
      for (const leg of strategy.legs) {
        const coreOrder = await createCoreLimitSell(leg.price, leg.quantity);
        if (!coreOrder) {
          failed = `第 ${strategy.legs.indexOf(leg) + 1} 档创建失败`;
          break;
        }
        createdOrderIds.push(coreOrder.id);
        const latest = readStore();
        const record = latest.strategies.find(item => item.id === strategy.id);
        const storedLeg = record?.legs.find(item => item.id === leg.id);
        if (storedLeg) storedLeg.coreOrderId = coreOrder.id;
        writeStore(latest);
      }
    } finally {
      setTimeout(() => restoreTicket(snapshot), 0);
    }

    if (failed) {
      for (const orderId of createdOrderIds) await cancelCoreOrder(orderId);
      const latest = readStore();
      const record = latest.strategies.find(item => item.id === strategy.id);
      if (record) {
        record.status = 'error';
        record.error = failed;
        record.completedAt = Date.now();
        record.legs.forEach(leg => { if (leg.coreOrderId) leg.status = 'canceled'; });
        writeStore(latest);
      }
      showStatus('scaled', `${failed}，已回滚本次已创建委托`, 'danger');
    } else {
      const latest = readStore();
      const record = latest.strategies.find(item => item.id === strategy.id);
      if (record) {
        record.status = 'active';
        record.activatedAt = Date.now();
        writeStore(latest);
      }
      setInput('#scaledTotalQuantity', '');
      [1, 2, 3].forEach(index => setInput(`#scaledPrice${index}`, ''));
      showStatus('scaled', '三档止盈已通过原撮合全部创建', 'positive');
    }
    button.disabled = false;
    syncPanel();
    renderList();
  }

  async function cancelStrategy(id, expired = false) {
    const store = readStore();
    const strategy = store.strategies.find(item => item.id === id);
    if (!strategy || TERMINAL_STATUSES.has(strategy.status)) return;
    if (strategy.kind === 'scaled_exit') {
      for (const leg of strategy.legs || []) {
        if (leg.status === 'pending' && leg.coreOrderId) {
          await cancelCoreOrder(leg.coreOrderId);
          leg.status = 'canceled';
          leg.completedAt = Date.now();
        }
      }
    }
    strategy.status = expired ? 'expired' : 'canceled';
    strategy.completedAt = Date.now();
    writeStore(store);
    syncPanel();
    renderList();
  }

  async function triggerTrailing(id) {
    const store = readStore();
    const strategy = store.strategies.find(item => item.id === id);
    if (!strategy || strategy.status !== 'active') return;
    strategy.status = 'triggering';
    strategy.triggeredAt = Date.now();
    writeStore(store);
    syncPanel();
    renderList();
    showStatus('trailing', '追踪止损已触发，正在通过原撮合市价减仓', 'warning');
    const executed = await executeCoreMarketSell(strategy);
    const latest = readStore();
    const record = latest.strategies.find(item => item.id === id);
    if (!record) return;
    record.status = executed ? 'completed' : 'error';
    record.completedAt = Date.now();
    record.error = executed ? '' : '核心市价减仓未完成';
    writeStore(latest);
    showStatus('trailing', executed ? '追踪止损已完成' : record.error, executed ? 'positive' : 'danger');
    syncPanel();
    renderList();
  }

  function evaluateScaled(strategy, core) {
    let changed = false;
    for (const leg of strategy.legs || []) {
      if (leg.status !== 'pending') continue;
      const exists = (core.orders || []).some(order => order.id === leg.coreOrderId);
      if (exists) continue;
      const fill = matchingFill(strategy, leg, core);
      leg.status = fill ? 'filled' : 'canceled';
      leg.completedAt = Date.now();
      changed = true;
    }
    const filled = strategy.legs.filter(leg => leg.status === 'filled').length;
    const pending = strategy.legs.filter(leg => leg.status === 'pending').length;
    const canceled = strategy.legs.filter(leg => leg.status === 'canceled').length;
    let next = strategy.status;
    if (filled === strategy.legs.length) next = 'completed';
    else if (pending > 0 && filled > 0) next = 'partially_completed';
    else if (pending > 0 && canceled > 0) next = 'partially_canceled';
    else if (pending === 0 && filled > 0) next = 'partially_completed';
    else if (pending === 0 && canceled === strategy.legs.length) next = 'canceled';
    if (next !== strategy.status) {
      strategy.status = next;
      if (['completed', 'canceled'].includes(next)) strategy.completedAt = Date.now();
      changed = true;
    }
    return changed;
  }

  async function evaluateAtPrice(priceOverride) {
    if (evaluating) return;
    evaluating = true;
    try {
      const symbol = activeSymbol();
      const price = numberFrom(priceOverride) || currentPrice();
      const ids = readStore().strategies.filter(strategy => strategy.symbol === symbol).map(strategy => strategy.id);
      for (const id of ids) {
        let store = readStore();
        const strategy = store.strategies.find(item => item.id === id);
        if (!strategy) continue;
        if (strategy.expiresAt && Date.now() >= numberFrom(strategy.expiresAt)
          && ['waiting_activation', 'active', 'partially_completed', 'partially_canceled'].includes(strategy.status)) {
          await cancelStrategy(id, true);
          continue;
        }
        if (strategy.kind === 'trailing_stop') {
          if (strategy.status === 'waiting_activation' && price >= numberFrom(strategy.activationPrice)) {
            strategy.status = 'active';
            strategy.activatedAt = Date.now();
            strategy.peakPrice = price;
            strategy.triggerPrice = price * (1 - numberFrom(strategy.trailPercent) / 100);
            writeStore(store);
          } else if (strategy.status === 'active') {
            if (price > numberFrom(strategy.peakPrice)) {
              strategy.peakPrice = price;
              strategy.triggerPrice = price * (1 - numberFrom(strategy.trailPercent) / 100);
              writeStore(store);
            }
            const latest = readStore().strategies.find(item => item.id === id);
            if (price <= numberFrom(latest?.triggerPrice)) await triggerTrailing(id);
          }
        } else if (strategy.kind === 'scaled_exit'
          && ['active', 'partially_completed', 'partially_canceled'].includes(strategy.status)) {
          if (evaluateScaled(strategy, readCore())) writeStore(store);
        }
      }
      syncPanel();
      renderList();
    } finally {
      evaluating = false;
    }
  }

  function evaluateNow() {
    return evaluateAtPrice(currentPrice());
  }

  function bindPanel() {
    const toggle = $('.advanced-exit-toggle');
    const body = $('.advanced-exit-body');
    toggle?.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      if (body) body.hidden = expanded;
      if (!expanded) {
        syncPanel();
        renderList();
      }
    });
    $('.advanced-exit-tabs')?.addEventListener('click', event => {
      const tab = event.target.closest('[data-exit-tab]')?.dataset.exitTab;
      if (!tab) return;
      activeTab = tab;
      syncTabs();
    });
    ['#trailingQuantity', '#trailingActivation', '#trailingPercent', '#scaledTotalQuantity',
      '#scaledPrice1', '#scaledPrice2', '#scaledPrice3', '#scaledPercent1', '#scaledPercent2', '#scaledPercent3']
      .forEach(selector => $(selector)?.addEventListener('input', syncPanel));
    $('#trailingTif')?.addEventListener('change', syncPanel);
    $('#scaledTif')?.addEventListener('change', syncPanel);
    $('#createTrailingStop')?.addEventListener('click', createTrailing);
    $('#createScaledExit')?.addEventListener('click', createScaled);
    $('#advancedExitList')?.addEventListener('click', event => {
      const id = event.target.closest('[data-cancel-exit]')?.dataset.cancelExit;
      if (id) cancelStrategy(id);
    });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      syncPanel();
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
    window.AtlasExitStrategies = {
      evaluateAtPrice,
      evaluateNow,
      readStore,
      trailingReservedQuantity: trailingReserved,
      availableQuantity,
    };
    document.documentElement.dataset.exitStrategies = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
