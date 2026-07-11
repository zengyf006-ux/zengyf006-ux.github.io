(() => {
  'use strict';
  if (window.__ATLAS_PERPETUAL_MARKET_READINESS__) return;
  window.__ATLAS_PERPETUAL_MARKET_READINESS__ = true;

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const status = (message, level = '') => {
    const element = document.querySelector('#perpFormStatus');
    if (!element) return;
    element.textContent = message;
    element.className = `perp-form-status ${level}`.trim();
  };
  const snapshotReady = () => {
    const market = window.AtlasPerpetual?.getSnapshot?.().market;
    return market?.freshness === 'live' && Number(market.markPrice) > 0;
  };

  async function waitForLive(symbol, timeoutMs = 3000) {
    if (snapshotReady()) return true;
    const engine = window.AtlasMarketDataEngine;
    const spotSymbol = String(symbol || 'BTC-USDT-SWAP').replace('-USDT-SWAP', 'USDT');
    try {
      if (engine?.getState?.().symbol !== spotSymbol) {
        await engine.switchSession?.({ symbol: spotSymbol, interval: engine.getState?.().interval || '1h' });
      }
    } catch {}
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (snapshotReady()) return true;
      await sleep(60);
    }
    return snapshotReady();
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-perp-submit]');
    if (!button || button.dataset.perpLiveReady === 'true') return;
    if (snapshotReady()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.dataset.perpWaiting === 'true') return;
    button.dataset.perpWaiting = 'true';
    button.disabled = true;
    status('正在连接实时标记价格，连接成功后自动继续下单…');

    const ready = await waitForLive(document.querySelector('#perpSymbol')?.value);
    button.disabled = false;
    delete button.dataset.perpWaiting;
    if (!ready) {
      status('标记价格仍未进入实时状态；为避免错误强平计算，本次未开仓。', 'negative');
      return;
    }

    button.dataset.perpLiveReady = 'true';
    button.click();
    queueMicrotask(() => delete button.dataset.perpLiveReady);
  }, true);

  document.documentElement.dataset.perpetualMarketReadiness = 'ready';
})();
