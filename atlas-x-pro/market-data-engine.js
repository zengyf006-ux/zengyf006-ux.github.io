(() => {
  'use strict';
  if (window.AtlasMarketDataEngine) return;

  const VERSION = 'atlas.market.client.v1';
  const GATEWAY = 'https://vtcunypvhtudragsittb.supabase.co/functions/v1/atlas-market-gateway';
  const INTERVAL_MS = Object.freeze({
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
    '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
    '1d': 86_400_000, '1w': 604_800_000,
  });
  const nativeNetwork = window.__ATLAS_NATIVE_NETWORK__ || {};
  const NativeFetch = nativeNetwork.fetch || window.fetch.bind(window);
  const NativeWebSocket = nativeNetwork.WebSocket || window.WebSocket;
  const NativeEventSource = window.EventSource;
  const listeners = new Set();
  let activeAbort = null;
  let realtimeCleanup = null;
  let freshnessTimer = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let started = false;

  const state = {
    version: VERSION,
    sessionId: '',
    requestGeneration: 0,
    symbol: 'BTCUSDT',
    interval: '1h',
    connectionState: 'booting',
    provider: '',
    lastServerTime: 0,
    lastReceivedAt: 0,
    latencyMs: 0,
    staleForMs: 0,
    ticker: null,
    book: { bids: [], asks: [], sequence: 0 },
    trades: [],
    candles: [],
    source: 'cache',
    loading: false,
    error: '',
  };

  const clone = value => {
    try { return structuredClone(value); }
    catch { return JSON.parse(JSON.stringify(value)); }
  };
  const snapshotState = () => Object.freeze(clone(state));
  const validInterval = interval => Object.prototype.hasOwnProperty.call(INTERVAL_MS, interval);
  const normalizeSymbol = value => String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const cacheKey = (symbol, interval) => `${symbol}:${interval}`;
  const now = () => Date.now();

  function emit(type, detail = {}) {
    const event = { type, at: now(), ...detail };
    const current = snapshotState();
    listeners.forEach(listener => {
      try { listener(current, event); } catch (error) { queueMicrotask(() => { throw error; }); }
    });
    window.dispatchEvent(new CustomEvent('atlas:market-state', { detail: { state: current, event } }));
  }

  function setState(patch, type = 'state', detail = {}) {
    Object.assign(state, patch);
    document.documentElement.dataset.activeMarketInterval = state.interval;
    document.documentElement.dataset.marketConnectionState = state.connectionState;
    emit(type, detail);
  }

  function intervalMs(interval) {
    const value = INTERVAL_MS[interval];
    if (!value) throw new RangeError(`Unsupported market interval: ${interval}`);
    return value;
  }

  function validCandles(candles, interval) {
    if (!Array.isArray(candles) || candles.length < 20) return false;
    const step = intervalMs(interval);
    return candles.every((candle, index) => {
      if (!candle || !Number.isFinite(Number(candle.time)) || !Number.isFinite(Number(candle.close))) return false;
      if (index === 0) return true;
      return Number(candle.time) - Number(candles[index - 1].time) === step;
    });
  }

  function normalizeLevels(rows, descending) {
    let total = 0;
    const result = (Array.isArray(rows) ? rows : []).map(row => {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      if (!(price > 0) || !(quantity > 0)) return null;
      total += quantity;
      return [price, quantity, total];
    }).filter(Boolean);
    return result.sort((a, b) => descending ? b[0] - a[0] : a[0] - b[0]);
  }

  function normalizeSnapshot(input, symbol, fallbackProvider = '') {
    if (!input || typeof input !== 'object') throw new Error('Invalid market snapshot');
    const ticker = input.ticker || {};
    const price = Number(ticker.price);
    if (!(price > 0)) throw new Error('Snapshot is missing a positive price');
    const receivedAt = Number(input.receivedAt) || now();
    const serverTime = Number(input.serverTime) || receivedAt;
    return {
      symbol,
      provider: String(input.provider || fallbackProvider || ''),
      serverTime,
      receivedAt,
      sequence: Number(input.sequence) || serverTime,
      ticker: {
        price,
        open: Number(ticker.open) || price,
        high: Number(ticker.high) || price,
        low: Number(ticker.low) || price,
        volume: Math.max(0, Number(ticker.volume) || 0),
        quoteVolume: Math.max(0, Number(ticker.quoteVolume) || 0),
        change: Number(ticker.change) || 0,
        bid: Number(ticker.bid) || 0,
        ask: Number(ticker.ask) || 0,
      },
      book: {
        bids: normalizeLevels(input.book?.bids, true),
        asks: normalizeLevels(input.book?.asks, false),
        sequence: Number(input.book?.sequence) || Number(input.sequence) || serverTime,
      },
      trades: (Array.isArray(input.trades) ? input.trades : []).map(row => ({
        id: String(row.id ?? `${row.time}-${row.price}`),
        price: Number(row.price),
        qty: Number(row.qty),
        quoteQty: Number(row.quoteQty) || Number(row.price) * Number(row.qty),
        time: Number(row.time) || receivedAt,
        side: row.side === 'sell' ? 'sell' : 'buy',
      })).filter(row => row.price > 0 && row.qty > 0),
    };
  }

  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise(resolve => {
      const request = indexedDB.open('atlas-x-market-cache', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async function readCache(symbol, interval) {
    const database = await openDatabase();
    if (!database) return null;
    return new Promise(resolve => {
      const tx = database.transaction('sessions', 'readonly');
      const request = tx.objectStore('sessions').get(cacheKey(symbol, interval));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => database.close();
    });
  }

  async function writeCache(symbol, interval, candles, marketSnapshot) {
    const database = await openDatabase();
    if (!database) return;
    await new Promise(resolve => {
      const tx = database.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put({
        key: cacheKey(symbol, interval), version: 1, symbol, interval,
        candles: clone(candles), snapshot: clone(marketSnapshot), savedAt: now(),
      });
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    database.close();
  }

  function createProductionProvider() {
    const fetchJson = async (path, signal, timeoutMs = 5000) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException('Gateway timeout', 'TimeoutError')), timeoutMs);
      const relayAbort = () => controller.abort(signal?.reason || new DOMException('Aborted', 'AbortError'));
      if (signal?.aborted) relayAbort();
      else signal?.addEventListener('abort', relayAbort, { once: true });
      try {
        const response = await NativeFetch(`${GATEWAY}${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener?.('abort', relayAbort);
      }
    };

    const subscribeSse = ({ symbol, interval, onEvent }) => {
      if (!NativeEventSource) return null;
      const source = new NativeEventSource(`${GATEWAY}/stream?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
      const forward = type => event => {
        try {
          const payload = JSON.parse(event.data);
          if (type === 'snapshot') onEvent({ type, ...payload });
          else onEvent(payload.type ? payload : { type, ...payload });
        } catch {}
      };
      ['snapshot','ticker','book','trades','kline','status','heartbeat'].forEach(type => source.addEventListener(type, forward(type)));
      source.onerror = () => onEvent({ type: 'status', state: 'reconnecting', provider: '', serverTime: now(), receivedAt: now() });
      return () => source.close();
    };

    const subscribeDirect = ({ symbol, interval, onEvent, fallback }) => {
      if (!NativeWebSocket) return fallback();
      const lower = symbol.toLowerCase();
      const streams = [`${lower}@ticker`,`${lower}@depth20@100ms`,`${lower}@aggTrade`,`${lower}@kline_${interval}`].join('/');
      let socket;
      let validMessage = false;
      let stopped = false;
      let fallbackCleanup = null;
      try { socket = new NativeWebSocket(`wss://stream.binance.com:443/stream?streams=${streams}`); }
      catch { return fallback(); }
      const timeout = setTimeout(() => {
        if (validMessage || stopped) return;
        try { socket.close(); } catch {}
        fallbackCleanup = fallback();
      }, 2200);
      socket.onmessage = event => {
        let packet;
        try { packet = JSON.parse(event.data); } catch { return; }
        const stream = packet.stream || '';
        const data = packet.data || packet;
        validMessage = true;
        const receivedAt = now();
        if (stream.includes('@ticker')) {
          onEvent({
            type: 'ticker', provider: 'binance', symbol, interval,
            serverTime: Number(data.E) || receivedAt, receivedAt, sequence: Number(data.E) || receivedAt,
            data: { price: Number(data.c), open: Number(data.o), high: Number(data.h), low: Number(data.l), volume: Number(data.v), quoteVolume: Number(data.q), change: Number(data.P), bid: Number(data.b), ask: Number(data.a) },
          });
        } else if (stream.includes('@depth')) {
          onEvent({ type: 'book', provider: 'binance', symbol, interval, serverTime: receivedAt, receivedAt, sequence: Number(data.lastUpdateId) || receivedAt, data: { bids: data.bids || data.b || [], asks: data.asks || data.a || [], sequence: Number(data.lastUpdateId) || receivedAt } });
        } else if (stream.includes('@aggTrade')) {
          onEvent({ type: 'trade', provider: 'binance', symbol, interval, serverTime: Number(data.T) || receivedAt, receivedAt, sequence: Number(data.a) || receivedAt, data: { id: String(data.a), price: Number(data.p), qty: Number(data.q), time: Number(data.T) || receivedAt, side: data.m ? 'sell' : 'buy' } });
        } else if (stream.includes('@kline_') && data.k) {
          const k = data.k;
          onEvent({ type: 'kline', provider: 'binance', symbol, interval, serverTime: Number(data.E) || receivedAt, receivedAt, sequence: Number(data.E) || receivedAt, data: { time: Number(k.t), closeTime: Number(k.T), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v), quoteVolume: Number(k.q), trades: Number(k.n), closed: Boolean(k.x), provider: 'binance' } });
        }
      };
      socket.onopen = () => onEvent({ type: 'status', state: 'live', provider: 'binance', symbol, interval, serverTime: now(), receivedAt: now() });
      socket.onerror = () => {};
      socket.onclose = () => {
        if (!stopped && !fallbackCleanup) fallbackCleanup = fallback();
      };
      return () => {
        stopped = true;
        clearTimeout(timeout);
        try { socket.close(); } catch {}
        fallbackCleanup?.();
      };
    };

    return {
      intervalMs,
      async candles({ symbol, interval, limit, signal }) {
        const payload = await fetchJson(`/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`, signal);
        return payload.candles || [];
      },
      async snapshot({ symbol, signal }) {
        return await fetchJson(`/snapshot?symbol=${encodeURIComponent(symbol)}`, signal);
      },
      subscribe(options) {
        const fallback = () => subscribeSse(options) || (() => {});
        return subscribeDirect({ ...options, fallback });
      },
    };
  }

  const provider = window.__ATLAS_MARKET_TEST_PROVIDER__ || createProductionProvider();

  function stopRealtime() {
    realtimeCleanup?.();
    realtimeCleanup = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function clearFreshness() {
    clearInterval(freshnessTimer);
    freshnessTimer = null;
  }

  function startFreshness() {
    clearFreshness();
    freshnessTimer = setInterval(() => {
      if (!state.lastReceivedAt) return;
      const age = Math.max(0, now() - state.lastReceivedAt);
      let connectionState = state.connectionState;
      if (age > 10_000) connectionState = 'stale';
      else if (age > 3_000 && connectionState !== 'offline') connectionState = 'reconnecting';
      else if (age <= 3_000 && state.ticker?.price > 0) connectionState = 'live';
      if (connectionState !== state.connectionState || Math.abs(age - state.staleForMs) > 450) {
        setState({ connectionState, staleForMs: age }, 'freshness');
      }
    }, 500);
  }

  function applyRealtimeEvent(generation, event) {
    if (generation !== state.requestGeneration || !event) return;
    const receivedAt = Number(event.receivedAt) || now();
    const serverTime = Number(event.serverTime) || receivedAt;
    const providerName = String(event.provider || state.provider || '');
    const basePatch = {
      provider: providerName,
      lastReceivedAt: receivedAt,
      lastServerTime: serverTime,
      latencyMs: Math.max(0, receivedAt - serverTime),
      staleForMs: 0,
      connectionState: event.state === 'reconnecting' ? 'reconnecting' : 'live',
      source: providerName === 'fixture' ? 'fixture' : event.type === 'status' ? state.source : 'direct',
      error: '',
    };
    if (event.type === 'snapshot') {
      const normalized = normalizeSnapshot(event, state.symbol, providerName);
      setState({ ...basePatch, provider: normalized.provider, ticker: normalized.ticker, book: normalized.book, trades: normalized.trades }, 'snapshot');
      return;
    }
    if (event.type === 'ticker' && event.data) {
      setState({ ...basePatch, ticker: { ...(state.ticker || {}), ...event.data } }, 'ticker');
      return;
    }
    if (event.type === 'book' && event.data) {
      setState({ ...basePatch, book: { bids: normalizeLevels(event.data.bids, true), asks: normalizeLevels(event.data.asks, false), sequence: Number(event.data.sequence || event.sequence) || receivedAt } }, 'book');
      return;
    }
    if ((event.type === 'trade' || event.type === 'trades') && event.data) {
      const incoming = event.type === 'trades' ? event.data : [event.data];
      const trades = [...incoming.map(row => ({ id: String(row.id ?? `${row.time}-${row.price}`), price: Number(row.price), qty: Number(row.qty), quoteQty: Number(row.quoteQty) || Number(row.price) * Number(row.qty), time: Number(row.time) || receivedAt, side: row.side === 'sell' ? 'sell' : 'buy' })), ...state.trades]
        .filter(row => row.price > 0 && row.qty > 0)
        .slice(0, 80);
      setState({ ...basePatch, trades }, 'trades');
      return;
    }
    if (event.type === 'kline' && event.data) {
      const candles = [...state.candles];
      const candle = { ...event.data, provider: event.data.provider || providerName };
      const last = candles.at(-1);
      if (last?.time === candle.time) candles[candles.length - 1] = candle;
      else if (!last || candle.time > last.time) candles.push(candle);
      setState({ ...basePatch, candles: candles.slice(-500) }, 'kline');
      return;
    }
    if (event.type === 'status') {
      setState({ ...basePatch, connectionState: event.state === 'reconnecting' ? 'reconnecting' : state.connectionState }, 'status');
    }
  }

  async function switchSession(next = {}) {
    const symbol = normalizeSymbol(next.symbol || state.symbol);
    const interval = String(next.interval || state.interval);
    if (!symbol) throw new RangeError('A market symbol is required');
    intervalMs(interval);

    state.requestGeneration += 1;
    const generation = state.requestGeneration;
    activeAbort?.abort();
    activeAbort = new AbortController();
    stopRealtime();
    clearFreshness();
    reconnectAttempt = 0;
    const sessionId = `${symbol}:${interval}:${generation}:${now()}`;
    setState({ symbol, interval, sessionId, loading: true, connectionState: 'booting', error: '', staleForMs: 0 }, 'session-start', { generation });

    const cached = await readCache(symbol, interval);
    if (generation !== state.requestGeneration) return;
    if (cached && validCandles(cached.candles, interval)) {
      let cachedSnapshot = null;
      try { cachedSnapshot = normalizeSnapshot(cached.snapshot, symbol); } catch {}
      setState({
        candles: cached.candles,
        ticker: cachedSnapshot?.ticker || state.ticker,
        book: cachedSnapshot?.book || state.book,
        trades: cachedSnapshot?.trades || state.trades,
        provider: cachedSnapshot?.provider || '',
        lastServerTime: cachedSnapshot?.serverTime || Number(cached.savedAt) || 0,
        lastReceivedAt: Number(cached.savedAt) || 0,
        source: 'cache',
        connectionState: now() - Number(cached.savedAt || 0) > 10_000 ? 'stale' : 'booting',
      }, 'cache');
    }

    const signal = activeAbort.signal;
    try {
      const [candles, rawSnapshot] = await Promise.all([
        provider.candles({ symbol, interval, limit: 180, signal }),
        provider.snapshot({ symbol, interval, signal }),
      ]);
      if (generation !== state.requestGeneration) return;
      if (!validCandles(candles, interval)) throw new Error('Market candles failed interval validation');
      const marketSnapshot = normalizeSnapshot(rawSnapshot, symbol, rawSnapshot.provider);
      setState({
        candles,
        ticker: marketSnapshot.ticker,
        book: marketSnapshot.book,
        trades: marketSnapshot.trades,
        provider: marketSnapshot.provider,
        lastServerTime: marketSnapshot.serverTime,
        lastReceivedAt: marketSnapshot.receivedAt,
        latencyMs: Math.max(0, marketSnapshot.receivedAt - marketSnapshot.serverTime),
        source: marketSnapshot.provider === 'fixture' ? 'fixture' : 'gateway',
        connectionState: 'live',
        loading: false,
        staleForMs: 0,
      }, 'bootstrap');
      writeCache(symbol, interval, candles, marketSnapshot).catch(() => {});
      realtimeCleanup = provider.subscribe({
        symbol, interval,
        onEvent: event => applyRealtimeEvent(generation, event),
      }) || null;
      startFreshness();
    } catch (error) {
      if (generation !== state.requestGeneration || signal.aborted) return;
      const hasData = state.candles.length >= 20 && state.ticker?.price > 0;
      setState({ loading: false, connectionState: hasData ? 'stale' : 'offline', source: hasData ? state.source : 'cache', error: error?.message || 'Market data unavailable' }, 'error');
      startFreshness();
      if (!hasData) {
        const delays = [500, 1000, 2000, 4000, 8000];
        const delay = delays[Math.min(reconnectAttempt, delays.length - 1)];
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
          if (generation === state.requestGeneration) switchSession({ symbol, interval }).catch(() => {});
        }, delay);
      }
    }
  }

  async function start(options = {}) {
    if (started && options.symbol === state.symbol && options.interval === state.interval) return;
    started = true;
    document.documentElement.dataset.marketDataEngine = 'ready';
    await switchSession({ symbol: options.symbol || state.symbol, interval: options.interval || state.interval });
  }

  function stop() {
    activeAbort?.abort();
    activeAbort = null;
    stopRealtime();
    clearFreshness();
    started = false;
    setState({ connectionState: 'offline', loading: false }, 'stop');
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Market listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.AtlasMarketDataEngine = Object.freeze({
    start,
    switchSession,
    stop,
    getState: snapshotState,
    subscribe,
    intervalMs,
    gatewayBase: GATEWAY,
    version: VERSION,
  });
  document.documentElement.dataset.marketDataEngine = 'ready';
})();
