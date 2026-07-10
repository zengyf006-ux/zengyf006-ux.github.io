(() => {
  'use strict';
  if (window.__ATLAS_ADVANCED_STABILITY__) return;
  window.__ATLAS_ADVANCED_STABILITY__ = true;

  function bind() {
    const add = document.querySelector('#addPriceAlert');
    const panel = document.querySelector('#priceAlertPanel');
    if (!add || !panel || panel.dataset.stabilityBound === 'true') return Boolean(add && panel);
    panel.dataset.stabilityBound = 'true';
    let holdOpenUntil = 0;

    const keepOpen = () => {
      if (Date.now() > holdOpenUntil) return;
      if (panel.hidden) panel.hidden = false;
      document.querySelectorAll('[data-open-price-alert]').forEach(button => button.classList.add('active'));
    };

    const observer = new MutationObserver(keepOpen);
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });

    add.addEventListener('click', event => {
      event.stopPropagation();
      holdOpenUntil = Date.now() + 900;
      requestAnimationFrame(keepOpen);
      setTimeout(keepOpen, 30);
      setTimeout(keepOpen, 120);
    });

    document.documentElement.dataset.advancedStability = 'ready';
    return true;
  }

  const start = () => {
    if (bind()) return;
    const observer = new MutationObserver(() => {
      if (bind()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', start, { once: true })
    : start();
})();
