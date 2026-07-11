(() => {
  'use strict';
  if (window.__ATLAS_NATIVE_NETWORK__) return;
  window.__ATLAS_NATIVE_NETWORK__ = Object.freeze({
    fetch: window.fetch.bind(window),
    WebSocket: window.WebSocket,
    capturedAt: Date.now(),
  });
})();
