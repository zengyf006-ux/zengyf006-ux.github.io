(() => {
  'use strict';
  if (window.__ATLAS_ALERT_TAB_STABILITY__) return;
  window.__ATLAS_ALERT_TAB_STABILITY__ = true;

  let desiredTab = 'all';
  let restoring = false;
  let scheduled = false;

  function restore() {
    scheduled = false;
    if (restoring) return;
    const shell = document.querySelector('#controlPopover.alert-center-popover .alert-center-shell');
    if (!shell) return;
    const target = shell.querySelector(`[data-alert-tab="${desiredTab}"]`);
    if (!target || target.classList.contains('active')) return;
    restoring = true;
    target.click();
    queueMicrotask(() => {
      restoring = false;
      const active = document.querySelector('#controlPopover.alert-center-popover [data-alert-tab].active');
      if (active?.dataset.alertTab !== desiredTab) scheduleRestore();
    });
  }

  function scheduleRestore() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(restore);
  }

  document.addEventListener('click', event => {
    const tab = event.target.closest?.('[data-alert-tab]')?.dataset.alertTab;
    if (tab) desiredTab = tab;
    if (event.target.closest?.('[data-alert-rule-delete],[data-alert-rule-toggle],#alertRuleCreate')) {
      desiredTab = 'rules';
      scheduleRestore();
    }
  }, true);

  const observer = new MutationObserver(mutations => {
    if (!document.querySelector('#controlPopover.alert-center-popover')) return;
    if (mutations.some(mutation => mutation.type === 'childList')) scheduleRestore();
  });

  const init = () => {
    const popover = document.querySelector('#controlPopover') || document.body;
    observer.observe(popover, { childList: true, subtree: true });
    window.addEventListener('atlas:alert-center-updated', scheduleRestore);
    document.documentElement.dataset.alertTabStability = 'ready';
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
