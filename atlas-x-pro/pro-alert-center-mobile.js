(() => {
  'use strict';
  if (window.__ATLAS_ALERT_CENTER_MOBILE__) return;
  window.__ATLAS_ALERT_CENTER_MOBILE__ = true;

  const CRITICAL_STYLE_ID = 'atlas-alert-mobile-critical-controls';
  let originalParent = null;
  let originalNextSibling = null;

  function installCriticalStyles() {
    if (document.getElementById(CRITICAL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CRITICAL_STYLE_ID;
    style.textContent = `
      @media (max-width: 820px) {
        .alert-center-tabs button,
        #alertCenterMarkAllRead,
        #alertCenterClearRead,
        #alertRuleCreate,
        .alert-center-price-shortcuts button,
        .alert-center-rule > [data-alert-rule-toggle],
        .alert-center-rule > [data-alert-rule-delete] {
          min-height: 44px !important;
          height: 44px !important;
          touch-action: manipulation !important;
        }
        .alert-center-rule-inputs select,
        .alert-center-rule-inputs input {
          min-height: 44px !important;
          height: 44px !important;
        }
        .mobile-market-head > .mobile-alert-button {
          width: 40px !important;
          height: 40px !important;
          min-width: 40px !important;
          min-height: 40px !important;
          flex: 0 0 40px !important;
          touch-action: manipulation !important;
        }
      }
    `;
    document.head.append(style);
  }

  function applyMobileGeometry(button) {
    button.hidden = false;
    button.removeAttribute('hidden');
    button.removeAttribute('aria-hidden');
    button.style.setProperty('display', 'grid', 'important');
    button.style.setProperty('width', '40px', 'important');
    button.style.setProperty('height', '40px', 'important');
    button.style.setProperty('min-width', '40px', 'important');
    button.style.setProperty('min-height', '40px', 'important');
    button.style.setProperty('flex', '0 0 40px', 'important');
    button.style.setProperty('place-items', 'center', 'important');
  }

  function clearMobileGeometry(button) {
    ['display', 'width', 'height', 'min-width', 'min-height', 'flex', 'place-items']
      .forEach(property => button.style.removeProperty(property));
  }

  function moveToMobileHeader() {
    const button = document.querySelector('.notification-button');
    const head = document.querySelector('.mobile-market-head');
    const favorite = document.querySelector('#mobileFavorite');
    if (!button || !head) return false;
    if (!originalParent) {
      originalParent = button.parentElement;
      originalNextSibling = button.nextSibling;
    }
    document.querySelectorAll('.mobile-alert-button').forEach(entry => {
      if (entry !== button) entry.classList.remove('mobile-alert-button');
    });
    button.classList.add('mobile-alert-button');
    button.setAttribute('aria-label', '专业预警中心');
    applyMobileGeometry(button);
    if (button.parentElement !== head) {
      if (favorite?.parentElement === head) head.insertBefore(button, favorite);
      else head.append(button);
    }
    document.documentElement.dataset.mobileAlertEntry = 'ready';
    return true;
  }

  function restoreDesktopHeader() {
    const button = document.querySelector('.notification-button');
    if (!button || !originalParent) return;
    button.classList.remove('mobile-alert-button');
    clearMobileGeometry(button);
    if (button.parentElement !== originalParent) {
      if (originalNextSibling && originalNextSibling.parentElement === originalParent) {
        originalParent.insertBefore(button, originalNextSibling);
      } else {
        originalParent.append(button);
      }
    }
    document.documentElement.dataset.mobileAlertEntry = 'desktop';
  }

  function syncPlacement() {
    installCriticalStyles();
    if (window.innerWidth <= 820) moveToMobileHeader();
    else restoreDesktopHeader();
  }

  function init() {
    installCriticalStyles();
    syncPlacement();
    window.addEventListener('resize', syncPlacement);
    const observer = new MutationObserver(syncPlacement);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
