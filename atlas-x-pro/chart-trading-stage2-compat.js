(() => {
  'use strict';
  if (window.__ATLAS_CHART_TRADING_STAGE2_COMPAT__) return;
  window.__ATLAS_CHART_TRADING_STAGE2_COMPAT__ = true;

  function synchronize() {
    if (innerWidth > 820) return;
    const stage = document.querySelector('#chartStage');
    if (stage?.dataset.lastPickMode !== 'order-price') return;
    window.AtlasOrderEntryStage2?.setOrderType?.('limit');
  }

  function init() {
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
