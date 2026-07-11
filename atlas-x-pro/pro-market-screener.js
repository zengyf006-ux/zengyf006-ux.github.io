(() => {
  'use strict';
  if (window.__ATLAS_PRO_MARKET_SCREENER__) return;
  window.__ATLAS_PRO_MARKET_SCREENER__ = true;

  const CORE_KEY = 'atlasX.pro.v1';
  const CACHE_KEY = 'atlasX.pro.marketScreener.cache.v1';
  const UI_KEY = 'atlasX.pro.marketScreener.ui.v1';
  const CACHE_MAX_AGE = 10 * 60 * 1000;
  const REQUEST_DEDUPE_MS = 30 * 1000;
  const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
  const GATEWAY = window.AtlasMarketDataEngine?.gatewayBase
    || 'https://vtcunypvhtudragsittb.supabase.co/functions/v1/atlas-market-gateway';
  const nativeFetch = window.__ATLAS_NATIVE_NETWORK__?.fetch || window.fetch.bind(window);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let rows = [];
  let source = 'pending';
  let provider = '';
  let inFlight = null;
  let lastFetchAt = 0;
  let statusOverride = '';
  let ui = readJson(UI_KEY, { query: '', filter: 'all', sort: 'turnover', direction: 'desc', selected: [] });

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function finite(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function nullable(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function pairFor(symbol) {
    return symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
  }

  function baseFor(symbol) {
    return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[character]);
  }

  function normalizeUi() {
    ui = {
      query: String(ui.query || ''),
      filter: ['all', 'range', 'spread'].includes(ui.filter) ? ui.filter : 'all',
      sort: ['turnover', 'change', 'range', 'spread', 'price'].includes(ui.sort) ? ui.sort : 'turnover',
      direction: ui.direction === 'asc' ? 'asc' : 'desc',
      selected: Array.isArray(ui.selected)
        ? [...new Set(ui.selected.map(String).filter(symbol => SYMBOLS.includes(symbol)))].slice(0, 4)
        : [],
    };
  }

  function saveUi() {
    normalizeUi();
    writeJson(UI_KEY, ui);
  }

  function readFavorites() {
    const core = readJson(CORE_KEY, {});
    return Array.isArray(core.favorites) ? core.favorites.map(String) : [];
  }

  function toggleFavorite(symbol) {
    const core = readJson(CORE_KEY, {});
    const favorites = new Set(Array.isArray(core.favorites) ? core.favorites.map(String) : []);
    if (favorites.has(symbol)) favorites.delete(symbol);
    else favorites.add(symbol);
    core.favorites = [...favorites].filter(item => SYMBOLS.includes(item));
    writeJson(CORE_KEY, core);
    window.dispatchEvent(new CustomEvent('atlas:favorites-changed', { detail: { symbol, favorites: core.favorites } }));
    render();
  }

  function compact(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
    const number = Number(value);
    const absolute = Math.abs(number);
    if (absolute >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
    if (absolute >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
    if (absolute >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
    return number.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function priceText(value) {
    if (!Number.isFinite(Number(value))) return '--';
    const number = Number(value);
    const digits = number >= 1000 ? 2 : number >= 1 ? 4 : 6;
    return number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function percentText(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
    const number = Number(value);
    return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
  }

  function metricText(value, suffix = '') {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
    return `${Number(value).toFixed(2)}${suffix}`;
  }

  function fallbackRows() {
    const visible = new Map($$('#marketList [data-symbol]').map(element => {
      const symbol = String(element.dataset.symbol || '').toUpperCase();
      const price = finite($('.price-cell', element)?.textContent?.replace(/,/g, ''), 0);
      const change = finite($('.change-cell', element)?.textContent, 0);
      return [symbol, {
        symbol, pair: pairFor(symbol), base: baseFor(symbol), price, change,
        turnover: null, trades: null, range: null, spread: null, provider: '', serverTime: null,
      }];
    }));
    return SYMBOLS.map(symbol => visible.get(symbol) || {
      symbol, pair: pairFor(symbol), base: baseFor(symbol), price: 0, change: 0,
      turnover: null, trades: null, range: null, spread: null, provider: '', serverTime: null,
    });
  }

  function normalizeGateway(payload) {
    const input = new Map((Array.isArray(payload?.markets) ? payload.markets : [])
      .map(item => [String(item?.symbol || '').toUpperCase(), item]));
    return SYMBOLS.map(symbol => {
      const item = input.get(symbol);
      if (!item) return null;
      const price = nullable(item.price);
      const open = nullable(item.open);
      const high = nullable(item.high);
      const low = nullable(item.low);
      const bid = nullable(item.bid);
      const ask = nullable(item.ask);
      const midpoint = bid !== null && ask !== null ? (bid + ask) / 2 : 0;
      return {
        symbol,
        pair: pairFor(symbol),
        base: baseFor(symbol),
        price,
        change: nullable(item.change),
        turnover: nullable(item.quoteVolume),
        trades: nullable(item.trades),
        range: open !== null && open !== 0 && high !== null && low !== null ? (high - low) / Math.abs(open) * 100 : null,
        spread: midpoint > 0 && ask !== null && bid !== null && ask >= bid ? (ask - bid) / midpoint * 10000 : null,
        provider: String(item.provider || payload?.provider || ''),
        serverTime: nullable(item.serverTime || payload?.serverTime),
      };
    }).filter(item => item && item.price !== null && item.price > 0);
  }

  function createTimeout(milliseconds = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Market screener request timed out', 'TimeoutError')), milliseconds);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }

  async function fetchLive() {
    const timeout = createTimeout();
    try {
      const response = await nativeFetch(`${GATEWAY}/markets`, {
        signal: timeout.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Market gateway HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.error) throw new Error(payload.error.message || 'Market gateway error');
      const normalized = normalizeGateway(payload);
      if (normalized.length !== SYMBOLS.length) throw new Error('Market gateway response incomplete');
      writeJson(CACHE_KEY, {
        version: 2,
        updatedAt: Date.now(),
        provider: String(payload.provider || normalized[0]?.provider || ''),
        rows: normalized,
      });
      return { rows: normalized, source: 'live', provider: String(payload.provider || normalized[0]?.provider || '') };
    } finally {
      timeout.clear();
    }
  }

  function cachedResult() {
    const cache = readJson(CACHE_KEY, {});
    const complete = Array.isArray(cache.rows) && cache.rows.length === SYMBOLS.length;
    if (complete && Date.now() - finite(cache.updatedAt) <= CACHE_MAX_AGE) {
      return { rows: cache.rows, source: 'cache', provider: String(cache.provider || 'cache') };
    }
    return { rows: fallbackRows(), source: 'partial', provider: '' };
  }

  function sourceLabel() {
    if (source === 'live') return provider ? `${provider.toUpperCase()} 实时` : '统一实时行情';
    return ({ cache: '有效缓存', partial: '部分数据', pending: '加载中' })[source] || '数据状态';
  }

  function statusLabel() {
    if (statusOverride) return statusOverride;
    if (source === 'cache') return '统一行情网关暂不可用，当前显示 10 分钟内的有效缓存。';
    if (source === 'partial') return '统一行情网关与有效缓存均不可用；缺失指标明确显示为 --。';
    if (source === 'live') return '统一公共行情已更新；筛选与排序仅用于观察，不会自动提交订单。';
    return '正在准备市场数据。';
  }

  function screenerMarkup() {
    normalizeUi();
    return `<section class="pro-market-screener" data-ready="true" data-source="${source}">
      <header class="pro-market-screener-head">
        <div><strong>专业市场筛选器</strong><small>统一公共行情 · 多维排序 · 最多四市场对比</small></div>
        <span id="marketScreenerSource">${sourceLabel()}</span>
      </header>
      <div class="pro-market-screener-controls">
        <label class="pro-market-search"><span>搜索</span><input id="marketScreenerSearch" type="search" autocomplete="off" value="${escapeHtml(ui.query)}" placeholder="BTC / ETH"></label>
        <label><span>排序</span><select id="marketScreenerSort"><option value="turnover">成交额</option><option value="change">涨跌幅</option><option value="range">振幅</option><option value="spread">点差</option><option value="price">价格</option></select></label>
        <label><span>方向</span><select id="marketScreenerDirection"><option value="desc">从高到低</option><option value="asc">从低到高</option></select></label>
        <nav aria-label="市场筛选"><button type="button" data-screener-filter="all">全部</button><button type="button" data-screener-filter="range">高振幅</button><button type="button" data-screener-filter="spread">低点差</button></nav>
      </div>
      <p id="marketScreenerStatus" class="pro-market-screener-status">${escapeHtml(statusLabel())}</p>
      <div class="pro-market-compare" id="marketScreenerCompare"></div>
      <div class="pro-market-table">
        <div class="pro-market-table-head"><span>市场</span><span>最新价</span><span>24h</span><span>成交额</span><span>振幅</span><span>点差</span><span>操作</span></div>
        <div id="marketScreenerRows"></div>
      </div>
    </section>`;
  }

  function mountCurrentOverlay() {
    const overlay = $('.module-overlay[data-module="markets"]');
    if (!overlay) return null;
    const existing = $('.pro-market-screener', overlay);
    if (existing) return existing;
    const oldRanking = $$('.module-panel', overlay).find(panel => panel.textContent.includes('市场排行榜'));
    const wrapper = document.createElement('div');
    wrapper.innerHTML = screenerMarkup();
    const screener = wrapper.firstElementChild;
    if (oldRanking) oldRanking.replaceWith(screener);
    else {
      const grid = $('.module-grid', overlay);
      if (grid) grid.after(screener);
      else overlay.append(screener);
    }
    bindScreener(screener);
    return screener;
  }

  function sortValue(row) {
    const value = row[ui.sort];
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return ui.direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    return Number(value);
  }

  function visibleFor(row) {
    const query = ui.query.trim().toUpperCase().replace('/', '');
    if (query && !row.symbol.includes(query) && !row.pair.replace('/', '').includes(query)) return false;
    if (ui.filter === 'range' && !(Number(row.range) >= 12)) return false;
    if (ui.filter === 'spread' && !(Number(row.spread) <= 1)) return false;
    return true;
  }

  function rowMarkup(row, favorites) {
    const positive = finite(row.change) >= 0;
    const selected = ui.selected.includes(row.symbol);
    const favorite = favorites.includes(row.symbol);
    return `<article class="pro-market-row" data-screener-symbol="${row.symbol}" data-range-percent="${row.range ?? ''}" data-spread-bps="${row.spread ?? ''}" ${visibleFor(row) ? '' : 'hidden'}>
      <div class="pro-market-identity"><i>${escapeHtml(row.base.slice(0, 1))}</i><span><strong>${escapeHtml(row.pair)}</strong><small>${escapeHtml(row.base)} · USDT</small></span></div>
      <b data-metric="price">${row.price > 0 ? priceText(row.price) : '--'}</b>
      <b class="${positive ? 'positive' : 'negative'}" data-metric="change">${percentText(row.change)}</b>
      <b data-metric="turnover">${compact(row.turnover)}</b>
      <b data-metric="range">${metricText(row.range, '%')}</b>
      <b data-metric="spread">${metricText(row.spread, ' bp')}</b>
      <div class="pro-market-actions">
        <button type="button" data-screener-favorite="${row.symbol}" class="${favorite ? 'active' : ''}" aria-label="${favorite ? '取消自选' : '加入自选'}">★</button>
        <button type="button" data-screener-compare="${row.symbol}" class="${selected ? 'active' : ''}">${selected ? '已对比' : '对比'}</button>
        <button type="button" data-screener-open="${row.symbol}">交易</button>
      </div>
    </article>`;
  }

  function compareMarkup() {
    return ui.selected.map(symbol => {
      const row = rows.find(item => item.symbol === symbol) || fallbackRows().find(item => item.symbol === symbol);
      if (!row) return '';
      return `<article class="pro-market-compare-card" data-compare-symbol="${symbol}"><span>${escapeHtml(row.pair)}</span><b class="${finite(row.change) >= 0 ? 'positive' : 'negative'}">${percentText(row.change)}</b><small>${compact(row.turnover)}</small><button type="button" data-remove-compare="${symbol}" aria-label="移除 ${symbol}">×</button></article>`;
    }).join('');
  }

  function render() {
    const root = mountCurrentOverlay();
    if (!root) return;
    normalizeUi();
    root.dataset.ready = 'true';
    root.dataset.source = source;
    const sourceElement = $('#marketScreenerSource', root);
    if (sourceElement) sourceElement.textContent = sourceLabel();
    const status = $('#marketScreenerStatus', root);
    if (status) status.textContent = statusLabel();
    const search = $('#marketScreenerSearch', root);
    if (search && document.activeElement !== search && search.value !== ui.query) search.value = ui.query;
    const sort = $('#marketScreenerSort', root);
    if (sort) sort.value = ui.sort;
    const direction = $('#marketScreenerDirection', root);
    if (direction) direction.value = ui.direction;
    $$('[data-screener-filter]', root).forEach(button => button.classList.toggle('active', button.dataset.screenerFilter === ui.filter));
    const ordered = [...rows].sort((a, b) => {
      const delta = sortValue(a) - sortValue(b);
      return (ui.direction === 'asc' ? delta : -delta) || a.symbol.localeCompare(b.symbol);
    });
    const container = $('#marketScreenerRows', root);
    if (container) container.innerHTML = ordered.map(row => rowMarkup(row, readFavorites())).join('');
    const compare = $('#marketScreenerCompare', root);
    if (compare) compare.innerHTML = compareMarkup();
    saveUi();
  }

  async function refresh({ force = false } = {}) {
    const now = Date.now();
    if (!force && inFlight) return inFlight;
    if (!force && rows.length && now - lastFetchAt < REQUEST_DEDUPE_MS) {
      const root = mountCurrentOverlay();
      if (root && !$('#marketScreenerRows', root)?.children.length) render();
      return { rows, source };
    }
    lastFetchAt = now;
    statusOverride = '正在刷新统一公共行情。';
    render();
    inFlight = (async () => {
      try {
        const result = await fetchLive();
        rows = result.rows;
        source = result.source;
        provider = result.provider;
      } catch {
        const result = cachedResult();
        rows = result.rows;
        source = result.source;
        provider = result.provider;
      } finally {
        statusOverride = '';
        inFlight = null;
      }
      render();
      return { rows, source };
    })();
    return inFlight;
  }

  function setStatus(message) {
    statusOverride = message;
    const status = $('#marketScreenerStatus');
    if (status) status.textContent = message;
  }

  function toggleCompare(symbol) {
    if (ui.selected.includes(symbol)) ui.selected = ui.selected.filter(item => item !== symbol);
    else if (ui.selected.length >= 4) {
      setStatus('最多同时对比 4 个市场。');
      return;
    } else ui.selected.push(symbol);
    statusOverride = '';
    saveUi();
    render();
  }

  function openTrade(symbol) {
    const marketRow = $(`#marketList [data-symbol="${CSS.escape(symbol)}"]`) || $(`[data-symbol="${CSS.escape(symbol)}"]`);
    marketRow?.click();
    requestAnimationFrame(() => $('.module-overlay[data-module="markets"] .module-close')?.click());
  }

  function bindScreener(root) {
    root.addEventListener('input', event => {
      if (event.target.id !== 'marketScreenerSearch') return;
      ui.query = event.target.value;
      statusOverride = '';
      render();
      $('#marketScreenerSearch')?.focus();
    });
    root.addEventListener('change', event => {
      if (event.target.id === 'marketScreenerSort') ui.sort = event.target.value;
      if (event.target.id === 'marketScreenerDirection') ui.direction = event.target.value;
      statusOverride = '';
      render();
    });
    root.addEventListener('click', event => {
      const filter = event.target.closest('[data-screener-filter]')?.dataset.screenerFilter;
      if (filter) {
        ui.filter = filter;
        statusOverride = '';
        render();
        return;
      }
      const favorite = event.target.closest('[data-screener-favorite]')?.dataset.screenerFavorite;
      if (favorite) {
        toggleFavorite(favorite);
        return;
      }
      const compare = event.target.closest('[data-screener-compare]')?.dataset.screenerCompare;
      if (compare) {
        toggleCompare(compare);
        return;
      }
      const remove = event.target.closest('[data-remove-compare]')?.dataset.removeCompare;
      if (remove) {
        ui.selected = ui.selected.filter(item => item !== remove);
        statusOverride = '';
        render();
        return;
      }
      const open = event.target.closest('[data-screener-open]')?.dataset.screenerOpen;
      if (open) openTrade(open);
    });
  }

  function createMobileEntry() {
    if ($('.mobile-market-center-button')) return;
    const head = $('.mobile-market-head');
    const favorite = $('#mobileFavorite');
    if (!head) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-market-center-button';
    button.setAttribute('aria-label', '打开专业市场筛选器');
    button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/></svg>';
    if (favorite?.parentElement === head) head.insertBefore(button, favorite);
    else head.append(button);
  }

  function inspect() {
    createMobileEntry();
    const overlay = $('.module-overlay[data-module="markets"]');
    if (!overlay || $('.pro-market-screener', overlay)) return;
    mountCurrentOverlay();
    refresh();
  }

  function init() {
    normalizeUi();
    rows = fallbackRows();
    source = 'pending';
    createMobileEntry();
    const shell = $('.pro-shell');
    if (shell) new MutationObserver(inspect).observe(shell, { childList: true, subtree: true });
    window.addEventListener('atlas:favorites-changed', render);
    document.documentElement.dataset.marketScreener = 'ready';
    inspect();
  }

  window.AtlasMarketScreener = Object.freeze({
    refresh,
    getState: () => ({ source, provider, rows: structuredClone(rows), ui: structuredClone(ui) }),
    gateway: GATEWAY,
  });

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
