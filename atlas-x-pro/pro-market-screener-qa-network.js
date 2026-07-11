(() => {
  'use strict';
  if (!window.__ATLAS_QA_MODE__ || window.__ATLAS_SCREENER_QA_NETWORK__) return;
  window.__ATLAS_SCREENER_QA_NETWORK__ = true;

  const previousFetch = window.fetch.bind(window);
  const nativeFetch = window.__ATLAS_NATIVE_NETWORK__?.fetch;
  if (typeof nativeFetch !== 'function') return;

  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const isScreenerEndpoint = method === 'GET'
      && (url.includes('/api/v3/ticker/24hr') || url.includes('/api/v3/ticker/bookTicker'));
    return isScreenerEndpoint ? nativeFetch(input, init) : previousFetch(input, init);
  };

  document.documentElement.dataset.marketScreenerQaNetwork = 'ready';
})();
