(() => {
  'use strict';
  if (window.__ATLAS_TERMINAL_QUALITY__) return;
  window.__ATLAS_TERMINAL_QUALITY__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const shell = () => $('.pro-shell');
  const grid = () => $('.terminal-grid');
  const STORAGE_KEY = 'atlasX.pro.workspace.v1';

  function createMobileQuickStats() {
    if ($('.mobile-quick-stats')) return;
    const head = $('.mobile-market-head');
    if (!head) return;
    const stats = document.createElement('section');
    stats.className = 'mobile-quick-stats';
    stats.setAttribute('aria-label', '市场摘要');
    stats.innerHTML = `
      <div><span>24h 高</span><b data-mobile-stat="high">--</b></div>
      <div><span>24h 低</span><b data-mobile-stat="low">--</b></div>
      <div><span>24h 成交量</span><b data-mobile-stat="volume">--</b></div>
      <div><span>价差</span><b data-mobile-stat="spread">--</b></div>`;
    head.after(stats);
  }

  function syncMobileQuickStats() {
    const map = {
      high: $('#high24')?.textContent || '--',
      low: $('#low24')?.textContent || '--',
      volume: ($('#volume24')?.textContent || '--').replace(/\s+[A-Z]+$/, ''),
      spread: $('#spreadMetric')?.textContent || '--',
    };
    Object.entries(map).forEach(([key, value]) => {
      const target = $(`[data-mobile-stat="${key}"]`);
      if (target) target.textContent = value;
    });
  }

  function restoreWorkspace() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return;
      const root = document.documentElement;
      if (Number.isFinite(saved.market)) root.style.setProperty('--atlas-market-col', `${clamp(saved.market, 190, 330)}px`);
      if (Number.isFinite(saved.book)) root.style.setProperty('--atlas-book-col', `${clamp(saved.book, 230, 390)}px`);
      if (Number.isFinite(saved.ticket)) root.style.setProperty('--atlas-ticket-col', `${clamp(saved.ticket, 280, 410)}px`);
    } catch {}
  }

  function currentWorkspace() {
    const styles = getComputedStyle(document.documentElement);
    return {
      market: Number.parseFloat(styles.getPropertyValue('--atlas-market-col')) || 230,
      book: Number.parseFloat(styles.getPropertyValue('--atlas-book-col')) || 286,
      ticket: Number.parseFloat(styles.getPropertyValue('--atlas-ticket-col')) || 314,
    };
  }

  function saveWorkspace(values) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch {}
  }

  function setColumn(type, value) {
    const root = document.documentElement;
    const limits = {
      market: [190, 330],
      book: [230, 390],
      ticket: [280, 410],
    };
    const [min, max] = limits[type];
    const next = clamp(Math.round(value), min, max);
    root.style.setProperty(`--atlas-${type}-col`, `${next}px`);
    const values = currentWorkspace();
    saveWorkspace(values);
    window.dispatchEvent(new Event('resize'));
    return next;
  }

  function createResizer(type, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-resizer';
    button.dataset.resize = type;
    button.setAttribute('role', 'separator');
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-orientation', 'vertical');
    button.tabIndex = 0;
    return button;
  }

  function bindResizer(handle) {
    const type = handle.dataset.resize;
    let startX = 0;
    let startValue = 0;

    const move = event => {
      const delta = event.clientX - startX;
      let next = startValue;
      if (type === 'market') next = startValue + delta;
      if (type === 'book' || type === 'ticket') next = startValue - delta;
      setColumn(type, next);
    };

    const stop = () => {
      shell()?.classList.remove('is-resizing');
      handle.classList.remove('active');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };

    handle.addEventListener('pointerdown', event => {
      if (innerWidth <= 1120) return;
      event.preventDefault();
      startX = event.clientX;
      startValue = currentWorkspace()[type];
      shell()?.classList.add('is-resizing');
      handle.classList.add('active');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop, { once: true });
      window.addEventListener('pointercancel', stop, { once: true });
    });

    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') {
        const defaults = { market: 230, book: 286, ticket: 314 };
        setColumn(type, defaults[type]);
        return;
      }
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const signed = type === 'market' ? direction : -direction;
      setColumn(type, currentWorkspace()[type] + signed * 12);
    });
  }

  function createWorkspaceResizers() {
    const target = grid();
    if (!target || $('.workspace-resizer', target)) return;
    [
      ['market', '调整市场列表宽度'],
      ['book', '调整订单簿宽度'],
      ['ticket', '调整下单面板宽度'],
    ].forEach(([type, label]) => {
      const handle = createResizer(type, label);
      target.append(handle);
      bindResizer(handle);
    });
  }

  function improveLiveSemantics() {
    $('#lastPrice')?.setAttribute('aria-live', 'polite');
    $('#mobileLastPrice')?.setAttribute('aria-live', 'polite');
    $('#positionsBody')?.setAttribute('aria-live', 'polite');
    $('#ordersBody')?.setAttribute('aria-live', 'polite');
    $('#historyBody')?.setAttribute('aria-live', 'polite');
  }

  function observeMarketStats() {
    const targets = ['#high24', '#low24', '#volume24', '#spreadMetric']
      .map(selector => $(selector))
      .filter(Boolean);
    const observer = new MutationObserver(syncMobileQuickStats);
    targets.forEach(target => observer.observe(target, { childList: true, characterData: true, subtree: true }));
  }

  function init() {
    restoreWorkspace();
    createMobileQuickStats();
    createWorkspaceResizers();
    improveLiveSemantics();
    syncMobileQuickStats();
    observeMarketStats();
    document.documentElement.dataset.terminalQuality = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
