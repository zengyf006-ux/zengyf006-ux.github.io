(() => {
  'use strict';
  if (window.__ATLAS_ORDER_ENTRY_STAGE2_COMPAT__) return;
  window.__ATLAS_ORDER_ENTRY_STAGE2_COMPAT__ = true;

  function normalize(panel) {
    if (!(panel instanceof HTMLElement)) return;
    const type = panel.getAttribute('data-order-type');
    if (!type) return;
    panel.dataset.stage2EstimateType = type;
    panel.removeAttribute('data-order-type');
  }

  function init() {
    const panel = document.querySelector('.stage2-estimate-panel');
    if (!panel) return;
    normalize(panel);
    new MutationObserver(() => normalize(panel)).observe(panel, {
      attributes: true,
      attributeFilter: ['data-order-type'],
    });
    document.documentElement.dataset.orderEntryStage2Compat = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
