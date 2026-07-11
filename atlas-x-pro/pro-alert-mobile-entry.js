(() => {
  'use strict';
  if (window.__ATLAS_ALERT_MOBILE_ENTRY__) return;
  window.__ATLAS_ALERT_MOBILE_ENTRY__ = true;

  const STORE_KEY = 'atlasX.pro.alertCenter.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  let syncTimer = 0;

  function readUnreadCount() {
    try {
      const state = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return (Array.isArray(state.events) ? state.events : []).filter(event => event?.read !== true).length;
    } catch {
      return 0;
    }
  }

  function bellMarkup() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>`;
  }

  function ensureMobileButton() {
    const header = $('.mobile-market-head');
    if (!header) return null;
    let button = $('#mobileAlertButton');
    if (!button) {
      button = document.createElement('button');
      button.id = 'mobileAlertButton';
      button.type = 'button';
      button.className = 'icon-button mobile-alert-button';
      button.dataset.alertCenterOpen = 'mobile';
      button.setAttribute('aria-label', '打开专业预警中心');
      button.innerHTML = bellMarkup();
      const favorite = $('#mobileFavorite');
      if (favorite?.parentElement === header) header.insertBefore(button, favorite);
      else header.append(button);
    }
    return button;
  }

  function ensureBadge(button) {
    if (!button) return null;
    let badge = $('.alert-center-badge', button);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'alert-center-badge';
      badge.hidden = true;
      badge.setAttribute('aria-label', '未读预警');
      button.append(badge);
    }
    return badge;
  }

  function sync() {
    const desktop = $('.notification-button');
    if (desktop) desktop.dataset.alertCenterOpen = 'desktop';
    const mobile = ensureMobileButton();
    const count = readUnreadCount();
    [desktop, mobile].filter(Boolean).forEach(button => {
      const badge = ensureBadge(button);
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.dataset.unreadCount = String(count);
      button.classList.toggle('has-alerts', count > 0);
    });
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 30);
  }

  function bind() {
    document.addEventListener('click', event => {
      const trigger = event.target.closest?.('[data-alert-center-open]');
      if (!trigger) return;
      if (trigger.id === 'mobileAlertButton') {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.AtlasAlertCenter?.open?.();
      }
    }, true);
    window.addEventListener('storage', event => {
      if (event.key === STORE_KEY) scheduleSync();
    });
    const observer = new MutationObserver(scheduleSync);
    const target = $('.mobile-market-head') || document.body;
    observer.observe(target, { childList: true, subtree: true });
    setInterval(sync, 300);
  }

  function init() {
    sync();
    bind();
    document.documentElement.dataset.alertMobileEntry = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
