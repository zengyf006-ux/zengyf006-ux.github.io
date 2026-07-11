(() => {
  'use strict';
  if (window.__ATLAS_CHART_TRADING_STAGE2_COMPAT__) return;
  window.__ATLAS_CHART_TRADING_STAGE2_COMPAT__ = true;

  function ensureFullscreenCloseStyle() {
    if (document.querySelector('#atlasStage2FullscreenCloseCompat')) return;
    const style = document.createElement('style');
    style.id = 'atlasStage2FullscreenCloseCompat';
    style.textContent = `
      @media (max-width: 820px) {
        body.mobile-chart-fullscreen [data-stage2-fullscreen-close]:not([hidden]) {
          display: grid !important;
          place-items: center;
        }
      }
    `;
    document.head.append(style);
  }

  function synchronize() {
    if (innerWidth > 820) return;
    const stage = document.querySelector('#chartStage');
    if (stage?.dataset.lastPickMode !== 'order-price') return;
    window.AtlasOrderEntryStage2?.setOrderType?.('limit');
  }

  function init() {
    ensureFullscreenCloseStyle();
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
