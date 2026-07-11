(() => {
  'use strict';
  if (window.__ATLAS_REALTIME_MARKET_INTEGRATION__) return;
  window.__ATLAS_REALTIME_MARKET_INTEGRATION__ = true;

  const engine = window.AtlasMarketDataEngine;
  const chartModel = window.AtlasChartExperience;
  if (!engine || !chartModel) {
    console.error('ATLAS realtime modules failed to load before integration');
    return;
  }

  const CORE_KEY = 'atlasX.pro.v1';
  const ALL_INTERVALS = [
    ['1m','1m'],['3m','3m'],['5m','5m'],['15m','15m'],['30m','30m'],
    ['1h','1H'],['2h','2H'],['4h','4H'],['6h','6H'],['12h','12H'],['1d','1D'],['1w','1W'],
  ];
  const relaySockets = new Set();
  const previousFetch = window.fetch.bind(window);
  const PreviousWebSocket = window.WebSocket;
  let currentState = engine.getState();
  let selectionRenderQueued = false;
  let countdownTimer = null;
  let domReady = false;

  function restoredSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(CORE_KEY) || '{}');
      const symbol = String(saved.activeSymbol || 'BTCUSDT').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const interval = ALL_INTERVALS.some(([value]) => value === saved.timeframe) ? saved.timeframe : '1h';
      return { symbol: symbol || 'BTCUSDT', interval };
    } catch {
      return { symbol: 'BTCUSDT', interval: '1h' };
    }
  }

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function waitForCurrentCandles(signal, timeoutMs = 4300) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      const state = engine.getState();
      if (Array.isArray(state.candles) && state.candles.length >= 20 && !state.loading) return state.candles;
      await sleep(25);
    }
    const state = engine.getState();
    if (Array.isArray(state.candles) && state.candles.length >= 20) return state.candles;
    throw new DOMException('Realtime candle bootstrap timed out', 'TimeoutError');
  }

  function isLegacyKlineRequest(input) {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input?.url, location.href);
      return /\/api\/v3\/klines$/.test(url.pathname) && /binance\./.test(url.hostname);
    } catch {
      return false;
    }
  }

  window.fetch = async (input, init = {}) => {
    if (!isLegacyKlineRequest(input)) return previousFetch(input, init);
    const candles = await waitForCurrentCandles(init?.signal);
    const rows = candles.map(candle => [
      Number(candle.time), String(candle.open), String(candle.high), String(candle.low), String(candle.close),
      String(candle.volume || 0), Number(candle.closeTime || (candle.time + engine.intervalMs(engine.getState().interval) - 1)),
      String(candle.quoteVolume || Number(candle.volume || 0) * Number(candle.close || 0)),
      Number(candle.trades || 0), '0', '0', '0',
    ]);
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Atlas-Market-Source': engine.getState().source },
    });
  };

  function dispatchRelay(socket, type, event) {
    socket.dispatchEvent(event);
    const handler = socket[`on${type}`];
    if (typeof handler === 'function') handler.call(socket, event);
  }

  function streamNames(url) {
    try {
      const parsed = new URL(url);
      const combined = parsed.searchParams.get('streams');
      if (combined) return combined.split('/').filter(Boolean);
      const path = parsed.pathname.split('/').filter(Boolean).at(-1);
      return path ? [path] : [];
    } catch {
      return [];
    }
  }

  function tickerPacket(state, stream) {
    const ticker = state.ticker || {};
    const receivedAt = Number(state.lastReceivedAt) || Date.now();
    return {
      stream,
      data: {
        e: '24hrTicker', E: Number(state.lastServerTime) || receivedAt, s: state.symbol,
        c: String(ticker.price || 0), o: String(ticker.open || ticker.price || 0),
        h: String(ticker.high || ticker.price || 0), l: String(ticker.low || ticker.price || 0),
        v: String(ticker.volume || 0), q: String(ticker.quoteVolume || 0), P: String(ticker.change || 0),
        b: String(ticker.bid || ticker.price || 0), a: String(ticker.ask || ticker.price || 0),
      },
    };
  }

  function relayPayloads(socket, state, event) {
    if (!state?.ticker?.price) return [];
    const names = streamNames(socket.url);
    const lower = state.symbol.toLowerCase();
    const payloads = [];
    for (const name of names) {
      if (name === '!miniTicker@arr') {
        const ticker = state.ticker;
        payloads.push([{ s: state.symbol, c: String(ticker.price), o: String(ticker.open || ticker.price), h: String(ticker.high || ticker.price), l: String(ticker.low || ticker.price), v: String(ticker.volume || 0), q: String(ticker.quoteVolume || 0) }]);
      } else if (name === `${lower}@ticker` || name.endsWith('@ticker')) {
        payloads.push(tickerPacket(state, name));
      } else if (name.includes('@depth')) {
        payloads.push({ stream: name, data: { lastUpdateId: Number(state.book?.sequence) || Date.now(), bids: (state.book?.bids || []).map(row => [String(row[0]), String(row[1])]), asks: (state.book?.asks || []).map(row => [String(row[0]), String(row[1])]) } });
      } else if (name.includes('@aggTrade')) {
        const trade = state.trades?.[0];
        if (trade) payloads.push({ stream: name, data: { e: 'aggTrade', E: Number(state.lastServerTime) || Date.now(), s: state.symbol, a: Number(String(trade.id).replace(/\D/g, '')) || Date.now(), p: String(trade.price), q: String(trade.qty), T: Number(trade.time) || Date.now(), m: trade.side === 'sell' } });
      } else if (name.includes('@kline_')) {
        const candle = state.candles?.at(-1);
        if (candle) payloads.push({ stream: name, data: { e: 'kline', E: Number(state.lastServerTime) || Date.now(), s: state.symbol, k: { t: Number(candle.time), T: Number(candle.closeTime), s: state.symbol, i: state.interval, o: String(candle.open), c: String(candle.close), h: String(candle.high), l: String(candle.low), v: String(candle.volume || 0), q: String(candle.quoteVolume || 0), n: Number(candle.trades || 0), x: Boolean(candle.closed) } } });
      }
    }
    if (event?.type === 'ticker' && !payloads.some(payload => payload?.stream?.includes('@ticker'))) payloads.push(tickerPacket(state, `${lower}@ticker`));
    return payloads;
  }

  class AtlasLegacyMarketSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = AtlasLegacyMarketSocket.CONNECTING;
      this.protocol = '';
      this.extensions = '';
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      relaySockets.add(this);
      queueMicrotask(() => {
        if (this.readyState !== AtlasLegacyMarketSocket.CONNECTING) return;
        this.readyState = AtlasLegacyMarketSocket.OPEN;
        dispatchRelay(this, 'open', new Event('open'));
        broadcastToSocket(this, currentState, { type: 'bootstrap' });
      });
    }
    send() {}
    close(code = 1000, reason = 'Legacy market relay closed') {
      if (this.readyState === AtlasLegacyMarketSocket.CLOSED) return;
      this.readyState = AtlasLegacyMarketSocket.CLOSING;
      relaySockets.delete(this);
      this.readyState = AtlasLegacyMarketSocket.CLOSED;
      dispatchRelay(this, 'close', new CloseEvent('close', { code, reason, wasClean: true }));
    }
  }

  function broadcastToSocket(socket, state, event) {
    if (socket.readyState !== AtlasLegacyMarketSocket.OPEN) return;
    relayPayloads(socket, state, event).forEach(payload => {
      dispatchRelay(socket, 'message', new MessageEvent('message', { data: JSON.stringify(payload), origin: location.origin }));
    });
  }

  window.WebSocket = AtlasLegacyMarketSocket;
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;
  window.__ATLAS_PREVIOUS_WEBSOCKET__ = PreviousWebSocket;

  function formatNumber(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    const resolved = digits ?? (Math.abs(number) >= 1000 ? 2 : Math.abs(number) >= 1 ? 4 : 6);
    return number.toLocaleString('en-US', { minimumFractionDigits: resolved, maximumFractionDigits: resolved });
  }

  function compactNumber(value) {
    const number = Number(value) || 0;
    const abs = Math.abs(number);
    if (abs >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
    return formatNumber(number, 2);
  }

  function ensureRealtimeUi() {
    if (domReady) return;
    const timeframes = document.querySelector('#timeframes');
    const stage = document.querySelector('#chartStage');
    const strip = document.querySelector('#ohlcStrip');
    if (!timeframes || !stage || !strip) return;

    timeframes.innerHTML = ALL_INTERVALS.map(([value, label]) => `<button type="button" data-timeframe="${value}">${label}</button>`).join('');

    if (!document.querySelector('#marketConnectionState')) {
      const status = document.createElement('span');
      status.className = 'market-connection-state';
      status.id = 'marketConnectionState';
      status.dataset.state = 'booting';
      status.innerHTML = '<i></i><b>连接中</b>';
      strip.append(status);
    }
    if (!document.querySelector('#marketDataAge')) {
      const age = document.createElement('span');
      age.id = 'marketDataAge';
      age.className = 'market-data-age';
      age.textContent = '等待行情';
      strip.append(age);
    }
    if (!document.querySelector('#chartCountdown')) {
      const countdown = document.createElement('span');
      countdown.id = 'chartCountdown';
      countdown.className = 'chart-countdown';
      countdown.textContent = '00:00';
      strip.append(countdown);
    }

    if (!document.querySelector('#chartCandleDetail')) {
      const detail = document.createElement('aside');
      detail.id = 'chartCandleDetail';
      detail.className = 'chart-candle-detail';
      detail.hidden = true;
      detail.setAttribute('aria-live', 'polite');
      detail.innerHTML = `
        <header><div><strong id="detailTime">--</strong><small id="detailInterval">--</small></div><button type="button" data-clear-candle-selection aria-label="关闭K线详情">×</button></header>
        <div class="candle-detail-grid">
          <span>开盘<b id="detailOpen">--</b></span><span>最高<b id="detailHigh">--</b></span>
          <span>最低<b id="detailLow">--</b></span><span>收盘<b id="detailClose">--</b></span>
          <span>涨跌额<b id="detailChangeAmount">--</b></span><span>涨跌幅<b id="detailChangePercent">--</b></span>
          <span>振幅<b id="detailAmplitude">--</b></span><span>成交量<b id="detailVolume">--</b></span>
          <span>成交额<b id="detailQuoteVolume">--</b></span><span>EMA10<b id="detailEma10">--</b></span>
          <span>EMA20<b id="detailEma20">--</b></span><span>数据源<b id="detailProvider">--</b></span>
        </div><footer><span id="detailStatus">--</span><span id="detailReceivedAt">--</span></footer>`;
      stage.append(detail);
    }

    if (!document.querySelector('#chartExtremaLayer')) {
      const layer = document.createElement('div');
      layer.id = 'chartExtremaLayer';
      layer.className = 'chart-extrema-layer';
      layer.setAttribute('aria-hidden', 'false');
      layer.innerHTML = '<span class="chart-extrema-label" data-kind="high"></span><span class="chart-extrema-label" data-kind="low"></span>';
      stage.append(layer);
    }
    if (!document.querySelector('#chartGoLatest')) {
      const latest = document.createElement('button');
      latest.id = 'chartGoLatest';
      latest.className = 'chart-go-latest';
      latest.type = 'button';
      latest.hidden = true;
      latest.textContent = '回到最新';
      stage.append(latest);
    }
    domReady = true;
    document.documentElement.dataset.realtimeMarketIntegration = 'ready';
  }

  function connectionText(connectionState) {
    return ({ booting: '连接中', live: '实时', reconnecting: '重连中', stale: '数据已过期', offline: '离线' })[connectionState] || '连接中';
  }

  function renderStatus(state) {
    ensureRealtimeUi();
    const connection = document.querySelector('#marketConnectionState');
    if (connection) {
      connection.dataset.state = state.connectionState;
      const label = connection.querySelector('b');
      if (label) label.textContent = connectionText(state.connectionState);
    }
    const age = document.querySelector('#marketDataAge');
    if (age) {
      const milliseconds = Math.max(0, Date.now() - Number(state.lastReceivedAt || 0));
      age.textContent = state.lastReceivedAt ? (milliseconds < 1000 ? '刚刚更新' : `${Math.floor(milliseconds / 1000)}秒前`) : '等待行情';
    }
    const loading = document.querySelector('#chartLoading');
    if (loading) {
      loading.dataset.loading = state.loading ? 'true' : 'false';
      loading.classList.toggle('hidden', !state.loading && state.candles.length > 0);
      const text = loading.querySelector('span');
      if (text) text.textContent = state.loading && state.candles.length ? '正在切换周期' : state.loading ? '连接实时行情' : '';
    }
    document.querySelectorAll('[data-timeframe]').forEach(button => button.classList.toggle('active', button.dataset.timeframe === state.interval));
    const feedLabel = document.querySelector('#chartFeedLabel');
    if (feedLabel) feedLabel.textContent = connectionText(state.connectionState);
    const feedStatus = document.querySelector('#feedStatus span');
    if (feedStatus) feedStatus.textContent = connectionText(state.connectionState);
    const source = document.querySelector('#chartSource');
    if (source) {
      const provider = state.provider ? state.provider.toUpperCase() : 'PUBLIC';
      source.textContent = `${provider} 公开行情 · 本地模拟撮合`;
    }
  }

  function visibleEngineCandles() {
    const canvas = document.querySelector('#chartCanvas');
    const count = Math.max(1, Number(canvas?.dataset.count) || Math.min(78, currentState.candles.length));
    return currentState.candles.slice(-count);
  }

  function selectedIndexFromPointer(event) {
    const canvas = document.querySelector('#chartCanvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Number(event.clientX) - rect.left;
    const left = Number(canvas.dataset.left) || 9;
    const step = Number(canvas.dataset.step) || 1;
    const count = Number(canvas.dataset.count) || visibleEngineCandles().length;
    if (x < left || x > left + step * count) return null;
    return Math.max(0, Math.min(count - 1, Math.floor((x - left) / step)));
  }

  function renderDetail() {
    if (!domReady) return;
    const detail = document.querySelector('#chartCandleDetail');
    if (!detail) return;
    const selection = chartModel.getSelection();
    const candles = visibleEngineCandles();
    const values = selection ? chartModel.metrics(candles, selection.index) : null;
    if (!values) {
      detail.hidden = true;
      document.querySelector('#chartCrosshairInfo')?.setAttribute('hidden', '');
      return;
    }
    const interval = currentState.interval;
    const date = new Date(values.time);
    const changeClass = values.changeAmount >= 0 ? 'positive' : 'negative';
    const set = (selector, text, className) => {
      const element = detail.querySelector(selector);
      if (!element) return;
      element.textContent = text;
      if (className) element.className = className;
    };
    set('#detailTime', date.toLocaleString('zh-CN', { hour12: false }));
    set('#detailInterval', `${interval.toUpperCase()} · ${values.closed ? '已收盘' : '形成中'}`);
    set('#detailOpen', formatNumber(values.open));
    set('#detailHigh', formatNumber(values.high));
    set('#detailLow', formatNumber(values.low));
    set('#detailClose', formatNumber(values.close));
    set('#detailChangeAmount', `${values.changeAmount >= 0 ? '+' : ''}${formatNumber(values.changeAmount)}`, changeClass);
    set('#detailChangePercent', `${values.changePercent >= 0 ? '+' : ''}${values.changePercent.toFixed(2)}%`, changeClass);
    set('#detailAmplitude', `${values.amplitude.toFixed(2)}%`);
    set('#detailVolume', compactNumber(values.volume));
    set('#detailQuoteVolume', compactNumber(values.quoteVolume));
    set('#detailEma10', formatNumber(values.ema10));
    set('#detailEma20', formatNumber(values.ema20));
    set('#detailProvider', String(values.provider || currentState.provider || '--').toUpperCase());
    set('#detailStatus', values.closed ? '已收盘' : '实时更新中');
    set('#detailReceivedAt', currentState.lastReceivedAt ? `接收 ${new Date(currentState.lastReceivedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '--');
    detail.hidden = false;
    const canvas = document.querySelector('#chartCanvas');
    const stage = document.querySelector('#chartStage');
    const step = Number(canvas?.dataset.step) || 1;
    const left = Number(canvas?.dataset.left) || 9;
    const x = left + step * values.index + step / 2;
    const detailWidth = detail.getBoundingClientRect().width || 280;
    const stageWidth = stage?.getBoundingClientRect().width || window.innerWidth;
    detail.style.left = `${Math.max(8, Math.min(stageWidth - detailWidth - 8, x + 14))}px`;
    detail.style.top = '10px';
    document.querySelector('#chartCrosshairInfo')?.setAttribute('hidden', '');
  }

  function renderExtrema() {
    if (!domReady) return;
    const canvas = document.querySelector('#chartCanvas');
    const stage = document.querySelector('#chartStage');
    if (!canvas || !stage) return;
    const candles = visibleEngineCandles();
    const extrema = chartModel.extrema(candles);
    const max = Number(canvas.dataset.max);
    const min = Number(canvas.dataset.min);
    const top = Number(canvas.dataset.top) || 14;
    const priceHeight = Number(canvas.dataset.priceHeight) || Math.max(100, canvas.clientHeight - 100);
    const left = Number(canvas.dataset.left) || 9;
    const step = Number(canvas.dataset.step) || 1;
    const range = Math.max(Number.EPSILON, max - min);
    const position = (kind, point) => {
      const label = document.querySelector(`.chart-extrema-label[data-kind="${kind}"]`);
      if (!label || !point) return;
      const x = left + step * point.index + step / 2;
      const y = top + (max - point.value) / range * priceHeight;
      label.textContent = formatNumber(point.value);
      label.style.left = `${Math.max(4, Math.min(stage.clientWidth - 90, x))}px`;
      label.style.top = `${Math.max(4, Math.min(stage.clientHeight - 30, y))}px`;
    };
    position('high', extrema.high);
    position('low', extrema.low);
  }

  function renderCountdown() {
    const element = document.querySelector('#chartCountdown');
    const candle = currentState.candles?.at(-1);
    if (!element || !candle) return;
    element.textContent = chartModel.countdown(candle, currentState.interval, Date.now()).text;
  }

  function scheduleChartProjection() {
    if (selectionRenderQueued) return;
    selectionRenderQueued = true;
    requestAnimationFrame(() => {
      selectionRenderQueued = false;
      renderDetail();
      renderExtrema();
      renderCountdown();
    });
  }

  function clearSelection(reason) {
    chartModel.clear(reason);
    scheduleChartProjection();
  }

  function bindDom() {
    ensureRealtimeUi();
    renderStatus(currentState);
    scheduleChartProjection();
    const canvas = document.querySelector('#chartCanvas');
    if (canvas && !canvas.dataset.realtimeSelectionBound) {
      canvas.dataset.realtimeSelectionBound = 'true';
      canvas.addEventListener('click', event => {
        const index = selectedIndexFromPointer(event);
        if (index === null) clearSelection('plot-blank');
        else chartModel.select(index, 'click');
        scheduleChartProjection();
      });
      canvas.addEventListener('pointerdown', event => {
        if (event.button === 0 && chartModel.getSelection()) clearSelection('drag-start');
      }, { capture: true });
    }
    document.addEventListener('click', event => {
      if (event.target.closest('[data-clear-candle-selection]')) {
        clearSelection('close-button');
        return;
      }
      if (event.target.closest('#chartGoLatest')) {
        clearSelection('go-latest');
        document.querySelector('#chartReset')?.click();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') clearSelection('escape');
    }, { capture: true });
    document.addEventListener('fullscreenchange', () => clearSelection('fullscreen'));
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      renderStatus(currentState);
      renderCountdown();
    }, 500);
  }

  document.addEventListener('click', event => {
    const timeframe = event.target.closest('[data-timeframe]')?.dataset.timeframe;
    if (timeframe && timeframe !== engine.getState().interval) {
      clearSelection('interval-switch');
      engine.switchSession({ interval: timeframe }).catch(() => {});
    }
    const symbol = event.target.closest('[data-symbol]')?.dataset.symbol;
    if (symbol && symbol !== engine.getState().symbol) {
      clearSelection('symbol-switch');
      engine.switchSession({ symbol }).catch(() => {});
    }
    if (event.target.closest('#chartReset')) clearSelection('reset');
  }, { capture: true });

  engine.subscribe((state, event) => {
    currentState = state;
    relaySockets.forEach(socket => broadcastToSocket(socket, state, event));
    if (domReady) {
      renderStatus(state);
      scheduleChartProjection();
    }
  });
  window.addEventListener('atlas:chart-selection', scheduleChartProjection);

  const session = restoredSession();
  engine.start(session).catch(() => {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindDom, { once: true });
  else bindDom();
})();
