(() => {
  'use strict';
  if (window.__ATLAS_CHART_TRADING_STAGE2_COMPAT__) return;
  window.__ATLAS_CHART_TRADING_STAGE2_COMPAT__ = true;

  function syncFullscreenClose() {
    const close = document.querySelector('[data-stage2-fullscreen-close]');
    if (!close) return;
    const visible = innerWidth <= 820
      && document.body.classList.contains('mobile-chart-fullscreen')
      && !close.hidden;
    close.style.setProperty('display', visible ? 'grid' : 'none', 'important');
    if (visible) close.style.setProperty('place-items', 'center');
  }

  function observeFullscreenClose() {
    const close = document.querySelector('[data-stage2-fullscreen-close]');
    if (!close) return false;
    syncFullscreenClose();
    new MutationObserver(syncFullscreenClose).observe(close, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    new MutationObserver(syncFullscreenClose).observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
    window.addEventListener('resize', syncFullscreenClose);
    return true;
  }

  function synchronize() {
    if (innerWidth > 820) return;
    const stage = document.querySelector('#chartStage');
    if (stage?.dataset.lastPickMode !== 'order-price') return;
    window.AtlasOrderEntryStage2?.setOrderType?.('limit');
  }

  function init() {
    if (!observeFullscreenClose()) {
      const observer = new MutationObserver(() => {
        if (observeFullscreenClose()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    const stage = document.querySelector('#chartStage');
    if (!stage) return;
    new MutationObserver(synchronize).observe(stage, {
      attributes: true,
      attributeFilter: ['data-last-pick-mode', 'data-last-pick-price'],
    });
    document.documentElement.dataset.chartTradingStage2Compat = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
