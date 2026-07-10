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
        openTime,
        String(open),
        String(high),
        String(low),
        String(close),
        String(volume),
        openTime + intervalMs - 1,
        String(volume * close),
        Math.round(70 + random() * 240),
        String(volume * (0.42 + random() * 0.16)),
        String(volume * close * (0.42 + random() * 0.16)),
        '0',
      ]);
    }
    return rows;
  }

  if (qaMode) {
    window.fetch = async input => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/v3/klines')) {
        return new Response(JSON.stringify(qaKlines(url)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error('ATLAS_QA_OFFLINE');
    };

    class OfflineWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor() {
        this.readyState = OfflineWebSocket.CONNECTING;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        setTimeout(() => {
          this.readyState = OfflineWebSocket.CLOSED;
          this.onclose?.({ code: 1006, reason: 'QA offline mode' });
        }, 30);
      }
      close() {
        this.readyState = OfflineWebSocket.CLOSED;
      }
      send() {}
      addEventListener(type, handler) {
        if (type === 'close') this.onclose = handler;
        if (type === 'open') this.onopen = handler;
        if (type === 'message') this.onmessage = handler;
        if (type === 'error') this.onerror = handler;
      }
      removeEventListener() {}
    }
    window.WebSocket = OfflineWebSocket;
    return;
  }

  window.fetch = (input, init) => {
    const original = typeof input === 'string' ? input : input?.url;
    if (!original) return NativeFetch(input, init);
    const rewritten = original.replace('https://api.binance.com', 'https://data-api.binance.vision');
    return NativeFetch(rewritten, init);
  };

  class AtlasDataWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      const rewritten = String(url).replace('wss://stream.binance.com', 'wss://data-stream.binance.vision');
      super(rewritten, protocols);
    }
  }
  window.WebSocket = AtlasDataWebSocket;
})();
