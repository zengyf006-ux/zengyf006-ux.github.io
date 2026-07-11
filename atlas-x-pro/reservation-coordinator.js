(() => {
  'use strict';
  if (window.__ATLAS_RESERVATION_COORDINATOR__) return;
  window.__ATLAS_RESERVATION_COORDINATOR__ = true;

  const CORE_KEY = 'atlasX.pro.v1';
  const EXIT_KEY = 'atlasX.pro.exitStrategies.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let syncTimer = 0;

  function numberFrom(value) {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function symbolFromPair() {
    return ($('#activePair')?.textContent || 'BTC/USDT').trim().replace('/', '');
  }

  function baseFromPair() {
    return ($('#activePair')?.textContent || 'BTC/USDT').trim().split('/')[0] || '资产';
  }

  function snapshot(symbol = symbolFromPair()) {
    const core = readJson(CORE_KEY, {});
    const exit = readJson(EXIT_KEY, { strategies: [] });
    const positions = Array.isArray(core.positions) ? core.positions : [];
    const orders = Array.isArray(core.orders) ? core.orders : [];
    const strategies = Array.isArray(exit.strategies) ? exit.strategies : [];
    const held = positions
      .filter(position => position.symbol === symbol)
      .reduce((sum, position) => sum + Math.max(0, numberFrom(position.qty)), 0);
    const coreReserved = orders
      .filter(order => order.symbol === symbol && order.side === 'sell')
      .reduce((sum, order) => sum + Math.max(0, numberFrom(order.qty) - numberFrom(order.filled)), 0);
    const trailingReserved = strategies
      .filter(strategy => strategy.kind === 'trailing_stop'
        && strategy.symbol === symbol
        && ['waiting_activation', 'active'].includes(strategy.status))
      .reduce((sum, strategy) => sum + Math.max(0, numberFrom(strategy.quantity)), 0);
    return {
      symbol,
      held,
      coreReserved,
      trailingReserved,
      totalReserved: coreReserved + trailingReserved,
      available: Math.max(0, held - coreReserved - trailingReserved),
    };
  }

  function formatQuantity(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  function reservationCopy(reservation) {
    const parts = [];
    if (reservation.coreReserved > 0) parts.push(`核心委托冻结 ${formatQuantity(reservation.coreReserved)}`);
    if (reservation.trailingReserved > 0) parts.push(`退出策略预留 ${formatQuantity(reservation.trailingReserved)}`);
    return parts.join('，');
  }

  function currentSide() {
    return $('.side-selector [data-side].active')?.dataset.side === 'sell' ? 'sell' : 'buy';
  }

  function syncOcoAvailability() {
    const badge = $('#ocoAvailableBadge');
    if (!badge) return;
    const reservation = snapshot();
    badge.textContent = `可用 ${formatQuantity(reservation.available)} ${baseFromPair()}`;
    badge.dataset.availableQuantity = String(reservation.available);
    badge.title = reservationCopy(reservation);
  }

  function syncRiskSizingSell() {
    if (currentSide() !== 'sell') return;
    const panel = $('.risk-sizing-panel');
    if (!panel) return;
    const reservation = snapshot();
    panel.dataset.suggestedQuantity = String(reservation.available);
    panel.dataset.riskAvailableQuantity = String(reservation.available);
    panel.dataset.cappedBy = reservation.totalReserved > 0 ? 'reservation' : 'position';
    panel.dataset.valid = String(reservation.available > 0);
    const quantity = $('#riskQuantityValue');
    if (quantity) quantity.textContent = reservation.available > 0
      ? `${formatQuantity(reservation.available)} ${baseFromPair()}`
      : '--';
    const apply = $('[data-risk-sizing-apply]');
    if (apply) apply.disabled = !(reservation.available > 0);
    const status = $('#riskSizingStatus');
    if (status) {
      const detail = reservationCopy(reservation);
      status.textContent = reservation.available > 0
        ? `现货卖出按真实可用持仓上限计算${detail ? `（${detail}）` : ''}`
        : `没有可用持仓${detail ? `（${detail}）` : ''}`;
      status.className = `risk-sizing-status ${reservation.available > 0 ? (detail ? 'warning' : 'positive') : 'negative'}`;
    }
  }

  function activeTrailingStrategies(symbol = symbolFromPair()) {
    const exit = readJson(EXIT_KEY, { strategies: [] });
    return (Array.isArray(exit.strategies) ? exit.strategies : [])
      .filter(strategy => strategy.kind === 'trailing_stop'
        && strategy.symbol === symbol
        && strategy.status === 'active'
        && numberFrom(strategy.triggerPrice) > 0);
  }

  function formatPrice(value) {
    const text = String($('#lastPrice')?.textContent || '').replace(/,/g, '');
    const decimals = text.includes('.') ? text.split('.')[1].replace(/[^0-9]/g, '').length : 2;
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: Math.min(8, Math.max(2, decimals)),
      maximumFractionDigits: Math.min(8, Math.max(2, decimals)),
    });
  }

  function syncTrailingChartLines() {
    const layer = $('.chart-trade-layer');
    const canvas = $('#chartCanvas');
    if (!layer || !canvas) return;
    $$('.trailing-stop-line[data-reservation-coordinated="true"]', layer).forEach(line => line.remove());
    const max = numberFrom(canvas.dataset.max);
    const min = numberFrom(canvas.dataset.min);
    const top = numberFrom(canvas.dataset.top);
    const height = numberFrom(canvas.dataset.priceHeight);
    if (!(max > min) || !(height > 0)) return;
    activeTrailingStrategies().forEach((strategy, index) => {
      const price = numberFrom(strategy.triggerPrice);
      const y = top + ((max - price) / (max - min)) * height;
      if (y < top - 2 || y > top + height + 2) return;
      const line = document.createElement('div');
      line.className = 'chart-price-line trailing-stop-line';
      line.dataset.reservationCoordinated = 'true';
      line.dataset.exitStrategyId = strategy.id;
      line.dataset.markerPrice = String(price);
      line.style.top = `${y}px`;
      line.style.setProperty('--trade-label-shift', `${index * 11}px`);
      line.innerHTML = `<span>追踪止损 ${formatPrice(price)} · ${formatQuantity(strategy.quantity)} ${baseFromPair()}</span>`;
      layer.append(line);
    });
  }

  function syncAll() {
    syncOcoAvailability();
    syncRiskSizingSell();
    syncTrailingChartLines();
    const reservation = snapshot();
    document.documentElement.dataset.reservationAvailable = String(reservation.available);
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncAll, 35);
  }

  function blockOverAllocatedOco(event) {
    if (!event.target.closest?.('#createOcoOrder')) return;
    const quantity = numberFrom($('#ocoQuantity')?.value);
    const reservation = snapshot();
    if (!(quantity > reservation.available + 1e-10)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const status = $('#advancedOcoStatus');
    if (status) {
      const detail = reservationCopy(reservation);
      status.textContent = `当前最多可用 ${formatQuantity(reservation.available)} ${baseFromPair()}${detail ? `（${detail}）` : ''}`;
      status.className = 'advanced-oco-status danger';
    }
  }

  function prepareRiskApply(event) {
    if (!event.target.closest?.('[data-risk-sizing-apply]') || currentSide() !== 'sell') return;
    syncRiskSizingSell();
  }

  function observe() {
    document.addEventListener('click', blockOverAllocatedOco, true);
    document.addEventListener('click', prepareRiskApply, true);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-side], [data-symbol], [data-order-type], [data-cancel-order], [data-cancel-exit]')) {
        scheduleSync();
      }
    });
    document.addEventListener('input', event => {
      if (event.target.matches?.('#ocoQuantity, #riskStopPrice, #riskTargetPrice, #riskPercent')) scheduleSync();
    });
    const observer = new MutationObserver(scheduleSync);
    ['#positionsBody', '#ordersBody', '#activePair', '#chartCanvas', '.chart-trade-layer', '#advancedExitList']
      .map(selector => $(selector))
      .filter(Boolean)
      .forEach(element => observer.observe(element, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: element.id === 'chartCanvas',
        attributeFilter: element.id === 'chartCanvas' ? ['data-max', 'data-min', 'data-top', 'data-price-height'] : undefined,
      }));
    window.addEventListener('storage', event => {
      if ([CORE_KEY, EXIT_KEY].includes(event.key)) scheduleSync();
    });
    window.addEventListener('resize', scheduleSync);
    setInterval(syncAll, 300);
  }

  function init() {
    window.AtlasReservations = { snapshot };
    observe();
    syncAll();
    document.documentElement.dataset.reservationCoordinator = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
