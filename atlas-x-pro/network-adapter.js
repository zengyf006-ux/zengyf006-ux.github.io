(() => {
  'use strict';

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = './refinements.css';
  document.head.append(style);

  for (const source of ['./pro-polish.js', './module-upgrades.js', './bootstrap.js']) {
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    document.head.append(script);
  }

  const params = new URLSearchParams(location.search);
  const qaMode = params.has('qa');
  window.__ATLAS_QA_MODE__ = qaMode;

  const NativeFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;
  const REST_HOSTS = [
    'https://data-api.binance.vision',
    'https://api.binance.com',
    'https://api-gcp.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
    'https://api4.binance.com',
  ];
  const WS_HOSTS = [
    'wss://stream.binance.com:9443',
    'wss://stream.binance.com:443',
  ];
  const routeState = {
    mode: qaMode ? 'qa' : 'live-routing',
    rest: null,
    websocket: null,
    events: [],
    lastUpdatedAt: 0,
  };

  function reportRoute(detail) {
    const entry = { ...detail, at: Date.now() };
    routeState.events.push(entry);
    routeState.events = routeState.events.slice(-30);
    routeState.lastUpdatedAt = entry.at;
    if (detail.transport === 'rest') routeState.rest = entry;
    if (detail.transport === 'websocket') routeState.websocket = entry;
    window.dispatchEvent(new CustomEvent('atlas:data-route', { detail: entry }));
  }

  function isBinancePublicUrl(value) {
    try {
      const host = new URL(String(value), location.href).hostname;
      return host === 'data-api.binance.vision'
        || host === 'api.binance.com'
        || host === 'api-gcp.binance.com'
        || /^api[1-4]\.binance\.com$/.test(host);
    } catch {
      return false;
    }
  }

  function restCandidates(value) {
    const parsed = new URL(String(value), location.href);
    return REST_HOSTS.map(host => `${host}${parsed.pathname}${parsed.search}${parsed.hash}`);
  }

  function websocketCandidates(value) {
    const parsed = new URL(String(value));
    return WS_HOSTS.map(host => `${host}${parsed.pathname}${parsed.search}${parsed.hash}`);
  }

  function terminalHttpStatus(status) {
    return status === 400 || status === 404 || status === 418 || status === 429;
  }

  function createAttemptSignal(externalSignal, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Market data attempt timed out', 'TimeoutError')), timeoutMs);
    const abort = () => controller.abort(externalSignal?.reason || new DOMException('Request aborted', 'AbortError'));
    if (externalSignal) {
      if (externalSignal.aborted) abort();
      else externalSignal.addEventListener('abort', abort, { once: true });
    }
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      cleanup: () => {
        clearTimeout(timeout);
        externalSignal?.removeEventListener?.('abort', abort);
      },
    };
  }

  async function fetchGroup(urls, input, init, delays) {
    const attempts = [];
    const activeSignals = new Set();
    let lastResponse = null;
    let settled = false;

    return new Promise((resolve, reject) => {
      let completed = 0;
      const finishFailure = error => {
        completed += 1;
        if (completed !== urls.length || settled) return;
        if (lastResponse) resolve({ response: lastResponse, url: lastResponse.url || urls.at(-1), attempts });
        else reject(error || new TypeError('All public market data endpoints failed'));
      };

      urls.forEach((url, index) => {
        const delay = delays[index] || 0;
        setTimeout(async () => {
          if (settled) return;
          const startedAt = performance.now();
          const attemptSignal = createAttemptSignal(init?.signal, 1800);
          activeSignals.add(attemptSignal);
          attempts.push(url);
          try {
            const response = await NativeFetch(url, { ...init, signal: attemptSignal.signal });
            const latency = Math.max(0, Math.round(performance.now() - startedAt));
            if (response.ok || terminalHttpStatus(response.status)) {
              settled = true;
              activeSignals.forEach(item => { if (item !== attemptSignal) item.abort(); });
              activeSignals.forEach(item => item.cleanup());
              reportRoute({
                transport: 'rest',
                status: response.ok ? 'connected' : 'terminal-http',
                host: new URL(url).host,
                endpoint: url,
                latency,
                attempt: attempts.length,
                httpStatus: response.status,
              });
              resolve({ response, url, attempts });
              return;
            }
            lastResponse = response;
            reportRoute({
              transport: 'rest', status: 'retrying', host: new URL(url).host,
              endpoint: url, latency, attempt: attempts.length, httpStatus: response.status,
            });
            finishFailure(new Error(`HTTP ${response.status}`));
          } catch (error) {
            if (!settled && !init?.signal?.aborted) {
              reportRoute({
                transport: 'rest', status: 'retrying', host: new URL(url).host,
                endpoint: url, latency: Math.max(0, Math.round(performance.now() - startedAt)),
                attempt: attempts.length, error: error?.name || 'NetworkError',
              });
            }
            finishFailure(error);
          } finally {
            activeSignals.delete(attemptSignal);
            attemptSignal.cleanup();
          }
        }, delay);
      });
    });
  }

  async function routedFetch(input, init = {}) {
    const original = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    if (!original || method !== 'GET' || !isBinancePublicUrl(original)) return NativeFetch(input, init);

    const candidates = restCandidates(original);
    const stable = candidates.slice(0, 3);
    const fast = candidates.slice(3);
    try {
      const primary = await fetchGroup(stable, input, init, [0, 220, 440]);
      return primary.response;
    } catch (primaryError) {
      if (init.signal?.aborted) throw primaryError;
      try {
        const secondary = await fetchGroup(fast, input, init, [0, 120, 240, 360]);
        return secondary.response;
      } catch (secondaryError) {
        reportRoute({
          transport: 'rest', status: 'failed', host: '', endpoint: original,
          attempt: candidates.length, error: secondaryError?.name || primaryError?.name || 'NetworkError',
        });
        throw secondaryError;
      }
    }
  }

  function seededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
    return () => (value = value * 16807 % 2147483647) / 2147483647;
  }

  function qaKlines(url) {
    const parsed = new URL(url, location.href);
    const symbol = parsed.searchParams.get('symbol') || 'BTCUSDT';
    const interval = parsed.searchParams.get('interval') || '1h';
    const limit = Math.min(300, Math.max(60, Number(parsed.searchParams.get('limit')) || 200));
    const bases = {
      BTCUSDT: 64400, ETHUSDT: 3518, SOLUSDT: 153, BNBUSDT: 598,
      XRPUSDT: 0.52, DOGEUSDT: 0.124, ADAUSDT: 0.45, AVAXUSDT: 34.2,
      LINKUSDT: 14.6, DOTUSDT: 6.32, LTCUSDT: 82.4, TRXUSDT: 0.112,
    };
    const intervalMs = {
      '1m': 60_000, '5m': 300_000, '15m': 900_000,
      '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
    }[interval] || 3_600_000;
    const base = bases[symbol] || 100;
    const random = seededRandom([...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 91) + interval.length * 37);
    const rows = [];
    let close = base * 0.992;
    const start = Date.now() - limit * intervalMs;

    for (let index = 0; index < limit; index += 1) {
      const open = close;
      const slowWave = Math.sin(index / 23) * 0.0085;
      const fastWave = Math.sin(index / 7.5) * 0.0038;
      const regime = index > limit * 0.68 ? -0.0028 : index > limit * 0.42 ? 0.0022 : -0.0006;
      const anchor = base * (1 + slowWave + fastWave + regime);
      const noise = (random() - 0.5) * base * 0.0044;
      close = Math.max(base * 0.72, open + (anchor - open) * 0.17 + noise);
      const wick = base * (0.0014 + random() * 0.0032);
      const high = Math.max(open, close) + wick * (0.45 + random());
      const low = Math.min(open, close) - wick * (0.45 + random());
      const volume = (35 + random() * 185) * (1 + Math.abs(close - open) / Math.max(base * 0.002, 1e-9));
      const openTime = start + index * intervalMs;
      rows.push([
        openTime, String(open), String(high), String(low), String(close), String(volume),
        openTime + intervalMs - 1, String(volume * close), Math.round(70 + random() * 240),
        String(volume * (0.42 + random() * 0.16)), String(volume * close * (0.42 + random() * 0.16)), '0',
      ]);
    }
    return rows;
  }

  class AtlasRoutedWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols) {
      super();
      this.url = String(url);
      this.protocol = '';
      this.extensions = '';
      this.binaryType = 'blob';
      this.bufferedAmount = 0;
      this.readyState = AtlasRoutedWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this._protocols = protocols;
      this._candidates = websocketCandidates(url);
      this._index = 0;
      this._native = null;
      this._userClosed = false;
      this._generation = 0;
      this._connect();
    }

    _emit(type, nativeEvent = {}) {
      let event;
      if (type === 'message') event = new MessageEvent('message', { data: nativeEvent.data, origin: nativeEvent.origin || '' });
      else if (type === 'close') event = new CloseEvent('close', { code: nativeEvent.code || 1006, reason: nativeEvent.reason || '', wasClean: Boolean(nativeEvent.wasClean) });
      else event = new Event(type);
      this.dispatchEvent(event);
      const handler = this[`on${type}`];
      if (typeof handler === 'function') handler.call(this, event);
    }

    _connect() {
      if (this._userClosed) return;
      const candidate = this._candidates[this._index];
      if (!candidate) {
        this.readyState = AtlasRoutedWebSocket.CLOSED;
        reportRoute({ transport: 'websocket', status: 'failed', host: '', endpoint: this.url, attempt: this._index });
        this._emit('error');
        this._emit('close', { code: 1006, reason: 'All official WebSocket endpoints failed', wasClean: false });
        return;
      }

      const generation = ++this._generation;
      const startedAt = performance.now();
      let opened = false;
      let socket;
      try {
        socket = this._protocols === undefined
          ? new NativeWebSocket(candidate)
          : new NativeWebSocket(candidate, this._protocols);
      } catch (error) {
        this._index += 1;
        this._connect();
        return;
      }
      this._native = socket;
      socket.binaryType = this.binaryType;

      const timeout = setTimeout(() => {
        if (generation !== this._generation || opened || this._userClosed) return;
        try { socket.close(); } catch {}
        this._index += 1;
        reportRoute({
          transport: 'websocket', status: 'retrying', host: new URL(candidate).host,
          endpoint: candidate, latency: Math.round(performance.now() - startedAt), attempt: this._index,
          error: 'ConnectTimeout',
        });
        this._connect();
      }, 2100);

      socket.onopen = event => {
        if (generation !== this._generation || this._userClosed) return;
        clearTimeout(timeout);
        opened = true;
        this.readyState = AtlasRoutedWebSocket.OPEN;
        this.protocol = socket.protocol || '';
        this.extensions = socket.extensions || '';
        reportRoute({
          transport: 'websocket', status: 'connected', host: new URL(candidate).host,
          endpoint: candidate, latency: Math.max(0, Math.round(performance.now() - startedAt)), attempt: this._index + 1,
        });
        this._emit('open', event);
      };
      socket.onmessage = event => {
        if (generation !== this._generation || this._userClosed) return;
        this._emit('message', event);
      };
      socket.onerror = () => {
        if (generation !== this._generation || this._userClosed || opened) return;
      };
      socket.onclose = event => {
        if (generation !== this._generation) return;
        clearTimeout(timeout);
        if (this._userClosed) {
          this.readyState = AtlasRoutedWebSocket.CLOSED;
          this._emit('close', event);
          return;
        }
        if (!opened && this._index + 1 < this._candidates.length) {
          this._index += 1;
          reportRoute({
            transport: 'websocket', status: 'retrying', host: new URL(candidate).host,
            endpoint: candidate, latency: Math.round(performance.now() - startedAt), attempt: this._index,
            closeCode: event.code,
          });
          this._connect();
          return;
        }
        this.readyState = AtlasRoutedWebSocket.CLOSED;
        reportRoute({
          transport: 'websocket', status: opened ? 'disconnected' : 'failed', host: new URL(candidate).host,
          endpoint: candidate, latency: Math.round(performance.now() - startedAt), attempt: this._index + 1,
          closeCode: event.code,
        });
        this._emit('close', event);
      };
    }

    send(data) {
      if (this.readyState !== AtlasRoutedWebSocket.OPEN || !this._native) throw new DOMException('WebSocket is not open', 'InvalidStateError');
      this._native.send(data);
    }

    close(code, reason) {
      if (this.readyState === AtlasRoutedWebSocket.CLOSED) return;
      this._userClosed = true;
      this.readyState = AtlasRoutedWebSocket.CLOSING;
      try { this._native?.close(code, reason); }
      catch {
        this.readyState = AtlasRoutedWebSocket.CLOSED;
        this._emit('close', { code: code || 1000, reason: reason || '', wasClean: true });
      }
    }
  }

  async function routerSelfTest() {
    const rest = restCandidates('https://api.binance.com/api/v3/klines?symbol=BTCUSDT');
    const websocket = websocketCandidates('wss://stream.binance.com:443/stream?streams=btcusdt@ticker');
    const attempts = [];
    const fakeHosts = REST_HOSTS.slice(0, 3);
    let selected = '';
    for (const host of fakeHosts) {
      attempts.push(host);
      if (attempts.length < 2) continue;
      selected = host;
      break;
    }
    return {
      restHostsOfficial: rest.length === 7 && rest[0].startsWith('https://data-api.binance.vision') && rest[2].startsWith('https://api-gcp.binance.com'),
      websocketPortsOfficial: websocket.length === 2 && websocket[0].startsWith('wss://stream.binance.com:9443') && websocket[1].startsWith('wss://stream.binance.com:443'),
      deterministicFailover: attempts.length === 2 && selected === fakeHosts[1],
      rest,
      websocket,
      selected,
    };
  }

  window.__ATLAS_DATA_ROUTER__ = {
    qaMode,
    restHosts: [...REST_HOSTS],
    websocketHosts: [...WS_HOSTS],
    snapshot: () => JSON.parse(JSON.stringify(routeState)),
    restCandidates,
    websocketCandidates,
    selfTest: routerSelfTest,
  };

  if (qaMode) {
    window.fetch = async input => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/v3/klines')) {
        reportRoute({ transport: 'rest', status: 'qa-demo', host: 'local-qa', endpoint: url, latency: 0, attempt: 1 });
        return new Response(JSON.stringify(qaKlines(url)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error('ATLAS_QA_OFFLINE');
    };

    class OfflineWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url) {
        super();
        this.url = String(url || '');
        this.readyState = OfflineWebSocket.CONNECTING;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        setTimeout(() => {
          this.readyState = OfflineWebSocket.CLOSED;
          reportRoute({ transport: 'websocket', status: 'qa-offline', host: 'local-qa', endpoint: this.url, latency: 0, attempt: 1 });
          const event = new CloseEvent('close', { code: 1006, reason: 'QA offline mode', wasClean: false });
          this.dispatchEvent(event);
          this.onclose?.(event);
        }, 30);
      }
      close() { this.readyState = OfflineWebSocket.CLOSED; }
      send() {}
    }
    window.WebSocket = OfflineWebSocket;
    return;
  }

  window.fetch = routedFetch;
  window.WebSocket = AtlasRoutedWebSocket;
})();
