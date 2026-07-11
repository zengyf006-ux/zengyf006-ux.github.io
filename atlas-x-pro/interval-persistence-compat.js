(() => {
  'use strict';
  if (window.__ATLAS_INTERVAL_PERSISTENCE_COMPAT__) return;
  window.__ATLAS_INTERVAL_PERSISTENCE_COMPAT__ = true;

  const CORE_KEY = 'atlasX.pro.v1';
  const INTERVALS = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']);
  const engine = window.AtlasMarketDataEngine;
  if (!engine) return;

  function readCore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CORE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function persist(interval) {
    if (!INTERVALS.has(interval)) return;
    const state = readCore();
    if (state.timeframe === interval) return;
    state.timeframe = interval;
    try { localStorage.setItem(CORE_KEY, JSON.stringify(state)); } catch {}
  }

  function synchronizeLegacyState() {
    const interval = engine.getState()?.interval;
    if (!INTERVALS.has(interval)) return;
    persist(interval);
    const button = document.querySelector(`[data-timeframe="${CSS.escape(interval)}"]`);
    if (!button) return;
    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    }));
    persist(interval);
  }

  engine.subscribe((state, event) => {
    if (!INTERVALS.has(state.interval)) return;
    if (event.type === 'session-start' || event.type === 'bootstrap' || event.type === 'cache') persist(state.interval);
  });

  const scheduleSync = () => setTimeout(synchronizeLegacyState, 0);
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', scheduleSync, { once: true })
    : scheduleSync();

  document.documentElement.dataset.intervalPersistence = 'ready';
})();
