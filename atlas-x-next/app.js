(() => {
  'use strict';

  const STORAGE_KEY = 'atlasX.v1.state';
  const MARKETS = {
    BTC: {
      symbol: 'BTC', pair: 'BTC/USDT', icon: '₿', iconClass: 'coin-btc',
      price: 64407.6, change: 2.18, high: 65182.3, low: 62906.1,
      volume: '28.64K BTC', turnover: '1.84B USDT', seed: 41, precision: 1,
    },
    ETH: {
      symbol: 'ETH', pair: 'ETH/USDT', icon: '◆', iconClass: 'coin-eth',
      price: 3518.42, change: 1.36, high: 3586.91, low: 3429.18,
      volume: '412.8K ETH', turnover: '1.45B USDT', seed: 73, precision: 2,
    },
    SOL: {
      symbol: 'SOL', pair: 'SOL/USDT', icon: 'S', iconClass: 'coin-sol',
      price: 152.84, change: -0.74, high: 156.92, low: 149.76,
      volume: '9.18M SOL', turnover: '1.39B USDT', seed: 109, precision: 2,
    },
  };

  const DEFAULT_STATE = {
    market: 'BTC', timeframe: '1H', side: 'buy', orderType: 'market',
    mobileView: 'chart', accountView: 'positions', bookMode: 'all',
    indicator: 'ema', favoriteMarkets: ['BTC'], positions: [], openOrders: [], history: [],
  };

  const state = {
    ...DEFAULT_STATE,
    price: MARKETS.BTC.price,
    previousPrice: MARKETS.BTC.price,
    candles: [], pointer: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const market = () => MARKETS[state.market];
  const fmt = (value, digits = market().precision) => Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const svg = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored || typeof stored !== 'object') return;
      Object.assign(state, {
        market: MARKETS[stored.market] ? stored.market : DEFAULT_STATE.market,
        timeframe: typeof stored.timeframe === 'string' ? stored.timeframe : DEFAULT_STATE.timeframe,
        side: stored.side === 'sell' ? 'sell' : 'buy',
        orderType: ['market', 'limit', 'trigger'].includes(stored.orderType) ? stored.orderType : 'market',
        mobileView: ['chart', 'book', 'trades', 'account'].includes(stored.mobileView) ? stored.mobileView : 'chart',
        accountView: ['positions', 'orders', 'history'].includes(stored.accountView) ? stored.accountView : 'positions',
        bookMode: ['all', 'asks', 'bids'].includes(stored.bookMode) ? stored.bookMode : 'all',
        indicator: stored.indicator === 'boll' ? 'boll' : 'ema',
        favoriteMarkets: Array.isArray(stored.favoriteMarkets) ? stored.favoriteMarkets.filter((key) => MARKETS[key]) : ['BTC'],
        positions: Array.isArray(stored.positions) ? stored.positions : [],
        openOrders: Array.isArray(stored.openOrders) ? stored.openOrders : [],
        history: Array.isArray(stored.history) ? stored.history : [],
      });
    } catch {
      // Storage is optional; corrupted data must never block the terminal.
    }
  }

  function saveState() {
    try {
      const payload = {
        market: state.market, timeframe: state.timeframe, side: state.side,
        orderType: state.orderType, mobileView: state.mobileView,
        accountView: state.accountView, bookMode: state.bookMode,
        indicator: state.indicator, favoriteMarkets: state.favoriteMarkets,
        positions: state.positions, openOrders: state.openOrders, history: state.history,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Persistence failure is non-fatal.
    }
  }

  function seededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
    return () => (value = value * 16807 % 2147483647) / 2147483647;
  }

  function buildCandles(seed, count = 84) {
    const current = market();
    const random = seededRandom(seed);
    const output = [];
    let close = current.price * 0.965;
    const volatility = current.price * (current.symbol === 'BTC' ? 0.0072 : current.symbol === 'ETH' ? 0.0085 : 0.0105);
    for (let index = 0; index < count; index += 1) {
      const open = close;
      const trend = index > 48 ? volatility * 0.11 : volatility * 0.04;
      close = open + (random() - 0.46) * volatility + trend;
      output.push({
        open, close,
        high: Math.max(open, close) + random() * volatility * 0.52,
        low: Math.min(open, close) - random() * volatility * 0.48,
        volume: 40 + random() * 160,
        time: `${String((index + 3) % 24).padStart(2, '0')}:00`,
      });
    }
    const delta = current.price - output.at(-1).close;
    output.forEach((candle, index) => {
      const weight = index / (output.length - 1);
      for (const key of ['open', 'close', 'high', 'low']) candle[key] += delta * weight;
    });
    return output;
  }

  function movingAverage(data, period) {
    return data.map((_, index) => {
      const range = data.slice(Math.max(0, index - period + 1), index + 1);
      return range.reduce((total, candle) => total + candle.close, 0) / range.length;
    });
  }

  function drawChart() {
    const canvas = $('#chartCanvas');
    const stage = $('#chartStage');
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(220, Math.floor(rect.height));
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const padding = { top: 17, right: 62, bottom: 29, left: 10 };
    const volumeHeight = Math.min(60, height * 0.18);
    const chartBottom = height - padding.bottom - volumeHeight;
    const chartHeight = chartBottom - padding.top;
    const chartWidth = width - padding.left - padding.right;
    const visible = state.candles.slice(-(width < 600 ? 46 : 68));
    const max = Math.max(...visible.map((item) => item.high));
    const min = Math.min(...visible.map((item) => item.low));
    const range = Math.max(1, max - min);
    const toY = (price) => padding.top + ((max - price) / range) * chartHeight;
    const step = chartWidth / visible.length;
    const barWidth = clamp(step * 0.58, 3, 9);
    const precision = market().precision;

    context.strokeStyle = '#1a2634';
    context.fillStyle = '#617084';
    context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.lineWidth = 1;
    context.textBaseline = 'middle';
    for (let line = 0; line <= 5; line += 1) {
      const y = padding.top + chartHeight / 5 * line;
      context.beginPath();
      context.moveTo(padding.left, y + 0.5);
      context.lineTo(width - padding.right, y + 0.5);
      context.stroke();
      context.fillText(fmt(max - range / 5 * line, precision), width - padding.right + 7, y);
    }
    for (let line = 0; line <= 6; line += 1) {
      const x = padding.left + chartWidth / 6 * line;
      context.beginPath();
      context.moveTo(x + 0.5, padding.top);
      context.lineTo(x + 0.5, height - padding.bottom);
      context.stroke();
    }

    const maxVolume = Math.max(...visible.map((item) => item.volume));
    visible.forEach((item, index) => {
      const x = padding.left + step * index + step / 2;
      const isUp = item.close >= item.open;
      const color = isUp ? '#25d0a6' : '#ff6178';
      context.strokeStyle = color;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, toY(item.high));
      context.lineTo(Math.round(x) + 0.5, toY(item.low));
      context.stroke();
      context.globalAlpha = 0.9;
      context.fillRect(x - barWidth / 2, Math.min(toY(item.open), toY(item.close)), barWidth, Math.max(1.4, Math.abs(toY(item.close) - toY(item.open))));
      context.globalAlpha = 0.18;
      const volumeBar = item.volume / maxVolume * (volumeHeight - 8);
      context.fillRect(x - barWidth / 2, height - padding.bottom - volumeBar, barWidth, volumeBar);
      context.globalAlpha = 1;
    });

    const drawLine = (series, color, widthValue = 1.25) => {
      context.strokeStyle = color;
      context.lineWidth = widthValue;
      context.beginPath();
      series.forEach((price, index) => {
        const x = padding.left + step * index + step / 2;
        const y = toY(price);
        index ? context.lineTo(x, y) : context.moveTo(x, y);
      });
      context.stroke();
    };
    if (state.indicator === 'ema') {
      drawLine(movingAverage(visible, 10), '#7d8cff');
      drawLine(movingAverage(visible, 20), '#d29bf4');
    } else {
      const mid = movingAverage(visible, 20);
      const upper = mid.map((price) => price + range * 0.075);
      const lower = mid.map((price) => price - range * 0.075);
      drawLine(upper, '#7d8cff', 1);
      drawLine(mid, '#d29bf4', 1.2);
      drawLine(lower, '#7d8cff', 1);
    }

    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = '#617084';
    [0, Math.floor((visible.length - 1) / 3), Math.floor((visible.length - 1) * 2 / 3), visible.length - 1]
      .forEach((index) => context.fillText(visible[index].time, padding.left + step * index + step / 2, height - padding.bottom + 7));

    const lastY = toY(state.price);
    const priceUp = state.price >= state.previousPrice;
    context.strokeStyle = priceUp ? '#25d0a6' : '#ff6178';
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(padding.left, lastY + 0.5);
    context.lineTo(width - padding.right, lastY + 0.5);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = priceUp ? '#25d0a6' : '#ff6178';
    context.fillRect(width - padding.right, lastY - 9, padding.right, 18);
    context.fillStyle = '#06120e';
    context.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(fmt(state.price, precision), width - padding.right / 2, lastY);

    if (Number.isInteger(state.pointer)) {
      const index = clamp(state.pointer, 0, visible.length - 1);
      const x = padding.left + step * index + step / 2;
      const y = toY(visible[index].close);
      context.strokeStyle = '#65758a';
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(x, padding.top);
      context.lineTo(x, height - padding.bottom);
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.setLineDash([]);
    }
    canvas.dataset.count = String(visible.length);
    canvas.dataset.step = String(step);
    canvas.dataset.left = String(padding.left);
  }

  function createRuntimeUi() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './enhancements.css';
    document.head.append(link);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="ui-scrim" id="uiScrim" hidden></div>
      <section class="market-picker" id="marketPicker" aria-label="选择交易对" hidden>
        <div class="sheet-handle"></div>
        <header><div><strong>选择交易对</strong><small>模拟现货市场</small></div><button type="button" data-ui-close aria-label="关闭">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button></header>
        <label class="market-search">${svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>')}<input id="marketSearch" type="search" placeholder="搜索 BTC、ETH、SOL" autocomplete="off" /></label>
        <div class="market-list" id="marketList"></div>
      </section>
      <section class="floating-menu" id="floatingMenu" hidden></section>
    `;
    document.querySelector('.app-shell').append(...wrapper.children);

    const navButtons = $$('.primary-nav button');
    ['trade', 'market', 'assets', 'analysis'].forEach((target, index) => {
      if (navButtons[index]) navButtons[index].dataset.navTarget = target;
    });
    const accountTabs = $$('.account-tabs button');
    ['positions', 'orders', 'history'].forEach((view, index) => {
      if (accountTabs[index]) accountTabs[index].dataset.accountView = view;
    });
    const indicators = $$('.chart-tools button').slice(0, 2);
    if (indicators[0]) indicators[0].dataset.indicator = 'ema';
    if (indicators[1]) indicators[1].dataset.indicator = 'boll';
    $('.pair-selector').id = 'pairSelector';
    $('.summary-actions button[aria-label="加入自选"]').id = 'favoriteButton';
    $('.summary-actions button[aria-label="更多"]').dataset.menu = 'more';
    $('.round-action[aria-label="通知"]').dataset.menu = 'notifications';
    $('.avatar').dataset.menu = 'account';
    $('.icon-only[aria-label="图表设置"]').dataset.menu = 'chart';
    $('.icon-only[aria-label="全屏"]').id = 'fullscreenButton';
    $('.panel-menu[aria-label="盘口显示设置"]').dataset.menu = 'book';
  }

  function toast(message) {
    const toastElement = $('#toast');
    toastElement.textContent = message;
    toastElement.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastElement.classList.remove('show'), 2200);
  }

  function closeUi() {
    $('#marketPicker').hidden = true;
    $('#floatingMenu').hidden = true;
    $('#uiScrim').hidden = true;
    document.body.classList.remove('ui-open');
    $$('#marketPicker, #floatingMenu').forEach((element) => element.setAttribute('aria-hidden', 'true'));
  }

  function openMarketPicker() {
    closeSheet();
    renderMarketList('');
    const picker = $('#marketPicker');
    picker.hidden = false;
    picker.setAttribute('aria-hidden', 'false');
    $('#uiScrim').hidden = false;
    document.body.classList.add('ui-open');
    requestAnimationFrame(() => $('#marketSearch').focus({ preventScroll: true }));
  }

  function placeFloatingMenu(trigger, html, label) {
    const menu = $('#floatingMenu');
    menu.innerHTML = `<header><strong>${label}</strong><button type="button" data-ui-close aria-label="关闭">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button></header>${html}`;
    menu.hidden = false;
    menu.setAttribute('aria-hidden', 'false');
    const rect = trigger.getBoundingClientRect();
    const width = 286;
    const left = clamp(rect.right - width, 12, window.innerWidth - width - 12);
    menu.style.setProperty('--menu-left', `${left}px`);
    menu.style.setProperty('--menu-top', `${rect.bottom + 10}px`);
    $('#uiScrim').hidden = false;
    document.body.classList.add('ui-open');
  }

  function menuContent(type) {
    if (type === 'notifications') {
      return `<div class="menu-empty"><span class="menu-icon">${svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>')}</span><b>暂无新通知</b><small>行情连接正常，模拟环境运行中。</small></div>`;
    }
    if (type === 'account') {
      return `<div class="account-card"><span class="account-avatar">AX</span><div><b>模拟账户</b><small>UID · ATX-2026-DEMO</small></div></div><div class="menu-stats"><span>账户权益<b>100,000.00 USDT</b></span><span>账户模式<b>仅本地模拟</b></span></div><button class="menu-action" type="button" data-menu-action="reset">重置模拟数据</button>`;
    }
    if (type === 'more') {
      return `<div class="menu-list"><button type="button" data-menu-action="share">${svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>')}<span><b>分享当前页面</b><small>复制演示页地址</small></span></button><button type="button" data-menu-action="about">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')}<span><b>关于 ATLAS X</b><small>专业数字资产模拟终端</small></span></button></div>`;
    }
    if (type === 'chart') {
      return `<div class="menu-list compact"><button type="button" data-indicator-choice="ema" class="${state.indicator === 'ema' ? 'selected' : ''}"><span><b>EMA 双均线</b><small>EMA 10 / EMA 20</small></span><i></i></button><button type="button" data-indicator-choice="boll" class="${state.indicator === 'boll' ? 'selected' : ''}"><span><b>BOLL 布林带</b><small>20 周期标准通道</small></span><i></i></button></div>`;
    }
    return `<div class="menu-list compact"><button type="button" data-book-choice="all" class="${state.bookMode === 'all' ? 'selected' : ''}"><span><b>全部盘口</b><small>同时显示卖盘和买盘</small></span><i></i></button><button type="button" data-book-choice="asks" class="${state.bookMode === 'asks' ? 'selected' : ''}"><span><b>仅卖盘</b><small>集中观察上方卖单</small></span><i></i></button><button type="button" data-book-choice="bids" class="${state.bookMode === 'bids' ? 'selected' : ''}"><span><b>仅买盘</b><small>集中观察下方买单</small></span><i></i></button></div>`;
  }

  function renderMarketList(query) {
    const normalized = query.trim().toUpperCase();
    const items = Object.values(MARKETS).filter((item) => !normalized || item.symbol.includes(normalized) || item.pair.includes(normalized));
    $('#marketList').innerHTML = items.length ? items.map((item) => `
      <button type="button" class="market-item ${item.symbol === state.market ? 'selected' : ''}" data-market="${item.symbol}">
        <span class="market-coin ${item.iconClass}">${item.icon}</span>
        <span><b>${item.pair}</b><small>现货 · USDT</small></span>
        <span class="market-item-price"><b>${fmtMarket(item.price, item.precision)}</b><small class="${item.change >= 0 ? 'positive' : 'negative'}">${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}%</small></span>
        ${item.symbol === state.market ? svg('<path d="m5 12 4 4L19 6"/>') : ''}
      </button>`).join('') : '<div class="market-no-results">没有匹配的交易对</div>';
  }

  function fmtMarket(value, precision) {
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
  }

  function selectMarket(symbol) {
    if (!MARKETS[symbol]) return;
    state.market = symbol;
    state.price = MARKETS[symbol].price;
    state.previousPrice = state.price;
    state.candles = buildCandles(MARKETS[symbol].seed + timeframeSeed());
    state.pointer = null;
    syncMarketUi();
    buildOrderbook();
    renderAccount();
    saveState();
    closeUi();
    requestAnimationFrame(drawChart);
    toast(`已切换至 ${MARKETS[symbol].pair}`);
  }

  function timeframeSeed() {
    return [...state.timeframe].reduce((total, char) => total + char.charCodeAt(0), 0);
  }

  function syncMarketUi() {
    const current = market();
    $('.coin-icon').textContent = current.icon;
    $('.coin-icon').className = `coin-icon ${current.iconClass}`;
    $('.pair-selector strong').textContent = current.pair;
    $('.market-summary').setAttribute('aria-label', `${current.symbol} 市场摘要`);
    $('#lastPrice').textContent = fmt(state.price);
    $('#spreadPrice').textContent = fmt(state.price);
    $('#mobilePrice').textContent = fmt(state.price);
    $('.mobile-quote span').textContent = current.pair;
    $('#priceUsd').textContent = `≈ $${fmt(state.price, current.precision)}`;
    $('#priceChange').textContent = `${current.change >= 0 ? '+' : ''}${current.change.toFixed(2)}%`;
    $('#priceChange').className = current.change >= 0 ? 'positive' : 'negative';
    const metrics = $$('.market-metrics b');
    [fmtMarket(current.high, current.precision), fmtMarket(current.low, current.precision), current.volume, current.turnover]
      .forEach((value, index) => { if (metrics[index]) metrics[index].textContent = value; });
    const rangeValues = $$('.market-range-values small');
    if (rangeValues[0]) rangeValues[0].textContent = fmtMarket(current.low, current.precision);
    if (rangeValues[1]) rangeValues[1].textContent = fmtMarket(current.high, current.precision);
    $('#limitPrice').value = state.price.toFixed(current.precision);
    $('#chartCanvas').setAttribute('aria-label', `${current.symbol} K线图`);
    $$('.book-columns span:nth-child(2)').forEach((element) => { element.textContent = `数量(${current.symbol})`; });
    $('#estimatedAmount').textContent = `0.000000 ${current.symbol}`;
    $('#submitOrder').textContent = `${state.side === 'buy' ? '买入' : '卖出'} ${current.symbol}`;
    updateFavoriteButton();
  }

  function updateFavoriteButton() {
    const button = $('#favoriteButton');
    const active = state.favoriteMarkets.includes(state.market);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? '移出自选' : '加入自选');
  }

  function toggleFavorite() {
    const set = new Set(state.favoriteMarkets);
    set.has(state.market) ? set.delete(state.market) : set.add(state.market);
    state.favoriteMarkets = [...set];
    updateFavoriteButton();
    saveState();
    toast(set.has(state.market) ? `${market().pair} 已加入自选` : `${market().pair} 已移出自选`);
  }

  function buildOrderbook() {
    const random = seededRandom(Math.round(state.price * 10) + market().seed);
    const mobile = window.innerWidth <= 760;
    const rows = mobile ? 10 : (window.innerHeight < 1000 ? 8 : 10);
    const asks = [];
    const bids = [];
    let askTotal = 0;
    let bidTotal = 0;
    const step = state.price * (market().symbol === 'BTC' ? 0.00015 : 0.00022);
    for (let index = rows; index >= 1; index -= 1) {
      const amount = 0.015 + random() * 0.56;
      askTotal += amount;
      asks.push(`<div class="book-row" style="--depth:${20 + random() * 70}%;--depth-color:rgba(255,97,120,.075)"><span class="ask">${fmt(state.price + index * step)}</span><span>${amount.toFixed(4)}</span><span>${askTotal.toFixed(3)}</span></div>`);
    }
    for (let index = 1; index <= rows; index += 1) {
      const amount = 0.015 + random() * 0.56;
      bidTotal += amount;
      bids.push(`<div class="book-row" style="--depth:${20 + random() * 70}%;--depth-color:rgba(37,208,166,.07)"><span class="bid">${fmt(state.price - index * step)}</span><span>${amount.toFixed(4)}</span><span>${bidTotal.toFixed(3)}</span></div>`);
    }
    $('#askRows').innerHTML = asks.join('');
    $('#bidRows').innerHTML = bids.join('');
    const trades = [];
    const now = Date.now();
    for (let index = 0; index < 18; index += 1) {
      const isUp = random() > 0.46;
      const price = state.price + (random() - 0.5) * step * 4;
      const amount = 0.002 + random() * 0.18;
      const time = new Date(now - index * 7000).toLocaleTimeString('zh-CN', { hour12: false });
      trades.push(`<div class="trade-row"><span class="${isUp ? 'positive' : 'negative'}">${fmt(price)}</span><span>${amount.toFixed(4)}</span><span>${time}</span></div>`);
    }
    $('#tradeRows').innerHTML = trades.join('');
    $('#mobileTradeRows').innerHTML = trades.join('');
    applyBookMode();
  }

  function applyBookMode() {
    const panel = $('.orderbook-panel');
    panel.dataset.bookMode = state.bookMode;
    const label = state.bookMode === 'all' ? '全部盘口' : state.bookMode === 'asks' ? '仅卖盘' : '仅买盘';
    $('.panel-menu').setAttribute('aria-label', `盘口显示设置：${label}`);
  }

  function setBookMode(mode) {
    if (!['all', 'asks', 'bids'].includes(mode)) return;
    state.bookMode = mode;
    applyBookMode();
    saveState();
    closeUi();
    toast(mode === 'all' ? '已显示全部盘口' : mode === 'asks' ? '已切换为仅卖盘' : '已切换为仅买盘');
  }

  function estimate() {
    const amount = Number($('#orderAmount').value || 0);
    const selectedPrice = state.orderType === 'market' ? state.price : Number($('#limitPrice').value || state.price);
    $('#estimatedAmount').textContent = `${(amount / Math.max(selectedPrice, 1)).toFixed(6)} ${market().symbol}`;
    $('#estimatedFee').textContent = `${(amount * 0.0008).toFixed(2)} USDT`;
  }

  function setSide(side) {
    state.side = side === 'sell' ? 'sell' : 'buy';
    $$('#sideTabs [data-side]').forEach((button) => button.classList.toggle('active', button.dataset.side === state.side));
    const submitButton = $('#submitOrder');
    submitButton.className = `submit-order ${state.side}`;
    submitButton.textContent = `${state.side === 'buy' ? '买入' : '卖出'} ${market().symbol}`;
    saveState();
  }

  function setOrderType(type) {
    if (!['market', 'limit', 'trigger'].includes(type)) return;
    state.orderType = type;
    $$('#orderTypeTabs button').forEach((button) => button.classList.toggle('active', button.dataset.orderType === type));
    const priceField = $('.limit-field');
    priceField.hidden = type === 'market';
    const label = $('.limit-field span');
    if (label) label.textContent = type === 'trigger' ? '触发价' : '委托价';
    estimate();
    saveState();
  }

  function openSheet(side) {
    closeUi();
    setSide(side);
    document.body.classList.add('trade-sheet-open');
    $('#sheetBackdrop').hidden = false;
  }

  function closeSheet() {
    document.body.classList.remove('trade-sheet-open');
    window.setTimeout(() => { $('#sheetBackdrop').hidden = true; }, 260);
  }

  function submitOrder() {
    const amount = Number($('#orderAmount').value || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('请输入有效的模拟下单金额');
      $('#orderAmount').focus();
      return;
    }
    const selectedPrice = state.orderType === 'market' ? state.price : Number($('#limitPrice').value || 0);
    if (!Number.isFinite(selectedPrice) || selectedPrice <= 0) {
      toast('请输入有效价格');
      $('#limitPrice').focus();
      return;
    }
    const quantity = amount / selectedPrice;
    const base = {
      id: `ATX-${Date.now()}`,
      market: state.market,
      pair: market().pair,
      symbol: market().symbol,
      side: state.side,
      type: state.orderType,
      quantity,
      price: selectedPrice,
      amount,
      createdAt: new Date().toISOString(),
    };
    if (state.orderType === 'market') {
      const positionIndex = state.positions.findIndex((item) => item.market === state.market && item.side === state.side);
      if (positionIndex >= 0) {
        const position = state.positions[positionIndex];
        const combinedQuantity = position.quantity + quantity;
        position.entry = (position.entry * position.quantity + selectedPrice * quantity) / combinedQuantity;
        position.quantity = combinedQuantity;
      } else {
        state.positions.unshift({ ...base, entry: selectedPrice });
      }
      state.history.unshift({ ...base, status: '已成交' });
      toast('模拟市价单已成交');
    } else {
      state.openOrders.unshift({ ...base, status: state.orderType === 'trigger' ? '等待触发' : '等待成交' });
      toast(state.orderType === 'trigger' ? '模拟止盈止损单已创建' : '模拟限价单已挂单');
      setAccountView('orders');
    }
    state.history = state.history.slice(0, 20);
    state.openOrders = state.openOrders.slice(0, 20);
    $('#orderAmount').value = '';
    $('#amountRange').value = '0';
    estimate();
    renderAccount();
    saveState();
    closeSheet();
  }

  function closePosition(id) {
    const position = state.positions.find((item) => item.id === id);
    if (!position) return;
    state.positions = state.positions.filter((item) => item.id !== id);
    state.history.unshift({ ...position, id: `ATX-${Date.now()}`, price: state.price, status: '已平仓', createdAt: new Date().toISOString() });
    renderAccount();
    saveState();
    toast(`${position.pair} 模拟持仓已平仓`);
  }

  function cancelOrder(id) {
    const order = state.openOrders.find((item) => item.id === id);
    if (!order) return;
    state.openOrders = state.openOrders.filter((item) => item.id !== id);
    state.history.unshift({ ...order, id: `ATX-${Date.now()}`, status: '已撤销', createdAt: new Date().toISOString() });
    renderAccount();
    saveState();
    toast(`${order.pair} 模拟委托已撤销`);
  }

  function setAccountView(view) {
    if (!['positions', 'orders', 'history'].includes(view)) return;
    state.accountView = view;
    $$('.account-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.accountView === view));
    renderAccount();
    saveState();
  }

  function emptyAccountRow(title, detail) {
    return `<tr class="empty-row"><td colspan="7"><div class="empty-state"><span class="empty-icon">${svg('<path d="M5 12h14M12 5v14"/>')}</span><b>${title}</b><small>${detail}</small></div></td></tr>`;
  }

  function renderAccount() {
    const body = $('#accountBody');
    const headers = $('.account-table thead tr');
    const tabs = $$('.account-tabs button');
    if (tabs[0]) tabs[0].querySelector('span').textContent = String(state.positions.length);
    if (tabs[1]) tabs[1].querySelector('span').textContent = String(state.openOrders.length);

    if (state.accountView === 'positions') {
      headers.innerHTML = '<th>交易对</th><th>方向</th><th>持仓数量</th><th>开仓均价</th><th>标记价格</th><th>未实现盈亏</th><th>操作</th>';
      body.innerHTML = state.positions.length ? state.positions.map((item) => {
        const mark = item.market === state.market ? state.price : MARKETS[item.market]?.price || item.entry;
        const pnl = (mark - item.entry) * item.quantity * (item.side === 'buy' ? 1 : -1);
        return `<tr><td data-label="交易对"><strong>${item.pair}</strong></td><td data-label="方向" class="${item.side === 'buy' ? 'positive' : 'negative'}">${item.side === 'buy' ? '买入' : '卖出'}</td><td data-label="持仓数量">${item.quantity.toFixed(6)} ${item.symbol}</td><td data-label="开仓均价">${fmtMarket(item.entry, MARKETS[item.market].precision)}</td><td data-label="标记价格">${fmtMarket(mark, MARKETS[item.market].precision)}</td><td data-label="未实现盈亏" class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT</td><td data-label="操作"><button class="close-position" type="button" data-close-position="${item.id}">平仓</button></td></tr>`;
      }).join('') : emptyAccountRow('暂无持仓', '完成一笔模拟市价单后，持仓与实时盈亏会显示在这里。');
    } else if (state.accountView === 'orders') {
      headers.innerHTML = '<th>交易对</th><th>方向</th><th>类型</th><th>委托数量</th><th>委托价格</th><th>状态</th><th>操作</th>';
      body.innerHTML = state.openOrders.length ? state.openOrders.map((item) => `<tr><td data-label="交易对"><strong>${item.pair}</strong></td><td data-label="方向" class="${item.side === 'buy' ? 'positive' : 'negative'}">${item.side === 'buy' ? '买入' : '卖出'}</td><td data-label="类型">${item.type === 'limit' ? '限价' : '止盈止损'}</td><td data-label="委托数量">${item.quantity.toFixed(6)} ${item.symbol}</td><td data-label="委托价格">${fmtMarket(item.price, MARKETS[item.market].precision)}</td><td data-label="状态">${item.status}</td><td data-label="操作"><button class="close-position" type="button" data-cancel-order="${item.id}">撤单</button></td></tr>`).join('') : emptyAccountRow('暂无当前委托', '限价单和止盈止损单会显示在这里。');
    } else {
      headers.innerHTML = '<th>时间</th><th>交易对</th><th>方向</th><th>类型</th><th>数量</th><th>价格</th><th>状态</th>';
      body.innerHTML = state.history.length ? state.history.map((item) => `<tr><td data-label="时间">${new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td data-label="交易对"><strong>${item.pair}</strong></td><td data-label="方向" class="${item.side === 'buy' ? 'positive' : 'negative'}">${item.side === 'buy' ? '买入' : '卖出'}</td><td data-label="类型">${item.type === 'market' ? '市价' : item.type === 'limit' ? '限价' : '止盈止损'}</td><td data-label="数量">${item.quantity.toFixed(6)} ${item.symbol}</td><td data-label="价格">${fmtMarket(item.price, MARKETS[item.market].precision)}</td><td data-label="状态">${item.status}</td></tr>`).join('') : emptyAccountRow('暂无历史成交', '完成或撤销模拟订单后，记录会显示在这里。');
    }
    const equity = 100000 + state.positions.reduce((total, item) => {
      const mark = item.market === state.market ? state.price : MARKETS[item.market]?.price || item.entry;
      return total + (mark - item.entry) * item.quantity * (item.side === 'buy' ? 1 : -1);
    }, 0);
    const summary = $$('.account-summary b');
    if (summary[0]) summary[0].textContent = `${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
    if (summary[1]) {
      const pnl = equity - 100000;
      summary[1].textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`;
      summary[1].className = pnl >= 0 ? 'positive' : 'negative';
    }
  }

  function setIndicator(indicator) {
    state.indicator = indicator === 'boll' ? 'boll' : 'ema';
    $$('[data-indicator]').forEach((button) => button.classList.toggle('active', button.dataset.indicator === state.indicator));
    $('.chart-info-bar span:first-child').firstChild.textContent = state.indicator === 'ema' ? 'EMA(10) ' : 'BOLL(UP) ';
    $('.chart-info-bar span:nth-child(2)').firstChild.textContent = state.indicator === 'ema' ? 'EMA(20) ' : 'BOLL(DN) ';
    saveState();
    closeUi();
    drawChart();
    toast(state.indicator === 'ema' ? '已切换至 EMA 双均线' : '已切换至 BOLL 布林带');
  }

  async function toggleFullscreen() {
    try {
      const target = $('.chart-panel');
      if (!document.fullscreenElement) await target.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      toast('当前浏览器不支持图表全屏');
    }
  }

  function setMobileView(view) {
    state.mobileView = view;
    $$('[data-mobile-view]').forEach((button) => button.classList.toggle('active', button.dataset.mobileView === view));
    $$('[data-mobile-panel]').forEach((panel) => panel.classList.toggle('mobile-active', panel.dataset.mobilePanel === view));
    saveState();
    requestAnimationFrame(drawChart);
  }

  function handleChartPointer(event) {
    const canvas = $('#chartCanvas');
    const rect = canvas.getBoundingClientRect();
    const x = (event.touches?.[0]?.clientX ?? event.clientX) - rect.left;
    const step = Number(canvas.dataset.step || 1);
    const left = Number(canvas.dataset.left || 0);
    const count = Number(canvas.dataset.count || 1);
    state.pointer = clamp(Math.floor((x - left) / step), 0, count - 1);
    const candle = state.candles.slice(-count)[state.pointer];
    if (candle) {
      const tooltip = $('#chartTooltip');
      const change = (candle.close - candle.open) / candle.open * 100;
      $('#tooltipTime').textContent = `${state.timeframe} · ${candle.time}`;
      $('#tooltipPrice').textContent = fmt(candle.close);
      $('#tooltipChange').textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
      $('#tooltipChange').className = change >= 0 ? 'positive' : 'negative';
      tooltip.hidden = false;
      tooltip.style.left = `${clamp(x + 12, 8, rect.width - 132)}px`;
      tooltip.style.top = '12px';
    }
    drawChart();
  }

  function clearChartPointer() {
    state.pointer = null;
    $('#chartTooltip').hidden = true;
    drawChart();
  }

  function updatePrice() {
    state.previousPrice = state.price;
    const step = state.price * (market().symbol === 'BTC' ? 0.00024 : market().symbol === 'ETH' ? 0.00038 : 0.00058);
    state.price += (Math.random() > 0.46 ? 1 : -1) * (step * (0.4 + Math.random()));
    const isUp = state.price >= state.previousPrice;
    for (const id of ['lastPrice', 'spreadPrice', 'mobilePrice']) $(`#${id}`).textContent = fmt(state.price);
    $('#priceUsd').textContent = `≈ $${fmt(state.price)}`;
    $('#limitPrice').value = state.price.toFixed(market().precision);
    $('#spreadPrice').className = isUp ? 'positive' : 'negative';
    const last = state.candles.at(-1);
    last.close = state.price;
    last.high = Math.max(last.high, state.price);
    last.low = Math.min(last.low, state.price);
    estimate();
    buildOrderbook();
    renderAccount();
    drawChart();
  }

  function handleMenuAction(action) {
    if (action === 'reset') {
      state.positions = [];
      state.openOrders = [];
      state.history = [];
      renderAccount();
      saveState();
      closeUi();
      toast('模拟账户数据已重置');
    } else if (action === 'share') {
      const copy = navigator.clipboard?.writeText(location.href);
      Promise.resolve(copy).then(() => toast('演示页地址已复制')).catch(() => toast('请从浏览器地址栏复制页面地址'));
      closeUi();
    } else if (action === 'about') {
      closeUi();
      toast('ATLAS X · 专业数字资产模拟交易终端');
    }
  }

  function bindEvents() {
    $('#pairSelector').addEventListener('click', openMarketPicker);
    $('#marketSearch').addEventListener('input', (event) => renderMarketList(event.target.value));
    $('#marketList').addEventListener('click', (event) => {
      const item = event.target.closest('[data-market]');
      if (item) selectMarket(item.dataset.market);
    });
    $('#favoriteButton').addEventListener('click', toggleFavorite);

    $$('.primary-nav button').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.navTarget === 'trade') return;
      toast(`${button.textContent.trim()}模块将在后续阶段开放`);
    }));

    $$('[data-menu]').forEach((button) => button.addEventListener('click', () => {
      closeSheet();
      placeFloatingMenu(button, menuContent(button.dataset.menu), button.dataset.menu === 'notifications' ? '通知' : button.dataset.menu === 'account' ? '账户' : button.dataset.menu === 'chart' ? '图表设置' : button.dataset.menu === 'book' ? '盘口设置' : '更多');
    }));
    $('#floatingMenu').addEventListener('click', (event) => {
      const action = event.target.closest('[data-menu-action]');
      const indicator = event.target.closest('[data-indicator-choice]');
      const book = event.target.closest('[data-book-choice]');
      if (action) handleMenuAction(action.dataset.menuAction);
      if (indicator) setIndicator(indicator.dataset.indicatorChoice);
      if (book) setBookMode(book.dataset.bookChoice);
    });
    $('#uiScrim').addEventListener('click', closeUi);
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-ui-close]')) closeUi();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeUi();
        closeSheet();
      }
    });

    $$('#timeframes button').forEach((button) => button.addEventListener('click', () => {
      state.timeframe = button.dataset.timeframe;
      $$('#timeframes button').forEach((item) => item.classList.toggle('active', item === button));
      state.candles = buildCandles(market().seed + timeframeSeed());
      saveState();
      drawChart();
    }));
    $$('[data-indicator]').forEach((button) => button.addEventListener('click', () => setIndicator(button.dataset.indicator)));
    $('#fullscreenButton').addEventListener('click', toggleFullscreen);

    $$('#bookTabs button').forEach((button) => button.addEventListener('click', () => {
      $$('#bookTabs button').forEach((item) => item.classList.toggle('active', item === button));
      $$('[data-book-view]').forEach((view) => view.classList.toggle('active', view.dataset.bookView === button.dataset.bookTab));
    }));

    $$('[data-mobile-view]').forEach((button) => button.addEventListener('click', () => setMobileView(button.dataset.mobileView)));
    $$('[data-mobile-side]').forEach((button) => button.addEventListener('click', () => openSheet(button.dataset.mobileSide)));
    $$('#sideTabs [data-side]').forEach((button) => button.addEventListener('click', () => setSide(button.dataset.side)));
    $$('#orderTypeTabs button').forEach((button) => button.addEventListener('click', () => setOrderType(button.dataset.orderType)));
    $('#orderAmount').addEventListener('input', estimate);
    $('#limitPrice').addEventListener('input', estimate);
    $('#amountRange').addEventListener('input', (event) => {
      $('#orderAmount').value = event.target.value ? (100000 * Number(event.target.value) / 100).toFixed(2) : '';
      estimate();
    });
    $('#submitOrder').addEventListener('click', submitOrder);
    $('#sheetClose').addEventListener('click', closeSheet);
    $('#sheetBackdrop').addEventListener('click', closeSheet);

    $$('.account-tabs button').forEach((button) => button.addEventListener('click', () => setAccountView(button.dataset.accountView)));
    $('#accountBody').addEventListener('click', (event) => {
      const close = event.target.closest('[data-close-position]');
      const cancel = event.target.closest('[data-cancel-order]');
      if (close) closePosition(close.dataset.closePosition);
      if (cancel) cancelOrder(cancel.dataset.cancelOrder);
    });

    $('#chartCanvas').addEventListener('mousemove', handleChartPointer);
    $('#chartCanvas').addEventListener('mouseleave', clearChartPointer);
    $('#chartCanvas').addEventListener('touchstart', handleChartPointer, { passive: true });
    $('#chartCanvas').addEventListener('touchmove', handleChartPointer, { passive: true });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        closeUi();
        buildOrderbook();
        drawChart();
      }, 110);
    });
  }

  function init() {
    loadState();
    createRuntimeUi();
    state.price = market().price;
    state.previousPrice = state.price;
    state.candles = buildCandles(market().seed + timeframeSeed());
    bindEvents();
    $$('#timeframes button').forEach((button) => button.classList.toggle('active', button.dataset.timeframe === state.timeframe));
    syncMarketUi();
    setSide(state.side);
    setOrderType(state.orderType);
    setIndicator(state.indicator);
    setMobileView(state.mobileView);
    applyBookMode();
    buildOrderbook();
    renderAccount();
    estimate();
    requestAnimationFrame(drawChart);
    setInterval(updatePrice, 3600);
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
