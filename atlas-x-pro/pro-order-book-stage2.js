(() => {
  'use strict';
  if (window.__ATLAS_ORDER_BOOK_STAGE2__) return;
  window.__ATLAS_ORDER_BOOK_STAGE2__ = true;

  const PREF_KEY = 'atlasX.pro.mobileStage2.v1';
  const MOBILE_BREAKPOINT = 820;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const numberFrom = value => Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  const isMobile = () => innerWidth <= MOBILE_BREAKPOINT;
  let rendering = false;
  let renderFrame = 0;
  let lastSignature = '';

  function readPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
  }

  function writePrefs(patch) {
    const next = { ...readPrefs(), ...patch };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch {}
    return next;
  }

  function normalizeLevel(level) {
    const price = Array.isArray(level) ? Number(level[0]) : Number(level?.price);
    const quantity = Array.isArray(level) ? Number(level[1]) : Number(level?.quantity ?? level?.qty ?? level?.size);
    return Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0
      ? { price, quantity }
      : null;
  }

  function stepOptions(price) {
    if (price >= 10000) return [0.1, 1, 10, 50];
    if (price >= 1000) return [0.01, 0.1, 1, 5];
    if (price >= 100) return [0.01, 0.1, 0.5, 1];
    if (price >= 1) return [0.001, 0.01, 0.1, 0.5];
    return [0.0001, 0.001, 0.01, 0.1];
  }

  function aggregate(levels, step, side) {
    const normalizedStep = Number(step);
    if (!(normalizedStep > 0)) return [];
    const buckets = new Map();
    (levels || []).map(normalizeLevel).filter(Boolean).forEach(level => {
      const ratio = level.price / normalizedStep;
      const key = side === 'ask'
        ? Math.ceil(ratio - 1e-10)
        : Math.floor(ratio + 1e-10);
      buckets.set(key, (buckets.get(key) || 0) + level.quantity);
    });
    const sorted = [...buckets.entries()]
      .map(([key, quantity]) => ({ price: key * normalizedStep, quantity }))
      .sort((a, b) => side === 'ask' ? a.price - b.price : b.price - a.price);
    let cumulative = 0;
    return sorted.map(level => ({ ...level, cumulative: cumulative += level.quantity }));
  }

  function currentSnapshot() {
    const engine = window.AtlasMarketDataEngine?.getState?.() || {};
    const book = engine.book || {};
    const price = Number(engine.ticker?.price) || numberFrom($('#lastPrice')?.textContent) || 0;
    const options = stepOptions(price);
    const prefs = readPrefs();
    const requested = Number(prefs.bookAggregation);
    const step = options.includes(requested) ? requested : options[1];
    const mode = ['all', 'bids', 'asks'].includes(prefs.bookMode) ? prefs.bookMode : 'all';
    return {
      symbol: engine.symbol || ($('#activePair')?.textContent || '').replace('/', ''),
      connectionState: engine.connectionState || 'booting',
      source: engine.source || '',
      price,
      step,
      options,
      mode,
      asks: aggregate(book.asks || [], step, 'ask'),
      bids: aggregate(book.bids || [], step, 'bid'),
      receivedAt: Number(engine.lastReceivedAt) || 0,
    };
  }

  function decimals(step) {
    const text = String(step);
    return text.includes('.') ? text.split('.')[1].length : 0;
  }

  function format(value, digits) {
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function mountMobileControls(snapshot) {
    const select = $('#pricePrecision');
    if (!select) return;
    const optionSignature = snapshot.options.join('|');
    if (select.dataset.stage2Options !== optionSignature) {
      select.innerHTML = snapshot.options
        .map(step => `<option value="${step}">${format(step, decimals(step))}</option>`)
        .join('');
      select.dataset.stage2Options = optionSignature;
    }
    select.value = String(snapshot.step);
    select.dataset.stage2Aggregation = 'true';
    select.setAttribute('aria-label', '订单簿价格聚合');
    $$('[data-book-mode]').forEach(button => {
      const active = button.dataset.bookMode === snapshot.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.style.minHeight = '40px';
    });
  }

  function rowMarkup(level, side, max, digits) {
    const depth = Math.min(100, level.cumulative / Math.max(max, 1e-12) * 100);
    const quantityDigits = level.quantity >= 100 ? 2 : level.quantity >= 1 ? 4 : 6;
    return `<button class="book-row stage2-book-row" type="button" data-book-price="${level.price}" data-book-side="${side}" style="--depth:${depth.toFixed(3)}%;--depth-color:${side === 'ask' ? 'rgba(241,91,112,.10)' : 'rgba(33,201,151,.10)'}"><span class="${side}">${format(level.price, digits)}</span><span>${format(level.quantity, quantityDigits)}</span><span>${format(level.cumulative, quantityDigits)}</span></button>`;
  }

  function render(force = false) {
    document.documentElement.dataset.orderBookStage2 = 'ready';
    if (!isMobile()) return;

    const asksHost = $('#asksRows');
    const bidsHost = $('#bidsRows');
    if (!asksHost || !bidsHost || rendering) return;
    const snapshot = currentSnapshot();
    const signature = JSON.stringify({
      symbol: snapshot.symbol,
      state: snapshot.connectionState,
      step: snapshot.step,
      mode: snapshot.mode,
      asks: snapshot.asks.slice(0, 24),
      bids: snapshot.bids.slice(0, 24),
    });
    if (!force && signature === lastSignature) return;

    lastSignature = signature;
    rendering = true;
    try {
      mountMobileControls(snapshot);
      const rowCount = snapshot.mode === 'all' ? 8 : 16;
      const asks = snapshot.asks.slice(0, rowCount);
      const bids = snapshot.bids.slice(0, rowCount);
      const askMax = asks.at(-1)?.cumulative || 1;
      const bidMax = bids.at(-1)?.cumulative || 1;
      const digits = decimals(snapshot.step);
      asksHost.innerHTML = asks.slice().reverse().map(level => rowMarkup(level, 'ask', askMax, digits)).join('');
      bidsHost.innerHTML = bids.map(level => rowMarkup(level, 'bid', bidMax, digits)).join('');
      asksHost.hidden = snapshot.mode === 'bids';
      bidsHost.hidden = snapshot.mode === 'asks';

      const orderBook = $('#orderBook');
      if (orderBook) {
        orderBook.dataset.stage2Mode = snapshot.mode;
        orderBook.dataset.connectionState = snapshot.connectionState;
        orderBook.dataset.aggregation = String(snapshot.step);
        orderBook.classList.toggle('stage2-stale', ['stale', 'offline'].includes(snapshot.connectionState));
      }
      const columns = $('#orderBook .book-columns');
      if (columns) columns.innerHTML = '<span>价格(USDT)</span><span>数量</span><span>累计</span>';
      window.dispatchEvent(new CustomEvent('atlas:order-book-stage2-render', { detail: { snapshot } }));
    } finally {
      rendering = false;
    }
  }

  function schedule(force = false) {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render(force);
    });
  }

  function setAggregation(step) {
    const value = Number(step);
    const snapshot = currentSnapshot();
    if (!snapshot.options.includes(value)) return snapshot.step;
    writePrefs({ bookAggregation: value });
    lastSignature = '';
    if (isMobile()) render(true);
    return value;
  }

  function setMode(mode) {
    const value = ['all', 'bids', 'asks'].includes(mode) ? mode : 'all';
    writePrefs({ bookMode: value });
    lastSignature = '';
    if (isMobile()) render(true);
    return value;
  }

  function stage2OwnsHosts(hosts) {
    return hosts.every(host => host.children.length > 0
      && [...host.children].every(child => child.classList.contains('stage2-book-row')));
  }

  function bind() {
    $('#pricePrecision')?.addEventListener('change', event => {
      if (isMobile()) setAggregation(event.target.value);
    });
    document.addEventListener('click', event => {
      if (!isMobile()) return;
      const mode = event.target.closest('[data-book-mode]')?.dataset.bookMode;
      if (mode) queueMicrotask(() => setMode(mode));
    });
    window.addEventListener('resize', () => {
      lastSignature = '';
      if (isMobile()) schedule(true);
    });
    window.AtlasMarketDataEngine?.subscribe?.(() => schedule());

    const hosts = [$('#asksRows'), $('#bidsRows')].filter(Boolean);
    if (hosts.length) {
      const observer = new MutationObserver(() => {
        if (!isMobile() || rendering || stage2OwnsHosts(hosts)) return;
        schedule(true);
      });
      hosts.forEach(host => observer.observe(host, { childList: true }));
    }
  }

  window.AtlasOrderBookStage2 = Object.freeze({
    getSnapshot: () => structuredClone(currentSnapshot()),
    aggregate: (levels, step, side) => structuredClone(aggregate(levels, Number(step), side === 'ask' ? 'ask' : 'bid')),
    setAggregation,
    setMode,
    render: () => render(true),
  });

  function init() {
    bind();
    schedule(true);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
