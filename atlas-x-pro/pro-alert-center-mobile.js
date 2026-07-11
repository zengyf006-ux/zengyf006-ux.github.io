(() => {
  'use strict';
  if (window.__ATLAS_ALERT_CENTER_MOBILE__) return;
  window.__ATLAS_ALERT_CENTER_MOBILE__ = true;

  let originalParent = null;
  let originalNextSibling = null;

  function applyMobileGeometry(button) {
    button.hidden = false;
    button.removeAttribute('hidden');
    button.removeAttribute('aria-hidden');
    button.style.display = 'grid';
    button.style.width = '40px';
    button.style.height = '40px';
    button.style.minWidth = '40px';
    button.style.minHeight = '40px';
    button.style.flex = '0 0 40px';
    button.style.placeItems = 'center';
  }

  function clearMobileGeometry(button) {
    ['display', 'width', 'height', 'minWidth', 'minHeight', 'flex', 'placeItems']
      .forEach(property => { button.style[property] = ''; });
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
