(() => {
  'use strict';
  if (window.__ATLAS_CHART_PRO_TOOLS__) return;
  window.__ATLAS_CHART_PRO_TOOLS__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'atlasX.pro.chart-lines.v1';
  let mode = 'crosshair';
  let userLines = [];

  function readLines() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      userLines = Array.isArray(stored)
        ? stored.filter(line => Number.isFinite(line?.price)).slice(-24)
        : [];
    } catch {
      userLines = [];
    }
  }

  function saveLines() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(userLines)); } catch {}
  }

  function createUi() {
    const stage = $('#chartStage');
    if (!stage || $('.chart-marker-layer', stage)) return;

    const layer = document.createElement('div');
    layer.className = 'chart-marker-layer';
    layer.setAttribute('aria-hidden', 'true');
    stage.append(layer);

    const tools = document.createElement('div');
    tools.className = 'chart-drawing-tools';
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', '图表绘图工具');
    tools.innerHTML = `
      <button class="active" type="button" data-chart-tool="crosshair" aria-label="十字光标" title="十字光标">
        <svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="2"/></svg>
      </button>
      <button type="button" data-chart-tool="hline" aria-label="添加水平线" title="添加水平线">
        <svg viewBox="0 0 24 24"><path d="M4 12h16"/><path d="M7 8v8M17 8v8"/></svg>
      </button>
      <button type="button" data-chart-tool="clear" aria-label="清除绘图" title="清除绘图">
        <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>
      </button>`;
    stage.append(tools);
  }

  function canvasMetrics() {
    const canvas = $('#chartCanvas');
    if (!canvas) return null;
    const max = Number(canvas.dataset.max);
    const min = Number(canvas.dataset.min);
    const top = Number(canvas.dataset.top);
    const height = Number(canvas.dataset.priceHeight);
    if (![max, min, top, height].every(Number.isFinite) || max <= min || height <= 0) return null;
    return { canvas, max, min, top, height };
  }

  function yForPrice(price, metrics) {
    return metrics.top + ((metrics.max - price) / (metrics.max - metrics.min)) * metrics.height;
  }

  function priceForY(clientY, metrics) {
    const rect = metrics.canvas.getBoundingClientRect();
    const local = clientY - rect.top;
    const ratio = Math.min(1, Math.max(0, (local - metrics.top) / metrics.height));
    return metrics.max - ratio * (metrics.max - metrics.min);
  }

  function activePair() {
    return ($('#activePair')?.textContent || '').trim();
  }

  function numberFrom(text) {
    return Number(String(text || '').replace(/[^0-9.-]/g, ''));
  }

  function collectTradeMarkers() {
    const pair = activePair();
    const markers = [];
    $$('#positionsBody .table-row').forEach(row => {
      const rowPair = row.querySelector('[data-label="交易对"]')?.textContent?.trim();
      const price = numberFrom(row.querySelector('[data-label="开仓均价"]')?.textContent);
      if (rowPair === pair && Number.isFinite(price)) markers.push({ type: 'position', price, label: `持仓 ${price.toLocaleString('en-US')}` });
    });
    $$('#ordersBody .table-row').forEach(row => {
      const rowPair = row.querySelector('[data-label="交易对"]')?.textContent?.trim();
      const price = numberFrom(row.querySelector('[data-label="委托价"]')?.textContent);
      if (rowPair === pair && Number.isFinite(price)) markers.push({ type: 'order', price, label: `委托 ${price.toLocaleString('en-US')}` });
    });
    return markers;
  }

  function renderLines() {
    const layer = $('.chart-marker-layer');
    const metrics = canvasMetrics();
    if (!layer || !metrics) return;
    layer.innerHTML = '';

    const pair = activePair();
    const markers = [
      ...collectTradeMarkers(),
      ...userLines
        .filter(line => !line.pair || line.pair === pair)
        .map(line => ({ type: 'user', price: line.price, label: `水平线 ${line.price.toLocaleString('en-US', { maximumFractionDigits: 6 })}` })),
    ];

    markers.forEach(marker => {
      const y = yForPrice(marker.price, metrics);
      if (y < metrics.top - 2 || y > metrics.top + metrics.height + 2) return;
      const line = document.createElement('div');
      line.className = `chart-price-line ${marker.type}-line`;
      line.style.top = `${y}px`;
      line.dataset.markerType = marker.type;
      line.dataset.markerPrice = String(marker.price);
      line.innerHTML = `<span>${marker.label}</span>`;
      layer.append(line);
    });
  }

  function setMode(next) {
    mode = next;
    $$('.chart-drawing-tools [data-chart-tool]').forEach(button => {
      button.classList.toggle('active', button.dataset.chartTool === mode);
    });
    $('#chartStage')?.classList.toggle('drawing-horizontal', mode === 'hline');
  }

  function bindUi() {
    document.addEventListener('click', event => {
      const tool = event.target.closest('[data-chart-tool]')?.dataset.chartTool;
      if (!tool) return;
      event.preventDefault();
      event.stopPropagation();
      if (tool === 'clear') {
        const pair = activePair();
        userLines = userLines.filter(line => line.pair && line.pair !== pair);
        saveLines();
        renderLines();
        setMode('crosshair');
        return;
      }
      setMode(tool);
    }, true);

    $('#chartCanvas')?.addEventListener('click', event => {
      if (mode !== 'hline') return;
      const metrics = canvasMetrics();
      if (!metrics) return;
      const price = priceForY(event.clientY, metrics);
      userLines.push({ price, pair: activePair(), createdAt: Date.now() });
      userLines = userLines.slice(-24);
      saveLines();
      renderLines();
      setMode('crosshair');
    }, true);
  }

  function observeChanges() {
    const observer = new MutationObserver(renderLines);
    ['#positionsBody', '#ordersBody', '#activePair'].forEach(selector => {
      const element = $(selector);
      if (element) observer.observe(element, { childList: true, characterData: true, subtree: true });
    });
    const canvas = $('#chartCanvas');
    if (canvas) observer.observe(canvas, { attributes: true, attributeFilter: ['data-max', 'data-min', 'data-top', 'data-price-height'] });
    window.addEventListener('resize', () => requestAnimationFrame(renderLines));
  }

  function init() {
    readLines();
    createUi();
    bindUi();
    observeChanges();
    requestAnimationFrame(renderLines);
    document.documentElement.dataset.chartProTools = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
