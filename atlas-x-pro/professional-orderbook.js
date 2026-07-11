(() => {
  'use strict';
  if (window.AtlasProfessionalOrderbook) return;

  const PREF_KEY = 'atlasX.pro.mobileTerminal.v1';
  const ui = {
    mode: 'all',
    tickSize: null,
    lastBook: null,
    frame: 0,
  };

  const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const clone = value => {
    try { return structuredClone(value); }
    catch { return JSON.parse(JSON.stringify(value)); }
  };

  function decimalPlaces(value) {
    const text = String(value).toLowerCase();
    if (text.includes('e-')) return Number(text.split('e-')[1]) || 0;
    return (text.split('.')[1] || '').length;
  }

  function integerScale(tick) {
    return 10 ** Math.min(10, Math.max(0, decimalPlaces(tick)));
  }

  function bucketPrice(price, tickSize, side) {
    const tick = Math.max(Number.EPSILON, finite(tickSize, 1));
    const scale = integerScale(tick);
    const tickUnits = Math.max(1, Math.round(tick * scale));
    const priceUnits = Math.round(finite(price) * scale);
    const bucketUnits = side === 'bid'
      ? Math.floor(priceUnits / tickUnits) * tickUnits
      : Math.ceil(priceUnits / tickUnits) * tickUnits;
    return bucketUnits / scale;
  }

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(row => {
      if (Array.isArray(row)) return [finite(row[0]), Math.max(0, finite(row[1]))];
      return [finite(row?.price), Math.max(0, finite(row?.quantity ?? row?.qty))];
    }).filter(([price, quantity]) => price > 0 && quantity > 0);
  }

  function aggregateSide(rows, tickSize, side, limit) {
    const buckets = new Map();
    normalizeRows(rows).forEach(([price, quantity]) => {
      const bucket = bucketPrice(price, tickSize, side);
      buckets.set(bucket, (buckets.get(bucket) || 0) + quantity);
    });
    const sorted = [...buckets.entries()]
      .sort((a, b) => side === 'bid' ? b[0] - a[0] : a[0] - b[0]);
    const sliced = Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;
    let cumulative = 0;
    return sliced.map(([price, quantity]) => {
      cumulative += quantity;
      return { price, quantity, cumulative };
    });
  }

  function aggregateBook({ bids = [], asks = [], tickSize = 1, rows = 20, mode = 'all' } = {}) {
    const safeMode = ['all', 'bids', 'asks'].includes(mode) ? mode : 'all';
    const limit = Math.max(1, Math.trunc(finite(rows, 20)));
    const aggregatedBids = aggregateSide(bids, tickSize, 'bid', limit);
    const aggregatedAsks = aggregateSide(asks, tickSize, 'ask', limit);
    const visibleBids = safeMode === 'asks' ? [] : aggregatedBids;
    const visibleAsks = safeMode === 'bids' ? [] : aggregatedAsks;
    const bestBid = aggregatedBids[0]?.price || 0;
    const bestAsk = aggregatedAsks[0]?.price || 0;
    const spread = bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0;
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || 0;
    const spreadBps = mid > 0 ? spread / mid * 10_000 : 0;
    const bidQuantity = aggregatedBids.reduce((sum, row) => sum + row.quantity, 0);
    const askQuantity = aggregatedAsks.reduce((sum, row) => sum + row.quantity, 0);
    const totalQuantity = bidQuantity + askQuantity;
    const bidRatio = totalQuantity > 0 ? bidQuantity / totalQuantity * 100 : 50;
    const askRatio = 100 - bidRatio;
    const maxCumulative = Math.max(
      1,
      aggregatedBids.at(-1)?.cumulative || 0,
      aggregatedAsks.at(-1)?.cumulative || 0,
    );
    return {
      bids: visibleBids,
      asks: visibleAsks,
      allBids: aggregatedBids,
      allAsks: aggregatedAsks,
      bestBid,
      bestAsk,
      spread,
      spreadBps,
      bidRatio,
      askRatio,
      maxCumulative,
      tickSize: finite(tickSize, 1),
      mode: safeMode,
    };
  }

  function precisionOptions(price, precision = 2) {
    const digits = Math.max(0, Math.min(8, Math.trunc(finite(precision, 2))));
    const nativeTick = 10 ** -digits;
    const magnitude = Math.max(nativeTick, 10 ** Math.floor(Math.log10(Math.max(finite(price), nativeTick))) / 100_000);
    const center = Math.max(nativeTick, 10 ** Math.floor(Math.log10(magnitude)));
    const values = [center, center * 10, center * 100]
      .map(value => Number(value.toFixed(Math.max(digits, decimalPlaces(center)))))
      .filter(value => value > 0);
    return [...new Set(values)].sort((a, b) => a - b);
  }

  function loadPreference() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      if (['all', 'bids', 'asks'].includes(saved.bookMode)) ui.mode = saved.bookMode;
      if (finite(saved.bookTickSize) > 0) ui.tickSize = finite(saved.bookTickSize);
    } catch {}
  }

  function savePreference() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      localStorage.setItem(PREF_KEY, JSON.stringify({
        ...saved,
        bookMode: ui.mode,
        bookTickSize: ui.tickSize,
      }));
    } catch {}
  }

  function marketPrecision(state) {
    const symbol = String(state?.symbol || 'BTCUSDT');
    const price = finite(state?.ticker?.price, 1);
    if (price >= 1000) return 1;
    if (price >= 100) return 2;
    if (price >= 1) return 3;
    if (price >= 0.1) return 4;
    if (price >= 0.01) return 5;
    return symbol.includes('USDT') ? 6 : 8;
  }

  function formatNumber(value, digits) {
    return finite(value).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatQuantity(value) {
    const quantity = finite(value);
    const digits = quantity >= 1000 ? 0 : quantity >= 1 ? 3 : 6;
    return formatNumber(quantity, digits);
  }

  function ensureMarkup() {
    const panel = document.querySelector('.orderbook-panel');
    const root = document.querySelector('#orderBook');
    const controls = panel?.querySelector('.book-controls');
    if (!panel || !root || !controls) return false;

    panel.classList.add('professional-orderbook');
    if (!controls.querySelector('[data-pro-book-mode]')) {
      controls.querySelectorAll('[data-book-mode],#pricePrecision').forEach(element => {
        element.hidden = true;
        element.setAttribute('aria-hidden', 'true');
      });
      const group = document.createElement('div');
      group.className = 'pro-book-controls';
      group.innerHTML = `
        <div class="pro-book-mode-group" role="group" aria-label="盘口模式">
          <button type="button" data-pro-book-mode="all" aria-label="双边盘口">双边</button>
          <button type="button" data-pro-book-mode="bids" aria-label="仅买盘">买盘</button>
          <button type="button" data-pro-book-mode="asks" aria-label="仅卖盘">卖盘</button>
        </div>
        <label class="pro-book-precision-label"><span>精度</span><select id="proBookPrecision" aria-label="盘口聚合精度"></select></label>`;
      controls.append(group);
    }

    if (!root.querySelector('.pro-book-layout')) {
      root.innerHTML = `
        <div class="pro-book-layout">
          <div class="pro-book-columns">
            <span data-book-column="price">价格(USDT)</span>
            <span data-book-column="quantity">数量</span>
            <span data-book-column="cumulative">累计</span>
          </div>
          <div class="pro-book-side pro-book-asks" id="asksRows" data-pro-book-side="asks"></div>
          <div class="pro-book-mid">
            <div><strong id="midPrice">--</strong><small id="midUsd">≈ $--</small></div>
            <span id="midDirection" aria-hidden="true">↕</span>
            <div class="pro-book-spread"><span>价差</span><b id="proBookSpread">--</b><small id="proBookSpreadBps">-- bps</small></div>
          </div>
          <div class="pro-book-side pro-book-bids" id="bidsRows" data-pro-book-side="bids"></div>
        </div>`;
    }
    return true;
  }

  function rowTemplate(row, side, maxCumulative, priceDigits) {
    const depth = Math.max(0, Math.min(100, row.cumulative / maxCumulative * 100));
    return `<button type="button" class="book-row pro-book-row" data-book-price="${row.price}" data-book-side="${side}" style="--book-depth:${depth.toFixed(2)}%">
      <span data-book-cell="price" class="${side === 'bid' ? 'bid' : 'ask'}">${formatNumber(row.price, priceDigits)}</span>
      <span data-book-cell="quantity">${formatQuantity(row.quantity)}</span>
      <span data-book-cell="cumulative">${formatQuantity(row.cumulative)}</span>
    </button>`;
  }

  function render() {
    ui.frame = 0;
    if (!ensureMarkup()) return;
    const state = window.AtlasMarketDataEngine?.getState?.();
    const book = state?.book;
    if (!book?.bids?.length || !book?.asks?.length) return;
    const price = finite(state?.ticker?.price, book.asks[0]?.[0] || book.bids[0]?.[0] || 1);
    const precision = marketPrecision(state);
    const options = precisionOptions(price, precision);
    if (!ui.tickSize || !options.includes(ui.tickSize)) ui.tickSize = options[0];

    const select = document.querySelector('#proBookPrecision');
    if (select) {
      const values = [...select.options].map(option => Number(option.value));
      if (values.length !== options.length || values.some((value, index) => value !== options[index])) {
        select.innerHTML = options.map(value => `<option value="${value}">${value}</option>`).join('');
      }
      select.value = String(ui.tickSize);
    }

    const result = aggregateBook({
      bids: book.bids,
      asks: book.asks,
      tickSize: ui.tickSize,
      rows: innerWidth <= 820 ? 12 : 16,
      mode: ui.mode,
    });
    ui.lastBook = result;
    const priceDigits = Math.max(0, decimalPlaces(ui.tickSize));
    const asks = document.querySelector('#asksRows');
    const bids = document.querySelector('#bidsRows');
    if (asks) {
      asks.innerHTML = result.asks.slice().reverse()
        .map(row => rowTemplate(row, 'ask', result.maxCumulative, priceDigits)).join('');
      asks.hidden = ui.mode === 'bids';
    }
    if (bids) {
      bids.innerHTML = result.bids
        .map(row => rowTemplate(row, 'bid', result.maxCumulative, priceDigits)).join('');
      bids.hidden = ui.mode === 'asks';
    }
    document.querySelectorAll('[data-pro-book-mode]').forEach(button => {
      const active = button.dataset.proBookMode === ui.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const mid = result.bestAsk && result.bestBid ? (result.bestAsk + result.bestBid) / 2 : price;
    const midPrice = document.querySelector('#midPrice');
    const midUsd = document.querySelector('#midUsd');
    const spread = document.querySelector('#proBookSpread');
    const spreadBps = document.querySelector('#proBookSpreadBps');
    const legacySpread = document.querySelector('#spreadMetric');
    if (midPrice) midPrice.textContent = formatNumber(mid, priceDigits);
    if (midUsd) midUsd.textContent = `≈ $${formatNumber(mid, Math.max(2, priceDigits))}`;
    if (spread) spread.textContent = formatNumber(result.spread, priceDigits);
    if (spreadBps) spreadBps.textContent = `${result.spreadBps.toFixed(2)} bps`;
    if (legacySpread) legacySpread.textContent = formatNumber(result.spread, priceDigits);
    const ratioText = document.querySelector('#bookRatio');
    const ratioBar = document.querySelector('#bidRatioBar');
    if (ratioText) ratioText.textContent = `${result.bidRatio.toFixed(1)} / ${result.askRatio.toFixed(1)}`;
    if (ratioBar) ratioBar.style.width = `${result.bidRatio}%`;
    panelDataset(result);
  }

  function panelDataset(result) {
    const panel = document.querySelector('.professional-orderbook');
    if (!panel) return;
    panel.dataset.bookMode = result.mode;
    panel.dataset.tickSize = String(result.tickSize);
    panel.dataset.spreadBps = String(result.spreadBps);
  }

  function scheduleRender() {
    if (ui.frame) return;
    ui.frame = requestAnimationFrame(render);
  }

  function setMode(mode) {
    if (!['all', 'bids', 'asks'].includes(mode)) return snapshot();
    ui.mode = mode;
    savePreference();
    scheduleRender();
    return snapshot();
  }

  function setTickSize(value) {
    const tick = finite(value);
    if (!(tick > 0)) return snapshot();
    ui.tickSize = tick;
    savePreference();
    scheduleRender();
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({
      mode: ui.mode,
      tickSize: ui.tickSize,
      book: ui.lastBook ? clone(ui.lastBook) : null,
    });
  }

  function bind() {
    window.addEventListener('atlas:market-state', scheduleRender);
    document.addEventListener('click', event => {
      const mode = event.target.closest?.('[data-pro-book-mode]')?.dataset.proBookMode;
      if (mode) {
        event.preventDefault();
        event.stopPropagation();
        setMode(mode);
        return;
      }
      const row = event.target.closest?.('.pro-book-row[data-book-price]');
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      const price = finite(row.dataset.bookPrice);
      const input = document.querySelector('#orderPrice');
      if (input && price > 0) {
        const digits = Math.max(0, decimalPlaces(ui.tickSize || 1));
        input.value = price.toFixed(digits);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const side = row.dataset.bookSide === 'ask' ? 'buy' : 'sell';
      document.querySelector(`.side-selector [data-side="${side}"]`)?.click();
      window.dispatchEvent(new CustomEvent('atlas:orderbook-price-selected', { detail: { price, side } }));
    }, true);
    document.addEventListener('change', event => {
      if (event.target?.id === 'proBookPrecision') setTickSize(event.target.value);
    });
    const observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.target?.id === 'asksRows' || mutation.target?.id === 'bidsRows')) scheduleRender();
    });
    const root = document.querySelector('#orderBook');
    if (root) observer.observe(root, { childList: true, subtree: true });
  }

  function init() {
    loadPreference();
    ensureMarkup();
    bind();
    scheduleRender();
    document.documentElement.dataset.professionalOrderbook = 'ready';
  }

  window.AtlasProfessionalOrderbook = Object.freeze({
    aggregateBook,
    precisionOptions,
    setMode,
    setTickSize,
    snapshot,
    render: scheduleRender,
  });

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
