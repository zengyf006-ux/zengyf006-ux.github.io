(() => {
  'use strict';
  if (window.__ATLAS_CHART_TRADING_LAYER__) return;
  window.__ATLAS_CHART_TRADING_LAYER__ = true;

  const RISK_PLAN_KEY = 'atlasX.pro.riskPlans.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PICK_MODES = new Set(['order-price', 'plan-stop', 'plan-target']);
  let pickMode = 'crosshair';
  let renderFrame = 0;

  function numberFrom(value) {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function activePair() {
    return ($('#activePair')?.textContent || '').trim();
  }

  function activeSymbol() {
    return activePair().replace('/', '');
  }

  function activeBase() {
    return activePair().split('/')[0] || '资产';
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

  function decimalsForMarket() {
    const text = String($('#lastPrice')?.textContent || '').replace(/,/g, '').trim();
    const decimals = text.includes('.') ? text.split('.')[1].replace(/[^0-9]/g, '').length : 0;
    return Math.min(8, Math.max(2, decimals));
  }

  function formatPrice(price) {
    return Number(price || 0).toLocaleString('en-US', {
      minimumFractionDigits: decimalsForMarket(),
      maximumFractionDigits: decimalsForMarket(),
    });
  }

  function formatQuantity(quantity) {
    return Number(quantity || 0).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  }

  function readRiskPlan() {
    try {
      const plans = JSON.parse(localStorage.getItem(RISK_PLAN_KEY) || '{}');
      const plan = plans?.[activeSymbol()];
      return plan && typeof plan === 'object' ? plan : {};
    } catch {
      return {};
    }
  }

  function collectPositionMarker() {
    const pair = activePair();
    const rows = $$('#positionsBody .table-row').filter(row => (
      row.querySelector('[data-label="交易对"]')?.textContent?.trim() === pair
    ));
    let quantity = 0;
    let cost = 0;
    rows.forEach(row => {
      const qty = numberFrom(row.querySelector('[data-label="数量"]')?.textContent);
      const entry = numberFrom(row.querySelector('[data-label="开仓均价"]')?.textContent);
      if (qty > 0 && entry > 0) {
        quantity += qty;
        cost += qty * entry;
      }
    });
    if (!(quantity > 0) || !(cost > 0)) return null;
    const price = cost / quantity;
    return {
      type: 'position',
      price,
      label: `持仓成本 ${formatPrice(price)} · ${formatQuantity(quantity)} ${activeBase()}`,
    };
  }

  function collectOrderMarkers() {
    const pair = activePair();
    return $$('#ordersBody .table-row').map(row => {
      if (row.querySelector('[data-label="交易对"]')?.textContent?.trim() !== pair) return null;
      const direction = row.querySelector('[data-label="方向"]')?.textContent?.trim() || '';
      const orderType = row.querySelector('[data-label="类型"]')?.textContent?.trim() || '委托';
      const price = numberFrom(row.querySelector('[data-label="委托价"]')?.textContent);
      const quantity = numberFrom(row.querySelector('[data-label="数量"]')?.textContent);
      const filledPercent = numberFrom(row.querySelector('[data-label="已成交"]')?.textContent);
      const remaining = quantity * Math.max(0, 1 - filledPercent / 100);
      if (!(price > 0) || !(remaining > 0)) return null;
      const buy = direction.includes('买');
      return {
        type: buy ? 'buy-order' : 'sell-order',
        price,
        label: `${buy ? '买入' : '卖出'}${orderType} ${formatPrice(price)} · ${formatQuantity(remaining)} ${activeBase()}`,
      };
    }).filter(Boolean);
  }

  function collectPlanMarkers() {
    const plan = readRiskPlan();
    const stop = numberFrom(plan.stopPrice);
    const target = numberFrom(plan.targetPrice);
    const markers = [];
    if (stop > 0) markers.push({ type: 'plan-stop', price: stop, label: `计划止损 ${formatPrice(stop)}` });
    if (target > 0) markers.push({ type: 'plan-target', price: target, label: `计划目标 ${formatPrice(target)}` });
    return markers;
  }

  function collectMarkers() {
    const position = collectPositionMarker();
    return [
      ...(position ? [position] : []),
      ...collectOrderMarkers(),
      ...collectPlanMarkers(),
    ];
  }

  function render() {
    const layer = $('.chart-trade-layer');
    const metrics = canvasMetrics();
    if (!layer || !metrics) return;
    layer.dataset.symbol = activeSymbol();
    layer.innerHTML = '';

    const visible = collectMarkers()
      .map(marker => ({ ...marker, y: yForPrice(marker.price, metrics) }))
      .filter(marker => marker.y >= metrics.top - 2 && marker.y <= metrics.top + metrics.height + 2)
      .sort((a, b) => a.y - b.y);

    let lastLabelY = -Infinity;
    visible.forEach(marker => {
      const line = document.createElement('div');
      line.className = `chart-price-line ${marker.type}-line`;
      line.style.top = `${marker.y}px`;
      line.dataset.markerType = marker.type;
      line.dataset.markerPrice = String(marker.price);
      const shift = marker.y - lastLabelY < 20 ? 11 : 0;
      line.style.setProperty('--trade-label-shift', `${shift}px`);
      line.innerHTML = `<span>${marker.label}</span>`;
      layer.append(line);
      lastLabelY = marker.y + shift;
    });
  }

  function scheduleRender() {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(render);
  }

  function createLayer() {
    const stage = $('#chartStage');
    if (!stage || $('.chart-trade-layer', stage)) return;
    const layer = document.createElement('div');
    layer.className = 'chart-trade-layer';
    layer.setAttribute('aria-hidden', 'true');
    stage.append(layer);
    stage.classList.add('chart-trading-enhanced');
  }

  function pickerButton(mode, label, path) {
    return `<button type="button" data-chart-tool="${mode}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24">${path}</svg></button>`;
  }

  function createTools() {
    const toolbar = $('.chart-drawing-tools');
    if (!toolbar || $('[data-chart-tool="order-price"]', toolbar)) return;
    const clear = $('[data-chart-tool="clear"]', toolbar);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = [
      pickerButton('order-price', '从图表设置委托价', '<path d="M4 17 17 4l3 3L7 20H4v-3Z"/><path d="M13 8l3 3"/>'),
      pickerButton('plan-stop', '从图表设置止损价', '<path d="M4 7h16M4 17h16"/><path d="m8 11 4 4 4-4"/>'),
      pickerButton('plan-target', '从图表设置目标价', '<path d="M12 21V6"/><path d="m7 11 5-5 5 5"/><path d="M5 3h14"/>'),
    ].join('');
    [...wrapper.children].forEach(button => toolbar.insertBefore(button, clear));
  }

  function currentSide() {
    return $('.side-selector [data-side].active')?.dataset.side === 'sell' ? 'sell' : 'buy';
  }

  function openMobileOrderSheet() {
    if (innerWidth > 820 || document.body.classList.contains('order-sheet-open')) return;
    $(`[data-mobile-side="${currentSide()}"]`)?.click();
  }

  function formatPickedPrice(price) {
    return Number(price).toFixed(decimalsForMarket());
  }

  function ensureRiskPanelExpanded() {
    const toggle = $('.risk-sizing-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
  }

  function fillOrderPrice(price) {
    openMobileOrderSheet();
    $('[data-order-type="limit"]')?.click();
    const input = $('#orderPrice');
    if (!input) return;
    input.value = formatPickedPrice(price);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function fillRiskPrice(selector, price) {
    openMobileOrderSheet();
    ensureRiskPanelExpanded();
    const input = $(selector);
    if (!input) return;
    input.value = formatPickedPrice(price);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function finishPick() {
    pickMode = 'crosshair';
    $('#chartStage')?.classList.remove('chart-picking-price');
    setTimeout(() => $('[data-chart-tool="crosshair"]')?.click(), 0);
  }

  function bindPicking() {
    document.addEventListener('click', event => {
      const tool = event.target.closest('[data-chart-tool]')?.dataset.chartTool;
      if (!tool) return;
      pickMode = PICK_MODES.has(tool) ? tool : 'crosshair';
      $('#chartStage')?.classList.toggle('chart-picking-price', PICK_MODES.has(tool));
    }, true);

    $('#chartCanvas')?.addEventListener('click', event => {
      if (!PICK_MODES.has(pickMode)) return;
      const metrics = canvasMetrics();
      if (!metrics) return;
      event.preventDefault();
      event.stopPropagation();
      const price = priceForY(event.clientY, metrics);
      if (pickMode === 'order-price') fillOrderPrice(price);
      if (pickMode === 'plan-stop') fillRiskPrice('#riskStopPrice', price);
      if (pickMode === 'plan-target') fillRiskPrice('#riskTargetPrice', price);
      scheduleRender();
      finishPick();
    }, true);
  }

  function observe() {
    const observer = new MutationObserver(scheduleRender);
    ['#positionsBody', '#ordersBody', '#activePair'].forEach(selector => {
      const element = $(selector);
      if (element) observer.observe(element, { childList: true, characterData: true, subtree: true });
    });
    const canvas = $('#chartCanvas');
    if (canvas) observer.observe(canvas, { attributes: true, attributeFilter: ['data-max', 'data-min', 'data-top', 'data-price-height'] });

    document.addEventListener('input', event => {
      if (event.target.matches?.('#riskStopPrice, #riskTargetPrice')) scheduleRender();
    });
    window.addEventListener('storage', event => {
      if (event.key === RISK_PLAN_KEY) scheduleRender();
    });
    window.addEventListener('resize', scheduleRender);
  }

  function init() {
    createLayer();
    createTools();
    bindPicking();
    observe();
    scheduleRender();
    document.documentElement.dataset.chartTradingLayer = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
