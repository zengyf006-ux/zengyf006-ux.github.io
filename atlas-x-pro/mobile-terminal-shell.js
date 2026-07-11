(() => {
  'use strict';
  if (window.AtlasMobileTerminalStage2) return;

  const MOBILE_QUERY = window.matchMedia('(max-width: 820px)');
  const nodeHomes = new Map();
  let shell = null;
  let marketSlot = null;
  let contentSlot = null;
  let surfaceNav = null;
  let primaryActions = null;
  let observer = null;
  let activeSurface = 'chart';
  let mountQueued = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function remember(node) {
    if (!node || nodeHomes.has(node)) return;
    nodeHomes.set(node, { parent: node.parentNode, next: node.nextSibling });
  }

  function restore(node) {
    const home = nodeHomes.get(node);
    if (!node || !home?.parent) return;
    if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(node, home.next);
    else home.parent.append(node);
  }

  function mobileNodes() {
    return {
      marketHead: $('.mobile-market-head'),
      chart: $('.chart-panel'),
      book: $('.orderbook-panel'),
      account: $('.account-workspace'),
      legacyNav: $('.mobile-nav'),
      legacyTradeBar: $('.mobile-trade-bar'),
    };
  }

  function surfaceButtons() {
    return [
      ['chart', 'K线'],
      ['book', '盘口'],
      ['trades', '成交'],
      ['account', '账户'],
    ].map(([value, label]) => `<button type="button" data-mobile-surface="${value}">${label}</button>`).join('');
  }

  function createShell() {
    if (shell?.isConnected) return shell;
    const host = $('.pro-shell');
    const terminal = $('.terminal-grid');
    if (!host || !terminal) return null;

    shell = document.createElement('section');
    shell.className = 'mobile-terminal-stage2';
    shell.setAttribute('aria-label', '手机专业交易终端');
    shell.innerHTML = `
      <header class="mobile-stage2-market"></header>
      <nav class="mobile-stage2-surfaces" aria-label="交易工作区">${surfaceButtons()}</nav>
      <main class="mobile-stage2-content"></main>
      <footer class="mobile-primary-actions" aria-label="快速交易">
        <button class="buy" type="button" data-mobile-trade-side="buy"><span>买入</span><small>模拟现货</small></button>
        <button class="sell" type="button" data-mobile-trade-side="sell"><span>卖出</span><small>模拟现货</small></button>
      </footer>`;
    host.insertBefore(shell, terminal);
    marketSlot = $('.mobile-stage2-market', shell);
    contentSlot = $('.mobile-stage2-content', shell);
    surfaceNav = $('.mobile-stage2-surfaces', shell);
    primaryActions = $('.mobile-primary-actions', shell);
    bindShellEvents();
    return shell;
  }

  function moveMobileNodes() {
    const nodes = mobileNodes();
    if (!nodes.marketHead || !nodes.chart || !nodes.book || !nodes.account) return false;
    [nodes.marketHead, nodes.chart, nodes.book, nodes.account, nodes.legacyNav, nodes.legacyTradeBar].forEach(remember);

    if (nodes.marketHead.parentNode !== marketSlot) marketSlot.append(nodes.marketHead);
    if (nodes.chart.parentNode !== contentSlot) contentSlot.append(nodes.chart);
    if (nodes.book.parentNode !== contentSlot) contentSlot.append(nodes.book);
    if (nodes.account.parentNode !== contentSlot) contentSlot.append(nodes.account);
    nodes.legacyNav?.classList.add('stage2-legacy-hidden');
    nodes.legacyTradeBar?.classList.add('stage2-legacy-hidden');

    nodes.chart.dataset.stage2SurfacePanel = 'chart';
    nodes.book.dataset.stage2SurfacePanel = 'book';
    nodes.account.dataset.stage2SurfacePanel = 'account';
    return true;
  }

  function legacyViewButton(surface) {
    const value = surface === 'trades' ? 'trades' : surface;
    return $(`.mobile-nav [data-mobile-view="${value}"]`);
  }

  function setSurface(surface, { invokeLegacy = true } = {}) {
    const allowed = new Set(['chart', 'book', 'trades', 'account']);
    if (!allowed.has(surface)) return false;
    activeSurface = surface;
    if (invokeLegacy) legacyViewButton(surface)?.click();

    $$('[data-mobile-surface]', surfaceNav).forEach(button => {
      const active = button.dataset.mobileSurface === surface;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });

    const chart = $('[data-stage2-surface-panel="chart"]', contentSlot);
    const book = $('[data-stage2-surface-panel="book"]', contentSlot);
    const account = $('[data-stage2-surface-panel="account"]', contentSlot);
    chart?.classList.toggle('stage2-active', surface === 'chart');
    book?.classList.toggle('stage2-active', surface === 'book' || surface === 'trades');
    account?.classList.toggle('stage2-active', surface === 'account');
    shell.dataset.activeSurface = surface;
    try { sessionStorage.setItem('atlasX.stage2.mobileSurface', surface); } catch {}
    return true;
  }

  function openTradeSheet(side) {
    const value = side === 'sell' ? 'sell' : 'buy';
    const source = $(`.mobile-trade-bar [data-mobile-side="${value}"]`);
    source?.click();
    shell.dataset.tradeSide = value;
    return Boolean(source);
  }

  function bindShellEvents() {
    shell.addEventListener('click', event => {
      const surface = event.target.closest('[data-mobile-surface]')?.dataset.mobileSurface;
      if (surface) {
        event.preventDefault();
        setSurface(surface);
        return;
      }
      const side = event.target.closest('[data-mobile-trade-side]')?.dataset.mobileTradeSide;
      if (side) {
        event.preventDefault();
        openTradeSheet(side);
      }
    });
  }

  function normalizeHeaderEntries() {
    if (!marketSlot) return;
    const head = $('.mobile-market-head', marketSlot);
    if (!head) return;
    const unique = new Map();
    ['.mobile-alert-button', '.mobile-market-center-button', '.mobile-data-health-button', '#mobileFavorite'].forEach(selector => {
      $$(selector).forEach(entry => {
        if (!entry.isConnected) return;
        if (!unique.has(selector)) unique.set(selector, entry);
        else if (entry !== unique.get(selector)) entry.classList.add('stage2-stale-entry');
      });
    });
    unique.forEach(entry => {
      entry.hidden = false;
      entry.removeAttribute('hidden');
      entry.classList.remove('stage2-stale-entry');
      if (entry.parentNode !== head) head.append(entry);
    });
  }

  function currentSurfaceFromLegacy() {
    const active = $('.mobile-nav [data-mobile-view].active')?.dataset.mobileView;
    return ['chart', 'book', 'trades', 'account'].includes(active) ? active : 'chart';
  }

  function mount() {
    mountQueued = false;
    if (!MOBILE_QUERY.matches) {
      unmount();
      return false;
    }
    if (!createShell() || !moveMobileNodes()) return false;
    normalizeHeaderEntries();
    const stored = (() => {
      try { return sessionStorage.getItem('atlasX.stage2.mobileSurface'); } catch { return null; }
    })();
    setSurface(['chart', 'book', 'trades', 'account'].includes(stored) ? stored : currentSurfaceFromLegacy(), { invokeLegacy: false });
    shell.hidden = false;
    document.body.classList.add('atlas-stage2-mobile');
    document.documentElement.dataset.mobileTerminalStage2 = 'ready';
    return true;
  }

  function unmount() {
    if (!shell) return;
    const nodes = mobileNodes();
    [nodes.marketHead, nodes.chart, nodes.book, nodes.account, nodes.legacyNav, nodes.legacyTradeBar].forEach(restore);
    nodes.legacyNav?.classList.remove('stage2-legacy-hidden');
    nodes.legacyTradeBar?.classList.remove('stage2-legacy-hidden');
    shell.remove();
    shell = marketSlot = contentSlot = surfaceNav = primaryActions = null;
    document.body.classList.remove('atlas-stage2-mobile');
    document.documentElement.dataset.mobileTerminalStage2 = 'desktop';
  }

  function scheduleMount() {
    if (mountQueued) return;
    mountQueued = true;
    requestAnimationFrame(mount);
  }

  function init() {
    mount();
    MOBILE_QUERY.addEventListener?.('change', scheduleMount);
    window.addEventListener('resize', scheduleMount);
    observer = new MutationObserver(() => {
      if (!MOBILE_QUERY.matches) return;
      if (!shell?.isConnected) scheduleMount();
      else normalizeHeaderEntries();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.AtlasMobileTerminalStage2 = Object.freeze({
    mount,
    unmount,
    setSurface,
    openTradeSheet,
    getSurface: () => activeSurface,
  });

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
