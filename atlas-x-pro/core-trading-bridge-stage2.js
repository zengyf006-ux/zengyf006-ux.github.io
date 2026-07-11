(() => {
  'use strict';
  if (window.__ATLAS_CORE_TRADING_STAGE2__) return;
  window.__ATLAS_CORE_TRADING_STAGE2__ = true;

  const CORE_KEY = 'atlasX.pro.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const readCore = () => {
    try { return JSON.parse(localStorage.getItem(CORE_KEY) || '{}'); } catch { return {}; }
  };
  const writeCore = value => {
    try { localStorage.setItem(CORE_KEY, JSON.stringify(value)); } catch {}
  };
  const numberFrom = value => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
  const activeSymbol = () => String(readCore().activeSymbol || ($('#activePair')?.textContent || 'BTC/USDT').replace('/', '')).toUpperCase();
  const activePair = () => ($('#activePair')?.textContent || 'BTC/USDT').trim();
  const activeBase = () => activePair().split('/')[0] || 'BTC';
  const currentPrice = () => numberFrom(window.AtlasMarketDataEngine?.getState?.().ticker?.price || $('#lastPrice')?.textContent);
  const normalizeType = type => ({ stop: 'stop_market' })[type]
    || (['market', 'limit', 'stop_market', 'stop_limit'].includes(type) ? type : 'market');
  const legacyType = type => ({ stop_market: 'stop', stop_limit: 'stop' })[normalizeType(type)] || normalizeType(type);

  let selectedType = normalizeType(readCore().orderType);
  let selectedSide = readCore().side === 'sell' ? 'sell' : 'buy';

  function click(selector) {
    const element = $(selector);
    if (!element) return false;
    element.click();
    return true;
  }

  function setSide(side) {
    selectedSide = side === 'sell' ? 'sell' : 'buy';
    click(`.side-selector [data-side="${selectedSide}"]`);
    return selectedSide;
  }

  function setOrderType(type) {
    selectedType = normalizeType(type);
    click(`[data-order-type="${legacyType(selectedType)}"]`);
    document.documentElement.dataset.stage2OrderType = selectedType;
    return selectedType;
  }

  function setField(selector, value, eventName = 'input') {
    const input = $(selector);
    if (!input) return false;
    input.value = value == null ? '' : String(value);
    input.dispatchEvent(new Event(eventName, { bubbles: true }));
    return true;
  }

  function syncOrderFields(source = 'total') {
    const selector = source === 'quantity' ? '#orderQuantity' : '#orderTotal';
    const input = $(selector);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submitOrder() {
    return click('#submitOrder');
  }

  function getState() {
    const core = readCore();
    return structuredClone({
      activeSymbol: core.activeSymbol || activeSymbol(),
      side: selectedSide,
      orderType: selectedType,
      cash: Number(core.cash) || 0,
      positions: Array.isArray(core.positions) ? core.positions : [],
      orders: Array.isArray(core.orders) ? core.orders : [],
      history: Array.isArray(core.history) ? core.history : [],
    });
  }

  function getMarket() {
    const engine = window.AtlasMarketDataEngine?.getState?.() || {};
    return {
      symbol: activeSymbol(),
      pair: activePair(),
      base: activeBase(),
      price: numberFrom(engine.ticker?.price) || currentPrice(),
      precision: Math.max(0, String(numberFrom(engine.ticker?.price) || currentPrice()).split('.')[1]?.length || 2),
      book: structuredClone(engine.book || { bids: [], asks: [] }),
      connectionState: engine.connectionState || 'booting',
    };
  }

  function annotateNewestOrder(predicate, patch) {
    const core = readCore();
    const orders = Array.isArray(core.orders) ? core.orders : [];
    const order = orders.find(predicate);
    if (!order) return null;
    Object.assign(order, patch);
    writeCore(core);
    window.dispatchEvent(new CustomEvent('atlas:core-ledger-annotated', { detail: { orderId: order.id, patch } }));
    return structuredClone(order);
  }

  window.AtlasCoreTrading = Object.freeze({
    getState,
    getMarket,
    getOrderType: () => selectedType,
    getSide: () => selectedSide,
    setOrderType,
    setSide,
    setField,
    syncOrderFields,
    submitOrder,
    annotateNewestOrder,
    readCore: () => structuredClone(readCore()),
    currentPrice,
    normalizeType,
    legacyType,
  });

  document.documentElement.dataset.coreTradingStage2 = 'ready';
})();
