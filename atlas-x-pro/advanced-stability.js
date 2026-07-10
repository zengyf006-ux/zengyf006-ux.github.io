(() => {
  'use strict';
  if (window.__ATLAS_ADVANCED_STABILITY__) return;
  window.__ATLAS_ADVANCED_STABILITY__ = true;

  function bind() {
    const add = document.querySelector('#addPriceAlert');
    const panel = document.querySelector('#priceAlertPanel');
    if (!add || !panel) return false;
    add.addEventListener('click', event => {
      event.stopPropagation();
      requestAnimationFrame(() => {
        panel.hidden = false;
        document.querySelectorAll('[data-open-price-alert]').forEach(button => button.classList.add('active'));
      });
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
