(() => {
  'use strict';
  if (window.__ATLAS_ALERT_TOUCH_HARDENING__) return;
  window.__ATLAS_ALERT_TOUCH_HARDENING__ = true;

  const CONTROL_SELECTORS = [
    '.alert-center-tabs button',
    '#alertCenterMarkAllRead',
    '#alertCenterClearRead',
    '#alertRuleCreate',
    '.alert-center-price-shortcuts button',
    '.alert-center-rule [data-alert-rule-toggle]',
    '.alert-center-rule [data-alert-rule-delete]',
  ];

  function forceSize(element, size = 44) {
    if (!element) return;
    element.style.setProperty('min-height', `${size}px`, 'important');
    element.style.setProperty('height', `${size}px`, 'important');
    element.style.setProperty('touch-action', 'manipulation', 'important');
  }

  function harden() {
    if (innerWidth > 820) return;
    document.querySelectorAll(CONTROL_SELECTORS.join(',')).forEach(element => forceSize(element));
    document.querySelectorAll('.alert-center-rule-inputs select,.alert-center-rule-inputs input')
      .forEach(element => forceSize(element));
    document.querySelectorAll('.mobile-alert-button').forEach(element => {
      forceSize(element);
      element.style.setProperty('min-width', '44px', 'important');
      element.style.setProperty('width', '44px', 'important');
      element.style.setProperty('flex', '0 0 44px', 'important');
      element.style.setProperty('padding', '0', 'important');
    });
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => requestAnimationFrame(() => {
      scheduled = false;
      harden();
    }));
  }

  const observer = new MutationObserver(schedule);
  const init = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    addEventListener('resize', schedule, { passive: true });
    schedule();
    document.documentElement.dataset.alertTouchHardening = 'ready';
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();