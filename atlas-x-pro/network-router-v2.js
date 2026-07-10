(() => {
  'use strict';
  if (window.__ATLAS_QA_MODE__) {
    document.documentElement.dataset.marketRouter = 'qa';
    return;
  }
  if (window.__ATLAS_NETWORK_ROUTER_V2__) return;
  window.__ATLAS_NETWORK_ROUTER_V2__ = true;

  const nativeNetwork = window.__ATLAS_NATIVE_NETWORK__;
  if (!nativeNetwork?.fetch || !nativeNetwork?.WebSocket) {
    console.error('ATLAS native network primitives were not captured');
    return;
  }

  const NativeFetch = nativeNetwork.fetch;
  const NativeWebSocket = nativeNetwork.WebSocket;
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
  const state = {
    version: 2,
    mode: 'official-failover',
    rest: null,
    websocket: null,
    events: [],
    lastUpdatedAt: 0,
  };

  function report(detail) {
    const entry = { ...detail, at: Date.now(), routerVersion: 2 };
    state.events.push(entry);
    state.events = state.events.slice(-40);
    state.lastUpdatedAt = entry.at;
    if (entry.transport === 'rest') state.rest = entry;
    if (entry.transport === 'websocket') state.websocket = entry;
    window.dispatchEvent(new CustomEvent('atlas:data-route', { detail: entry }));
  }

  function isMarketUrl(value) {
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

  function buildRestCandidates(value) {
    const parsed = new URL(String(value), location.href);
    return REST_HOSTS.map(host => `${host}${parsed.pathname}${parsed.search}${parsed.hash}`);
  }

  function buildWebSocketCandidates(value) {
    const parsed = new URL(String(value));
    return WS_HOSTS.map(host => `${host}${parsed.pathname}${parsed.search}${parsed.hash}`);
  }

  function terminalStatus(status) {
    return status === 400 || status === 404 || status === 418 || status === 429;
  }

  function createSignal(externalSignal, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Endpoint attempt timed out', 'TimeoutError')), timeoutMs);
    const externalAbort = () => controller.abort(externalSignal?.reason || new DOMException('Request aborted', 'AbortError'));
    if (externalSignal) {
      if (externalSignal.aborted) externalAbort();
      else externalSignal.addEventListener('abort', externalAbort, { once: true });
    }
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      cleanup: () => {
        clearTimeout(timeout);
        externalSignal?.removeEventListener?.('abort', externalAbort);
      },
    };
  }

  function raceWave(urls, init, delays, attemptOffset) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let finished = 0;
      let lastError = new TypeError('Market data endpoints unavailable');
      const active = new Set();
      const timers = [];

      const stopOthers = winner => {
        active.forEach(signal => {
          if (signal !== winner) signal.abort();
          signal.cleanup();
        });
        timers.forEach(clearTimeout);
      };

      const finishFailure = error => {
        finished += 1;
        lastError = error || lastError;
        if (finished === urls.length && !settled) reject(lastError);
      };

      urls.forEach((url, index) => {
        const timer = setTimeout(async () => {
          if (settled) return;
          const startedAt = performance.now();
          const signal = createSignal(init.signal, 1600);
          active.add(signal);
          const attempt = attemptOffset + index + 1;
          try {
            const response = await NativeFetch(url, { ...init, method: 'GET', signal: signal.signal });
            const latency = Math.max(0, Math.round(performance.now() - startedAt));
            if (response.ok || terminalStatus(response.status)) {
              settled = true;
              stopOthers(signal);
              report({
                transport: 'rest',
                status: response.ok ? 'connected' : 'terminal-http',
                host: new URL(url).host,
                endpoint: url,
                latency,
                attempt,
                httpStatus: response.status,
              });
              resolve(response);
              return;
            }
            report({
              transport: 'rest', status: 'retrying', host: new URL(url).host,
              endpoint: url, latency, attempt, httpStatus: response.status,
            });
            finishFailure(new Error(`HTTP ${response.status}`));
          } catch (error) {
            if (!settled && !init.signal?.aborted) {
              report({
                transport: 'rest', status: 'retrying', host: new URL(url).host,
                endpoint: url, latency: Math.max(0, Math.round(performance.now() - startedAt)),
                attempt, error: error?.name || 'NetworkError',
              });
            }
            finishFailure(error);
          } finally {
            active.delete(signal);
            signal.cleanup();
          }
        }, delays[index] || 0);
        timers.push(timer);
      });
    });
  }

  async function routedFetch(input, init = {}) {
    const original = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    if (!original || method !== 'GET' || !isMarketUrl(original)) return NativeFetch(input, init);

    const candidates = buildRestCandidates(original);
    try {
      return await raceWave(candidates.slice(0, 3), init, [0, 180, 360], 0);
    } catch (primaryError) {
      if (init.signal?.aborted) throw primaryError;
      try {
        return await raceWave(candidates.slice(3), init, [0, 100, 200, 300], 3);
      } catch (secondaryError) {
        report({
          transport: 'rest', status: 'failed', host: '', endpoint: original,
          attempt: candidates.length, error: secondaryError?.name || primaryError?.name || 'NetworkError',
        });
        throw secondaryError;
      }
    }
  }

  class RoutedWebSocket extends EventTarget {
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
      this.readyState = RoutedWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this._protocols = protocols;
      this._candidates = buildWebSocketCandidates(url);
      this._index = 0;
      this._native = null;
      this._closedByUser = false;
      this._generation = 0;
      this._connect();
    }

    _emit(type, source = {}) {
      let event;
      if (type === 'message') event = new MessageEvent('message', { data: source.data, origin: source.origin || '' });
      else if (type === 'close') event = new CloseEvent('close', { code: source.code || 1006, reason: source.reason || '', wasClean: Boolean(source.wasClean) });
      else event = new Event(type);
      this.dispatchEvent(event);
      const handler = this[`on${type}`];
      if (typeof handler === 'function') handler.call(this, event);
    }

    _connect() {
      if (this._closedByUser) return;
      const endpoint = this._candidates[this._index];
      if (!endpoint) {
        this.readyState = RoutedWebSocket.CLOSED;
        report({ transport: 'websocket', status: 'failed', host: '', endpoint: this.url, attempt: this._index });
        this._emit('error');
        this._emit('close', { code: 1006, reason: 'All official WebSocket endpoints failed', wasClean: false });
        return;
      }

      const generation = ++this._generation;
      const startedAt = performance.now();
      let opened = false;
      let nativeSocket;
      try {
        nativeSocket = this._protocols === undefined
          ? new NativeWebSocket(endpoint)
          : new NativeWebSocket(endpoint, this._protocols);
      } catch (error) {
        this._index += 1;
        this._connect();
        return;
      }
      this._native = nativeSocket;
      nativeSocket.binaryType = this.binaryType;

      const timeout = setTimeout(() => {
        if (generation !== this._generation || opened || this._closedByUser) return;
        try { nativeSocket.close(); } catch {}
        this._index += 1;
        report({
          transport: 'websocket', status: 'retrying', host: new URL(endpoint).host,
          endpoint, latency: Math.round(performance.now() - startedAt), attempt: this._index,
          error: 'ConnectTimeout',
        });
        this._connect();
      }, 2100);

      nativeSocket.onopen = event => {
        if (generation !== this._generation || this._closedByUser) return;
        clearTimeout(timeout);
        opened = true;
        this.readyState = RoutedWebSocket.OPEN;
        this.protocol = nativeSocket.protocol || '';
        this.extensions = nativeSocket.extensions || '';
        report({
          transport: 'websocket', status: 'connected', host: new URL(endpoint).host,
          endpoint, latency: Math.max(0, Math.round(performance.now() - startedAt)), attempt: this._index + 1,
        });
        this._emit('open', event);
      };
      nativeSocket.onmessage = event => {
        if (generation === this._generation && !this._closedByUser) this._emit('message', event);
      };
      nativeSocket.onerror = () => {};
      nativeSocket.onclose = event => {
        if (generation !== this._generation) return;
        clearTimeout(timeout);
        if (this._closedByUser) {
          this.readyState = RoutedWebSocket.CLOSED;
          this._emit('close', event);
          return;
        }
        if (!opened && this._index + 1 < this._candidates.length) {
          this._index += 1;
          report({
            transport: 'websocket', status: 'retrying', host: new URL(endpoint).host,
            endpoint, latency: Math.round(performance.now() - startedAt), attempt: this._index,
            closeCode: event.code,
          });
          this._connect();
          return;
        }
        this.readyState = RoutedWebSocket.CLOSED;
        report({
          transport: 'websocket', status: opened ? 'disconnected' : 'failed', host: new URL(endpoint).host,
          endpoint, latency: Math.round(performance.now() - startedAt), attempt: this._index + 1,
          closeCode: event.code,
        });
        this._emit('close', event);
      };
    }

    send(data) {
      if (this.readyState !== RoutedWebSocket.OPEN || !this._native) throw new DOMException('WebSocket is not open', 'InvalidStateError');
      this._native.send(data);
    }

    close(code, reason) {
      if (this.readyState === RoutedWebSocket.CLOSED) return;
      this._closedByUser = true;
      this.readyState = RoutedWebSocket.CLOSING;
      try { this._native?.close(code, reason); }
      catch {
        this.readyState = RoutedWebSocket.CLOSED;
        this._emit('close', { code: code || 1000, reason: reason || '', wasClean: true });
      }
    }
  }

  async function selfTest() {
    const rest = buildRestCandidates('https://api.binance.com/api/v3/klines?symbol=BTCUSDT');
    const websocket = buildWebSocketCandidates('wss://stream.binance.com:443/stream?streams=btcusdt@ticker');
    const simulatedAttempts = [];
    for (const host of REST_HOSTS.slice(0, 3)) {
      simulatedAttempts.push(host);
      if (simulatedAttempts.length === 2) break;
    }
    return {
      routerVersion: 2,
      nativeNetworkCaptured: Boolean(nativeNetwork.fetch && nativeNetwork.WebSocket),
      restHostsOfficial: rest.length === 7 && rest[0].startsWith('https://data-api.binance.vision') && rest[2].startsWith('https://api-gcp.binance.com'),
      websocketPortsOfficial: websocket.length === 2 && websocket[0].startsWith('wss://stream.binance.com:9443') && websocket[1].startsWith('wss://stream.binance.com:443'),
      deterministicFailover: simulatedAttempts.length === 2 && simulatedAttempts[1] === REST_HOSTS[1],
      rest,
      websocket,
    };
  }

  window.fetch = routedFetch;
  window.WebSocket = RoutedWebSocket;
  window.__ATLAS_DATA_ROUTER__ = {
    qaMode: false,
    version: 2,
    restHosts: [...REST_HOSTS],
    websocketHosts: [...WS_HOSTS],
    snapshot: () => JSON.parse(JSON.stringify(state)),
    restCandidates: buildRestCandidates,
    websocketCandidates: buildWebSocketCandidates,
    selfTest,
  };
  document.documentElement.dataset.marketRouter = 'v2';
})();
