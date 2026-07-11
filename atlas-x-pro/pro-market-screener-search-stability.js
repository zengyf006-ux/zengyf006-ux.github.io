(() => {
  'use strict';
  if (window.__ATLAS_SCREENER_SEARCH_STABILITY__) return;
  window.__ATLAS_SCREENER_SEARCH_STABILITY__ = true;

  function normalizedQuery() {
    return String(document.querySelector('#marketScreenerSearch')?.value || '')
      .trim().toUpperCase().replace('/', '');
  }

  function activeFilter() {
    return document.querySelector('[data-screener-filter].active')?.dataset.screenerFilter || 'all';
  }

  function apply() {
    const root = document.querySelector('.module-overlay[data-module="markets"] .pro-market-screener');
    if (!root) return;
    const query = normalizedQuery();
    const filter = activeFilter();
    root.querySelectorAll('.pro-market-row').forEach(row => {
      const symbol = String(row.dataset.screenerSymbol || '').toUpperCase();
      const matchesQuery = !query || symbol.includes(query);
      const range = Number(row.dataset.rangePercent);
      const spread = Number(row.dataset.spreadBps);
      const matchesFilter = filter === 'range'
        ? Number.isFinite(range) && range >= 12
        : filter === 'spread'
          ? Number.isFinite(spread) && spread <= 1
          : true;
      row.hidden = !(matchesQuery && matchesFilter);
    });
  }

  function schedule() {
    queueMicrotask(() => requestAnimationFrame(apply));
  }

  document.addEventListener('input', event => {
    if (event.target?.id === 'marketScreenerSearch') schedule();
  });
  document.addEventListener('change', event => {
    if (event.target?.id === 'marketScreenerSort' || event.target?.id === 'marketScreenerDirection') schedule();
  });
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-screener-filter]')) schedule();
  });
  window.addEventListener('atlas:favorites-changed', schedule);

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => [...mutation.addedNodes].some(node => node.nodeType === 1
      && (node.matches?.('.pro-market-row,.pro-market-screener') || node.querySelector?.('.pro-market-row,.pro-market-screener'))))) schedule();
  });
  const init = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    document.documentElement.dataset.marketScreenerSearchStability = 'ready';
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();