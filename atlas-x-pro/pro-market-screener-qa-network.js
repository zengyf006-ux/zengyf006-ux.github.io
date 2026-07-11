(() => {
  'use strict';
  if (window.__ATLAS_PRO_SCREENER_NETWORK_PREFLIGHT__) return;
  window.__ATLAS_PRO_SCREENER_NETWORK_PREFLIGHT__ = true;

  if (window.__ATLAS_QA_MODE__) {
    window.__ATLAS_SCREENER_QA_NETWORK__ = true;
    document.documentElement.dataset.marketScreenerNetwork = 'qa-route';
    return;
  }

  const network = window.__ATLAS_NATIVE_NETWORK__;
  if (!network?.fetch) return;

  const mainMarkets = 'https://vtcunypvhtudragsittb.supabase.co/functions/v1/atlas-market-gateway/markets';
  const batchMarkets = 'https://vtcunypvhtudragsittb.supabase.co/functions/v1/atlas-market-gateway-markets/markets';
  const originalFetch = network.fetch;

  const routedFetch = (input, init) => {
    let value = input;
    try {
      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const url = new URL(raw, location.href);
      if (`${url.origin}${url.pathname}` === mainMarkets) {
        value = input instanceof Request
          ? new Request(batchMarkets + url.search, input)
          : batchMarkets + url.search;
      }
    } catch {}
    return originalFetch(value, init);
  };

  window.__ATLAS_NATIVE_NETWORK__ = Object.freeze({
    ...network,
    fetch: routedFetch,
    screenerMarketsEndpoint: batchMarkets,
  });
  document.documentElement.dataset.marketScreenerNetwork = 'batch-gateway';
})();
