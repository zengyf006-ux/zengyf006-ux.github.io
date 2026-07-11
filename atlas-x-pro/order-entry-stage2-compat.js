(() => {
  'use strict';
  if (window.__ATLAS_ORDER_ENTRY_STAGE2_COMPAT__) return;
  window.__ATLAS_ORDER_ENTRY_STAGE2_COMPAT__ = true;

  function normalizeEstimate(panel) {
    if (!(panel instanceof HTMLElement)) return;
    const type = panel.getAttribute('data-order-type');
    if (!type) return;
    panel.dataset.stage2EstimateType = type;
    panel.removeAttribute('data-order-type');
  }

  function normalizeRoot(root) {
    const type = root.getAttribute('data-stage2-order-type');
    if (!type) return;
    root.dataset.stage2ActiveOrderType = type;
    root.removeAttribute('data-stage2-order-type');
  }

  function init() {
    const panel = document.querySelector('.stage2-estimate-panel');
    const root = document.documentElement;
    if (!panel) return;
    normalizeEstimate(panel);
    normalizeRoot(root);
    new MutationObserver(() => normalizeEstimate(panel)).observe(panel, {
      attributes: true,
      attributeFilter: ['data-order-type'],
    });
    new MutationObserver(() => normalizeRoot(root)).observe(root, {
      attributes: true,
      attributeFilter: ['data-stage2-order-type'],
    });
    document.documentElement.dataset.orderEntryStage2Compat = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
