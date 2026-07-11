(() => {
  'use strict';
  if (window.__ATLAS_CHART_TRADING_STAGE2_COMPAT__) return;
  window.__ATLAS_CHART_TRADING_STAGE2_COMPAT__ = true;

  let chartResizeFrame = 0;

  function dispatchChartResize() {
    cancelAnimationFrame(chartResizeFrame);
    chartResizeFrame = requestAnimationFrame(() => {
      chartResizeFrame = 0;
      window.dispatchEvent(new Event('resize'));
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
  }

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

  function observeChartStageGeometry(stage) {
    let lastWidth = 0;
    let lastHeight = 0;
    new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const changed = Math.abs(rect.width - lastWidth) > 1
        || Math.abs(rect.height - lastHeight) > 1;
      lastWidth = rect.width;
      lastHeight = rect.height;
      const chartActive = stage.closest('.chart-panel')?.classList.contains('mobile-active');
      if (changed && innerWidth <= 820 && chartActive && rect.width > 0 && rect.height > 0) {
        dispatchChartResize();
      }
    }).observe(stage);
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
    observeChartStageGeometry(stage);
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
