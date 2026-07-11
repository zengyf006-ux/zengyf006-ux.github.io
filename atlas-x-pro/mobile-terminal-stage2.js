(() => {
  'use strict';
  if (window.__ATLAS_MOBILE_TERMINAL_STAGE2__) return;
  window.__ATLAS_MOBILE_TERMINAL_STAGE2__ = true;

  const MOBILE_QUERY = '(max-width: 820px)';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const media = matchMedia(MOBILE_QUERY);
  let mounted = false;
  let fullscreen = false;
  let previousScrollY = 0;
  let previousFocus = null;
  let detailObserver = null;
  let summaryTimer = 0;

  function isMobile() { return media.matches; }
  function text(selector, fallback = '--') {
    const value = $(selector)?.textContent?.trim();
    return value || fallback;
  }
  function numberFrom(value) {
    return Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
  }
  function formatCompact(value) {
    const number = Number(value) || 0;
    const absolute = Math.abs(number);
    if (absolute >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
    if (absolute >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
    if (absolute >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
    return number.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  function dispatchResize() {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
  }

  function mountChartToolsButton() {
    const tools = $('.chart-panel .chart-tools');
    if (!tools || $('[data-stage2-tools-open]', tools)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.stage2ToolsOpen = 'true';
    button.setAttribute('aria-label', '打开图表周期、指标与绘图工具');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M9 17h6"/><circle cx="17" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="15" cy="17" r="2"/></svg>';
    tools.prepend(button);
  }

  function toolProxyMarkup(selector, attribute, labelTransform = value => value) {
    return $$(selector).map(button => {
      const value = button.getAttribute(attribute) || '';
      const label = labelTransform(value, button.textContent.trim());
      return `<button type="button" data-stage2-proxy-attribute="${attribute}" data-stage2-proxy-value="${value}">${label}</button>`;
    }).join('');
  }

  function mountToolsSheet() {
    if ($('#stage2ChartToolsSheet')) return;
    const sheet = document.createElement('section');
    sheet.id = 'stage2ChartToolsSheet';
    sheet.className = 'stage2-chart-tools-sheet';
    sheet.dataset.open = 'false';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = `
      <header><div><strong>图表工具</strong><small>周期、指标与绘图</small></div><button type="button" data-stage2-tools-close aria-label="关闭图表工具">×</button></header>
      <div class="stage2-chart-tools-body">
        <section class="stage2-chart-tools-group"><span>周期</span><div data-stage2-tools-group="timeframe">${toolProxyMarkup('#timeframes [data-timeframe]', 'data-timeframe', (value, label) => label || value)}</div></section>
        <section class="stage2-chart-tools-group"><span>指标</span><div data-stage2-tools-group="indicator">${toolProxyMarkup('.chart-tools [data-indicator]', 'data-indicator', (value, label) => label || value.toUpperCase())}</div></section>
        <section class="stage2-chart-tools-group"><span>绘图</span><div data-stage2-tools-group="drawing"><button type="button" data-stage2-action="reset">重置视图</button><button type="button" data-stage2-action="fullscreen">全屏图表</button><button type="button" data-stage2-action="latest">回到最新</button></div></section>
      </div>`;
    document.body.append(sheet);
    syncToolSheetActiveState();
  }

  function syncToolSheetActiveState() {
    const sheet = $('#stage2ChartToolsSheet');
    if (!sheet) return;
    $$('[data-stage2-proxy-attribute]', sheet).forEach(proxy => {
      const attribute = proxy.dataset.stage2ProxyAttribute;
      const value = proxy.dataset.stage2ProxyValue;
      const original = document.querySelector(`[${attribute}="${CSS.escape(value)}"]`);
      const active = original?.classList.contains('active') || original?.getAttribute('aria-pressed') === 'true';
      proxy.classList.toggle('active', Boolean(active));
      proxy.setAttribute('aria-pressed', String(Boolean(active)));
    });
  }

  function openToolsSheet() {
    if (!isMobile()) return;
    const sheet = $('#stage2ChartToolsSheet');
    const opener = $('[data-stage2-tools-open]');
    if (!sheet) return;
    previousFocus = document.activeElement;
    sheet.dataset.open = 'true';
    sheet.setAttribute('aria-hidden', 'false');
    opener?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('stage2-sheet-open');
    syncToolSheetActiveState();
    $('[data-stage2-tools-close]', sheet)?.focus();
  }

  function closeToolsSheet({ restoreFocus = true } = {}) {
    const sheet = $('#stage2ChartToolsSheet');
    if (!sheet) return;
    sheet.dataset.open = 'false';
    sheet.setAttribute('aria-hidden', 'true');
    $('[data-stage2-tools-open]')?.setAttribute('aria-expanded', 'false');
    if (!document.body.classList.contains('stage2-candle-detail-open')) document.body.classList.remove('stage2-sheet-open');
    if (restoreFocus) (previousFocus instanceof HTMLElement ? previousFocus : $('[data-stage2-tools-open]'))?.focus?.();
  }

  function mountContextBar() {
    const chartPanel = $('.chart-panel');
    if (!chartPanel || $('.stage2-mobile-context', chartPanel)) return;
    const context = document.createElement('nav');
    context.className = 'stage2-mobile-context';
    context.setAttribute('aria-label', '图表下方交易上下文');
    context.innerHTML = `
      <button type="button" data-stage2-context="book"><span>盘口</span><b data-stage2-context-value="book">--</b></button>
      <button type="button" data-stage2-context="trades"><span>逐笔</span><b data-stage2-context-value="trades">--</b></button>
      <button type="button" data-stage2-context="account"><span>持仓</span><b data-stage2-context-value="account">0</b></button>`;
    chartPanel.append(context);
  }

  function updateContextSummary() {
    const engine = window.AtlasMarketDataEngine?.getState?.() || {};
    const bestAsk = engine.book?.asks?.[0];
    const bestBid = engine.book?.bids?.[0];
    const ask = Array.isArray(bestAsk) ? Number(bestAsk[0]) : Number(bestAsk?.price);
    const bid = Array.isArray(bestBid) ? Number(bestBid[0]) : Number(bestBid?.price);
    const spread = ask > 0 && bid > 0 ? ask - bid : 0;
    const latestTrade = engine.trades?.[0];
    const tradePrice = Number(latestTrade?.price) || numberFrom($('#lastPrice')?.textContent);
    const core = window.AtlasCoreTrading?.getState?.() || {};
    const positions = (core.positions || []).filter(position => position.symbol === (core.activeSymbol || engine.symbol));
    const set = (name, value) => {
      const element = $(`[data-stage2-context-value="${name}"]`);
      if (element) element.textContent = value;
    };
    set('book', spread > 0 ? `价差 ${formatCompact(spread)}` : '查看深度');
    set('trades', tradePrice > 0 ? formatCompact(tradePrice) : '最新成交');
    set('account', `${positions.length} 个持仓`);
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(updateContextSummary, 1500);
  }

  function mountCandleStrip() {
    const chartPanel = $('.chart-panel');
    const toolbar = $('.chart-panel .chart-toolbar');
    if (!chartPanel || !toolbar || $('.stage2-candle-strip', chartPanel)) return;
    const strip = document.createElement('section');
    strip.className = 'stage2-candle-strip';
    strip.dataset.open = 'false';
    strip.setAttribute('aria-live', 'polite');
    strip.innerHTML = `
      <div>
        <span>O <b data-stage2-candle="open">--</b></span>
        <span>H <b data-stage2-candle="high">--</b></span>
        <span>L <b data-stage2-candle="low">--</b></span>
        <span>C <b data-stage2-candle="close">--</b></span>
        <span>时间 <b data-stage2-candle="time">--</b></span>
        <span>涨跌 <b data-stage2-candle="change">--</b></span>
        <span>成交量 <b data-stage2-candle="volume">--</b></span>
        <span>周期 <b data-stage2-candle="interval">--</b></span>
      </div>
      <button type="button" data-stage2-candle-more aria-expanded="false">更多</button>`;
    toolbar.after(strip);
  }

  function updateCandleStrip() {
    const detail = $('#chartCandleDetail');
    const strip = $('.stage2-candle-strip');
    if (!detail || !strip) return;
    const open = !detail.hidden;
    strip.dataset.open = String(open);
    const mapping = {
      open: '#detailOpen', high: '#detailHigh', low: '#detailLow', close: '#detailClose',
      time: '#detailTime', change: '#detailChangePercent', volume: '#detailVolume', interval: '#detailInterval',
    };
    Object.entries(mapping).forEach(([key, selector]) => {
      const target = $(`[data-stage2-candle="${key}"]`, strip);
      if (target) {
        target.textContent = text(selector);
        target.className = $(selector)?.className || '';
      }
    });
    if (!open) closeCandleDetail({ restoreFocus: false });
  }

  function openCandleDetail() {
    if (!isMobile() || $('#chartCandleDetail')?.hidden) return;
    previousFocus = document.activeElement;
    document.body.classList.add('stage2-candle-detail-open', 'stage2-sheet-open');
    $('[data-stage2-candle-more]')?.setAttribute('aria-expanded', 'true');
    $('#chartCandleDetail [data-clear-candle-selection]')?.focus();
  }

  function closeCandleDetail({ restoreFocus = true } = {}) {
    document.body.classList.remove('stage2-candle-detail-open');
    if ($('#stage2ChartToolsSheet')?.dataset.open !== 'true') document.body.classList.remove('stage2-sheet-open');
    $('[data-stage2-candle-more]')?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (previousFocus instanceof HTMLElement ? previousFocus : $('[data-stage2-candle-more]'))?.focus?.();
  }

  function observeCandleDetail() {
    const detail = $('#chartCandleDetail');
    if (!detail || detailObserver) return;
    detailObserver = new MutationObserver(updateCandleStrip);
    detailObserver.observe(detail, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    updateCandleStrip();
  }

  function openContext(name) {
    const target = ['book', 'trades', 'account'].includes(name) ? name : 'book';
    const original = $(`[data-mobile-view="${target}"]`);
    original?.click();
    $$('.stage2-mobile-context [data-stage2-context]').forEach(button => {
      const active = button.dataset.stage2Context === target;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    requestAnimationFrame(() => {
      const panel = target === 'account' ? $('.account-workspace') : $('.orderbook-panel');
      panel?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    });
    return target;
  }

  function mountFullscreenClose() {
    const tools = $('.chart-panel .chart-tools');
    if (!tools || $('[data-stage2-fullscreen-close]', tools)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.stage2FullscreenClose = 'true';
    button.setAttribute('aria-label', '退出全屏图表');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    button.hidden = true;
    tools.append(button);
  }

  function openFullscreenChart() {
    if (!isMobile() || fullscreen) return false;
    fullscreen = true;
    previousScrollY = scrollY;
    previousFocus = document.activeElement;
    document.body.classList.add('mobile-chart-fullscreen');
    document.body.style.top = `-${previousScrollY}px`;
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    const close = $('[data-stage2-fullscreen-close]');
    if (close) close.hidden = false;
    $('#chartFullscreen')?.setAttribute('aria-expanded', 'true');
    close?.focus();
    dispatchResize();
    window.dispatchEvent(new CustomEvent('atlas:mobile-chart-fullscreen', { detail: { open: true } }));
    return true;
  }

  function closeFullscreenChart({ restoreFocus = true } = {}) {
    if (!fullscreen) return false;
    fullscreen = false;
    document.body.classList.remove('mobile-chart-fullscreen');
    document.body.style.top = '';
    document.body.style.position = '';
    document.body.style.width = '';
    const close = $('[data-stage2-fullscreen-close]');
    if (close) close.hidden = true;
    $('#chartFullscreen')?.setAttribute('aria-expanded', 'false');
    scrollTo(0, previousScrollY);
    dispatchResize();
    if (restoreFocus) (previousFocus instanceof HTMLElement ? previousFocus : $('#chartFullscreen'))?.focus?.();
    window.dispatchEvent(new CustomEvent('atlas:mobile-chart-fullscreen', { detail: { open: false } }));
    return true;
  }

  function bind() {
    document.addEventListener('click', event => {
      if (event.target.closest('[data-stage2-tools-open]')) {
        event.preventDefault();
        openToolsSheet();
        return;
      }
      if (event.target.closest('[data-stage2-tools-close]')) {
        closeToolsSheet();
        return;
      }
      const proxy = event.target.closest('[data-stage2-proxy-attribute]');
      if (proxy) {
        const attribute = proxy.dataset.stage2ProxyAttribute;
        const value = proxy.dataset.stage2ProxyValue;
        document.querySelector(`[${attribute}="${CSS.escape(value)}"]`)?.click();
        queueMicrotask(syncToolSheetActiveState);
        return;
      }
      const action = event.target.closest('[data-stage2-action]')?.dataset.stage2Action;
      if (action === 'reset') $('#chartReset')?.click();
      if (action === 'latest') $('#chartGoLatest')?.click();
      if (action === 'fullscreen') {
        closeToolsSheet({ restoreFocus: false });
        openFullscreenChart();
      }
      const context = event.target.closest('[data-stage2-context]')?.dataset.stage2Context;
      if (context) openContext(context);
      if (event.target.closest('[data-stage2-candle-more]')) openCandleDetail();
      if (event.target.closest('[data-stage2-fullscreen-close]')) closeFullscreenChart();
      if (event.target.closest('#chartCandleDetail [data-clear-candle-selection]')) closeCandleDetail({ restoreFocus: false });
    }, true);

    $('#chartFullscreen')?.addEventListener('click', event => {
      if (!isMobile()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      fullscreen ? closeFullscreenChart() : openFullscreenChart();
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (fullscreen) {
        event.preventDefault();
        closeFullscreenChart();
      } else if ($('#stage2ChartToolsSheet')?.dataset.open === 'true') {
        closeToolsSheet();
      } else if (document.body.classList.contains('stage2-candle-detail-open')) {
        closeCandleDetail();
      }
    }, true);

    media.addEventListener('change', event => {
      if (!event.matches) {
        closeFullscreenChart({ restoreFocus: false });
        closeToolsSheet({ restoreFocus: false });
        closeCandleDetail({ restoreFocus: false });
      }
      dispatchResize();
    });
    window.AtlasMarketDataEngine?.subscribe?.(updateContextSummary);
    window.addEventListener('storage', updateContextSummary);
  }

  function mount() {
    if (mounted) return;
    const chart = $('.chart-panel');
    if (!chart || !$('#chartStage')) return;
    mounted = true;
    mountChartToolsButton();
    mountToolsSheet();
    mountContextBar();
    mountCandleStrip();
    mountFullscreenClose();
    observeCandleDetail();
    bind();
    updateContextSummary();
    document.documentElement.dataset.mobileTerminalStage2 = 'ready';
  }

  window.AtlasMobileStage2 = Object.freeze({
    openFullscreenChart,
    closeFullscreenChart,
    openContext,
    openToolsSheet,
    closeToolsSheet,
    getState: () => ({
      mounted,
      fullscreen,
      toolsOpen: $('#stage2ChartToolsSheet')?.dataset.open === 'true',
      candleDetailOpen: document.body.classList.contains('stage2-candle-detail-open'),
    }),
  });

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', mount, { once: true })
    : mount();
})();
