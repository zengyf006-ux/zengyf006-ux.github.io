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

  if (qaMode) {
    window.fetch = async () => { throw new Error('ATLAS_QA_OFFLINE'); };

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
