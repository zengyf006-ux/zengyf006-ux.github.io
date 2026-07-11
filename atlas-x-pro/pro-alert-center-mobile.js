(() => {
  'use strict';
  if (window.__ATLAS_ALERT_CENTER_MOBILE__) return;
  window.__ATLAS_ALERT_CENTER_MOBILE__ = true;

  let originalParent = null;
  let originalNextSibling = null;

  function moveToMobileHeader() {
    const button = document.querySelector('.notification-button');
    const head = document.querySelector('.mobile-market-head');
    const favorite = document.querySelector('#mobileFavorite');
    if (!button || !head) return false;
    if (!originalParent) {
      originalParent = button.parentElement;
      originalNextSibling = button.nextSibling;
    }
    button.classList.add('mobile-alert-button');
    button.setAttribute('aria-label', '专业预警中心');
    if (button.parentElement !== head) {
      if (favorite?.parentElement === head) head.insertBefore(button, favorite);
      else head.append(button);
    }
    document.documentElement.dataset.mobileAlertEntry = 'ready';
    return true;
  }

  function restoreDesktopHeader() {
    const button = document.querySelector('.notification-button');
    if (!button || !originalParent || button.parentElement === originalParent) return;
    button.classList.remove('mobile-alert-button');
    if (originalNextSibling && originalNextSibling.parentElement === originalParent) {
      originalParent.insertBefore(button, originalNextSibling);
    } else {
      originalParent.append(button);
    }
    document.documentElement.dataset.mobileAlertEntry = 'desktop';
  }

  function syncPlacement() {
    if (window.innerWidth <= 820) moveToMobileHeader();
    else restoreDesktopHeader();
  }

  function init() {
    syncPlacement();
    window.addEventListener('resize', syncPlacement);
    const observer = new MutationObserver(syncPlacement);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
