(() => {
  'use strict';
  if (window.__ATLAS_ALERT_DRAFT_STABILITY__) return;
  window.__ATLAS_ALERT_DRAFT_STABILITY__ = true;

  let draft = null;
  let applying = false;
  let observer = null;

  const $ = (selector, root = document) => root.querySelector(selector);

  function ruleCount() {
    try {
      const state = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"rules":[]}');
      return Array.isArray(state.rules) ? state.rules.length : 0;
    } catch {
      return 0;
    }
  }

  function rulesTabOpen() {
    return Boolean($('#controlPopover:not([hidden]) .alert-center-shell [data-alert-tab="rules"].active'));
  }

  function captureDraft() {
    const direction = $('#alertRuleDirection');
    const threshold = $('#alertRuleThreshold');
    if (!direction || !threshold || !rulesTabOpen()) return;
    draft = {
      direction: direction.value,
      threshold: threshold.value,
      capturedAt: Date.now(),
    };
  }

  function applyDraft() {
    if (applying || !draft || !rulesTabOpen()) return;
    const direction = $('#alertRuleDirection');
    const threshold = $('#alertRuleThreshold');
    if (!direction || !threshold) return;
    applying = true;
    try {
      if (direction.value !== draft.direction) direction.value = draft.direction;
      if (threshold.value !== draft.threshold) threshold.value = draft.threshold;
    } finally {
      applying = false;
    }
  }

  function scheduleApply() {
    queueMicrotask(() => requestAnimationFrame(applyDraft));
  }

  function bindObserver() {
    const body = $('#popoverBody');
    if (!body || observer) return;
    observer = new MutationObserver(scheduleApply);
    observer.observe(body, { childList: true, subtree: true });
  }

  document.addEventListener('input', event => {
    if (event.target?.matches?.('#alertRuleThreshold')) captureDraft();
  }, true);

  document.addEventListener('change', event => {
    if (event.target?.matches?.('#alertRuleDirection')) captureDraft();
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest('[data-alert-tab="rules"]')) {
      scheduleApply();
      return;
    }
    if (event.target.closest('#alertRuleCreate')) {
      const before = ruleCount();
      applyDraft();
      setTimeout(() => {
        if (ruleCount() > before) draft = null;
      }, 80);
      return;
    }
    if (event.target.closest('[data-close-popover]')) draft = null;
  }, true);

  const init = () => {
    bindObserver();
    const root = document.body;
    if (root) {
      new MutationObserver(() => {
        bindObserver();
        scheduleApply();
      }).observe(root, { childList: true, subtree: true });
    }
    document.documentElement.dataset.alertDraftStability = 'ready';
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
