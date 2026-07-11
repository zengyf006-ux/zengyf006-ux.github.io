(() => {
  'use strict';
  if (window.__ATLAS_ALERT_CENTER_MOBILE__) return;
  window.__ATLAS_ALERT_CENTER_MOBILE__ = true;

  function syncBadge() {
    const source = document.querySelector('.notification-button .alert-center-badge');
    const target = document.querySelector('.mobile-alert-button .alert-center-badge');
    const button = document.querySelector('.mobile-alert-button');
    if (!target || !button) return;
    const count = Number(source?.dataset.unreadCount || 0);
    target.dataset.unreadCount = String(count);
    target.textContent = count > 99 ? '99+' : String(count);
    target.hidden = count === 0;
    button.classList.toggle('has-alerts', count > 0);
  }

  function mount() {
    const head = document.querySelector('.mobile-market-head');
    const favorite = document.querySelector('#mobileFavorite');
    if (!head || document.querySelector('.mobile-alert-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button mobile-alert-button';
    button.setAttribute('aria-label', '专业预警中心');
    button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg><span class="alert-center-badge" aria-label="未读预警" hidden></span>';
    if (favorite) favorite.before(button);
    else head.append(button);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.AtlasAlertCenter?.open?.();
    }, true);
    const source = document.querySelector('.notification-button .alert-center-badge');
    if (source) new MutationObserver(syncBadge).observe(source, {
      attributes: true,
      attributeFilter: ['hidden', 'data-unread-count'],
      characterData: true,
      childList: true,
      subtree: true,
    });
    syncBadge();
    document.documentElement.dataset.mobileAlertEntry = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', mount, { once: true })
    : mount();
})();
