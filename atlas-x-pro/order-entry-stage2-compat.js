(() => {
  'use strict';
  if (window.__ATLAS_ORDER_ENTRY_STAGE2_COMPAT__) return;
  window.__ATLAS_ORDER_ENTRY_STAGE2_COMPAT__ = true;

  const observedPanels = new WeakSet();

  function normalizeEstimate(panel) {
    if (!(panel instanceof HTMLElement)) return;
    const type = panel.getAttribute('data-order-type');
    if (!type) return;
    panel.dataset.stage2EstimateType = type;
    panel.removeAttribute('data-order-type');
  }

  function observePanel(panel) {
    if (!(panel instanceof HTMLElement) || observedPanels.has(panel)) return;
    observedPanels.add(panel);
    normalizeEstimate(panel);
    new MutationObserver(() => normalizeEstimate(panel)).observe(panel, {
      attributes: true,
      attributeFilter: ['data-order-type'],
    });
  }

  function normalizeRoot(root) {
    const type = root.getAttribute('data-stage2-order-type');
    if (!type) return;
    root.dataset.stage2ActiveOrderType = type;
    root.removeAttribute('data-stage2-order-type');
  }

  function init() {
    const root = document.documentElement;
    normalizeRoot(root);
    new MutationObserver(() => normalizeRoot(root)).observe(root, {
      attributes: true,
      attributeFilter: ['data-stage2-order-type'],
    });

    observePanel(document.querySelector('.stage2-estimate-panel'));
    new MutationObserver(records => {
      records.forEach(record => [...record.addedNodes].forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches?.('.stage2-estimate-panel')) observePanel(node);
        observePanel(node.querySelector?.('.stage2-estimate-panel'));
      }));
    }).observe(document.body, { childList: true, subtree: true });

    document.documentElement.dataset.orderEntryStage2Compat = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
