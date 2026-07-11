(() => {
  'use strict';
  if (window.__ATLAS_TRADING_ADVANCED__) return;
  window.__ATLAS_TRADING_ADVANCED__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ALERTS_KEY = 'atlasX.pro.price-alerts.v1';
  let alerts = [];

  function numberFrom(text) {
    return Number(String(text || '').replace(/[^0-9.-]/g, ''));
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2100);
  }

  function activePair() {
    return ($('#activePair')?.textContent || 'BTC/USDT').trim();
  }

  function currentPrice() {
    return numberFrom($('#lastPrice')?.textContent);
  }

  function createDepthView() {
    const tabs = $('.orderbook-panel .panel-tabs');
    const footer = $('.orderbook-panel .book-footer');
    if (!tabs || !footer || $('[data-book-view="depth"]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.bookView = 'depth';
    button.textContent = '深度图';
    tabs.append(button);

    const view = document.createElement('div');
    view.className = 'book-content depth-view';
    view.dataset.bookContent = 'depth';
    view.innerHTML = `
      <canvas id="depthChartCanvas" aria-label="市场深度图"></canvas>
      <div class="depth-legend"><span><i class="bid-depth"></i>累计买单</span><span><i class="ask-depth"></i>累计卖单</span></div>`;
    footer.before(view);
  }

  function parseBookRows(selector) {
    return $$(selector).map(row => {
      const values = $$('span', row).map(span => numberFrom(span.textContent));
      return { price: values[0], quantity: values[1], cumulative: values[2] };
    }).filter(row => Number.isFinite(row.price) && Number.isFinite(row.cumulative));
  }

  function drawDepthChart() {
    const canvas = $('#depthChartCanvas');
    const host = $('.depth-view');
    if (!canvas || !host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 100) return;

    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    let bids = parseBookRows('#bidsRows .book-row').sort((a, b) => a.price - b.price);
    let asks = parseBookRows('#asksRows .book-row').sort((a, b) => a.price - b.price);
    if (!bids.length || !asks.length) return;

    const allPrices = [...bids, ...asks].map(row => row.price);
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const maxDepth = Math.max(...bids.map(row => row.cumulative), ...asks.map(row => row.cumulative), 1);
    const padding = { top: 34, right: 14, bottom: 28, left: 10 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const toX = price => padding.left + ((price - minPrice) / Math.max(maxPrice - minPrice, 1e-9)) * chartWidth;
    const toY = depth => padding.top + chartHeight - (depth / maxDepth) * chartHeight;

    context.strokeStyle = '#1a2634';
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
      const y = padding.top + chartHeight / 4 * index;
      context.beginPath();
      context.moveTo(padding.left, y + .5);
      context.lineTo(width - padding.right, y + .5);
      context.stroke();
    }

    const drawArea = (rows, lineColor, fillColor) => {
      context.beginPath();
      rows.forEach((row, index) => {
        const x = toX(row.price);
        const y = toY(row.cumulative);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.lineWidth = 1.5;
      context.strokeStyle = lineColor;
      context.stroke();
      const last = rows.at(-1);
      const first = rows[0];
      context.lineTo(toX(last.price), padding.top + chartHeight);
      context.lineTo(toX(first.price), padding.top + chartHeight);
      context.closePath();
      const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
      gradient.addColorStop(0, fillColor);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.fill();
    };

    drawArea(bids, '#21c997', 'rgba(33,201,151,.24)');
    drawArea(asks, '#f15b70', 'rgba(241,91,112,.22)');

    context.fillStyle = '#627186';
    context.font = '8px SFMono-Regular,Consolas,monospace';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    [minPrice, (minPrice + maxPrice) / 2, maxPrice].forEach(price => {
      context.fillText(price.toLocaleString('en-US', { maximumFractionDigits: 4 }), toX(price), height - padding.bottom + 7);
    });
    canvas.dataset.rendered = 'true';
  }

  function observeDepth() {
    const target = $('#orderBook');
    if (target) new MutationObserver(() => requestAnimationFrame(drawDepthChart)).observe(target, { childList: true, subtree: true });
    window.addEventListener('resize', () => requestAnimationFrame(drawDepthChart));
    document.addEventListener('click', event => {
      if (event.target.closest('[data-book-view="depth"]')) requestAnimationFrame(() => requestAnimationFrame(drawDepthChart));
    });
  }

  function loadAlerts() {
    try {
      const stored = JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]');
      alerts = Array.isArray(stored) ? stored.slice(-30) : [];
    } catch {
      alerts = [];
    }
  }

  function saveAlerts() {
    try { localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts)); } catch {}
  }

  function createAlertButtons() {
    if (!$('[data-open-price-alert="desktop"]')) {
      const desktop = document.createElement('button');
      desktop.type = 'button';
      desktop.className = 'price-alert-button';
      desktop.dataset.openPriceAlert = 'desktop';
      desktop.setAttribute('aria-label', '价格预警');
      desktop.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
      $('.connection-detail')?.append(desktop);
    }
    if (!$('[data-open-price-alert="mobile"]')) {
      const mobile = document.createElement('button');
      mobile.type = 'button';
      mobile.className = 'price-alert-button';
      mobile.dataset.openPriceAlert = 'mobile';
      mobile.setAttribute('aria-label', '价格预警');
      mobile.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
      $('#mobileFavorite')?.before(mobile);
    }
  }

  function createAlertPanel() {
    if ($('#priceAlertPanel')) return;
    const panel = document.createElement('section');
    panel.id = 'priceAlertPanel';
    panel.className = 'price-alert-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <header><div><strong>价格预警</strong><small id="alertPairLabel">BTC/USDT</small></div><button type="button" data-close-price-alert aria-label="关闭">×</button></header>
      <div class="alert-form">
        <select id="alertCondition" aria-label="预警条件"><option value="above">价格高于</option><option value="below">价格低于</option></select>
        <input id="alertPrice" inputmode="decimal" aria-label="目标价格" placeholder="目标价格" />
        <button id="addPriceAlert" type="button">添加</button>
      </div>
      <div class="alert-list" id="alertList"></div>`;
    document.body.append(panel);
  }

  function renderAlerts() {
    const list = $('#alertList');
    if (!list) return;
    const pair = activePair();
    $('#alertPairLabel').textContent = pair;
    const relevant = alerts.filter(alert => alert.pair === pair);
    list.innerHTML = relevant.length
      ? relevant.map(alert => `<div class="alert-row${alert.triggered ? ' triggered' : ''}" data-alert-id="${alert.id}"><div><b>${alert.condition === 'above' ? '价格高于' : '价格低于'}</b><small>${alert.triggered ? '已触发' : '监控中'}</small></div><span>${Number(alert.price).toLocaleString('en-US', { maximumFractionDigits: 8 })}</span><button type="button" data-delete-alert="${alert.id}" aria-label="删除">×</button></div>`).join('')
      : '<div class="alert-empty">当前交易对暂无价格预警</div>';
    $$('[data-open-price-alert]').forEach(button => button.classList.toggle('has-alerts', relevant.some(alert => !alert.triggered)));
  }

  function openAlertPanel() {
    const panel = $('#priceAlertPanel');
    if (!panel) return;
    const current = currentPrice();
    $('#alertPrice').value = Number.isFinite(current) ? String(current) : '';
    panel.hidden = false;
    $$('[data-open-price-alert]').forEach(button => button.classList.add('active'));
    renderAlerts();
  }

  function closeAlertPanel() {
    const panel = $('#priceAlertPanel');
    if (panel) panel.hidden = true;
    $$('[data-open-price-alert]').forEach(button => button.classList.remove('active'));
  }

  function addAlert() {
    const price = numberFrom($('#alertPrice')?.value);
    if (!Number.isFinite(price) || price <= 0) {
      showToast('请输入有效的预警价格');
      return;
    }
    alerts.push({
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      pair: activePair(),
      condition: $('#alertCondition')?.value === 'below' ? 'below' : 'above',
      price,
      triggered: false,
      createdAt: Date.now(),
    });
    alerts = alerts.slice(-30);
    saveAlerts();
    evaluateAlerts();
    renderAlerts();
  }

  function evaluateAlerts() {
    const pair = activePair();
    const price = currentPrice();
    if (!Number.isFinite(price)) return;
    let changed = false;
    alerts.forEach(alert => {
      if (alert.triggered || alert.pair !== pair) return;
      const triggered = alert.condition === 'above' ? price >= alert.price : price <= alert.price;
      if (!triggered) return;
      alert.triggered = true;
      alert.triggeredAt = Date.now();
      changed = true;
      showToast(`${pair} 已达到预警价格 ${Number(alert.price).toLocaleString('en-US')}`);
    });
    if (changed) {
      saveAlerts();
      renderAlerts();
    }
  }

  function bindAlerts() {
    document.addEventListener('click', event => {
      if (event.target.closest('[data-open-price-alert]')) {
        event.preventDefault();
        event.stopPropagation();
        openAlertPanel();
        return;
      }
      if (event.target.closest('[data-close-price-alert]')) {
        closeAlertPanel();
        return;
      }
      const deleteId = event.target.closest('[data-delete-alert]')?.dataset.deleteAlert;
      if (deleteId) {
        alerts = alerts.filter(alert => alert.id !== deleteId);
        saveAlerts();
        renderAlerts();
        return;
      }
      if (!event.target.closest('#priceAlertPanel')) closeAlertPanel();
    });
    $('#addPriceAlert')?.addEventListener('click', addAlert);
    $('#alertPrice')?.addEventListener('keydown', event => { if (event.key === 'Enter') addAlert(); });
    const price = $('#lastPrice');
    if (price) new MutationObserver(evaluateAlerts).observe(price, { childList: true, characterData: true, subtree: true });
    const pair = $('#activePair');
    if (pair) new MutationObserver(() => { renderAlerts(); closeAlertPanel(); }).observe(pair, { childList: true, characterData: true, subtree: true });
  }

  function createBulkActions() {
    const toolbar = $('.account-toolbar');
    const metrics = $('.account-metrics');
    if (!toolbar || !metrics || $('.account-bulk-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'account-bulk-actions';
    actions.innerHTML = '<button id="cancelAllOrders" type="button">全部撤单</button><button id="closeAllPositions" type="button">全部平仓</button>';
    toolbar.insertBefore(actions, metrics);
  }

  function syncBulkActions() {
    const cancel = $('#cancelAllOrders');
    const close = $('#closeAllPositions');
    if (cancel) cancel.disabled = $$('[data-cancel-order]').length === 0;
    if (close) close.disabled = $$('[data-close-position]').length === 0;
  }

  function bindBulkActions() {
    $('#cancelAllOrders')?.addEventListener('click', () => {
      const buttons = $$('[data-cancel-order]');
      buttons.forEach(button => button.click());
      if (buttons.length) showToast(`已撤销 ${buttons.length} 笔模拟委托`);
    });
    $('#closeAllPositions')?.addEventListener('click', () => {
      const buttons = $$('[data-close-position]');
      buttons.forEach(button => button.click());
      if (buttons.length) showToast(`已平仓 ${buttons.length} 个模拟持仓`);
    });
    const workspace = $('#accountWorkspace');
    if (workspace) new MutationObserver(syncBulkActions).observe(workspace, { childList: true, subtree: true });
    syncBulkActions();
  }

  function addShortcutHint() {
    const footer = $('.chart-footer > div');
    if (!footer || $('.shortcut-hint')) return;
    const hint = document.createElement('span');
    hint.className = 'shortcut-hint';
    hint.innerHTML = '<kbd>Alt B</kbd>买入 <kbd>Alt S</kbd>卖出 <kbd>⌘K</kbd>搜索';
    footer.append(hint);
  }

  function bindShortcuts() {
    document.addEventListener('keydown', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        if (innerWidth <= 820) $('[data-mobile-side="buy"]')?.click();
        else $('[data-side="buy"]')?.click();
      }
      if (event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (innerWidth <= 820) $('[data-mobile-side="sell"]')?.click();
        else $('[data-side="sell"]')?.click();
      }
      if (event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        openAlertPanel();
      }
    });
  }

  function init() {
    loadAlerts();
    createDepthView();
    createAlertButtons();
    createAlertPanel();
    createBulkActions();
    addShortcutHint();
    observeDepth();
    bindAlerts();
    bindBulkActions();
    bindShortcuts();
    renderAlerts();
    requestAnimationFrame(drawDepthChart);
    document.documentElement.dataset.tradingAdvanced = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
