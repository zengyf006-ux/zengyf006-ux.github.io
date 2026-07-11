(() => {
  'use strict';
  if (window.__ATLAS_PERPETUAL_SUBMIT_OWNER__) return;
  window.__ATLAS_PERPETUAL_SUBMIT_OWNER__ = true;

  const $ = selector => document.querySelector(selector);
  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  let submitting = false;

  function setStatus(message, level = '') {
    const status = $('#perpFormStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `perp-form-status ${level}`.trim();
    status.dataset.lastSubmitLevel = level || 'normal';
  }

  function marketReady() {
    const market = window.AtlasPerpetual?.getSnapshot?.().market;
    return market?.freshness === 'live' && positive(market.markPrice) > 0;
  }

  async function waitForMarket(symbol, timeoutMs = 3500) {
    if (marketReady()) return true;
    const engine = window.AtlasMarketDataEngine;
    const spotSymbol = String(symbol || 'BTC-USDT-SWAP').replace('-USDT-SWAP', 'USDT');
    try {
      if (engine?.getState?.().symbol !== spotSymbol) {
        await engine?.switchSession?.({ symbol: spotSymbol, interval: engine?.getState?.().interval || '1h' });
      }
    } catch {}
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (marketReady()) return true;
      await sleep(60);
    }
    return marketReady();
  }

  function activeValue(selector, dataKey, fallback) {
    return document.querySelector(`${selector}.active`)?.dataset?.[dataKey] || fallback;
  }

  function readOrder(side) {
    const symbol = $('#perpSymbol')?.value || 'BTC-USDT-SWAP';
    const snapshot = window.AtlasPerpetual?.getSnapshot?.();
    const markPrice = positive(snapshot?.market?.markPrice || snapshot?.market?.lastPrice);
    const quantityInput = positive($('#perpQuantity')?.value);
    const notionalInput = positive($('#perpNotional')?.value);
    const quantity = quantityInput || (markPrice > 0 ? notionalInput / markPrice : 0);
    const orderType = activeValue('[data-perp-order-type]', 'perpOrderType', 'market');
    const marginMode = activeValue('[data-perp-margin-mode]', 'perpMarginMode', 'cross');
    const postOnly = Boolean($('#perpPostOnly')?.checked);
    return {
      symbol,
      side: side === 'short' ? 'sell' : 'buy',
      positionSide: side === 'short' ? 'short' : 'long',
      type: orderType,
      quantity,
      price: positive($('#perpPrice')?.value) || undefined,
      triggerPrice: positive($('#perpTriggerPrice')?.value) || undefined,
      triggerDirection: side === 'short' ? 'below' : 'above',
      marginMode,
      leverage: positive($('#perpLeverage')?.value, 10),
      reduceOnly: Boolean($('#perpReduceOnly')?.checked),
      timeInForce: postOnly ? 'POST_ONLY' : 'GTC',
    };
  }

  async function submit(side, button) {
    if (submitting) return;
    submitting = true;
    button.disabled = true;
    button.dataset.perpSubmitting = 'true';
    document.documentElement.dataset.perpetualSubmitState = 'validating';
    try {
      const symbol = $('#perpSymbol')?.value || 'BTC-USDT-SWAP';
      if (!marketReady()) {
        setStatus('正在连接实时标记价格，连接成功后自动继续下单…');
        const ready = await waitForMarket(symbol);
        if (!ready) {
          document.documentElement.dataset.perpetualSubmitState = 'blocked_stale_market';
          setStatus('标记价格仍未进入实时状态；为避免错误保证金和强平计算，本次未开仓。', 'negative');
          return;
        }
      }

      const input = readOrder(side);
      if (!(input.quantity > 0)) {
        document.documentElement.dataset.perpetualSubmitState = 'rejected_invalid_quantity';
        setStatus('请输入有效合约数量或金额。', 'negative');
        return;
      }

      document.documentElement.dataset.perpetualSubmitState = 'submitting';
      setStatus('正在校验保证金、风险档位和订单参数…');
      const result = await window.AtlasPerpetual.submitOrder(input);
      document.documentElement.dataset.perpetualLastOrderResult = result.ok ? 'ok' : String(result.errorCode || 'rejected');
      if (!result.ok) {
        document.documentElement.dataset.perpetualSubmitState = 'rejected';
        setStatus(result.message || result.errorCode || '委托失败', 'negative');
        return;
      }

      document.documentElement.dataset.perpetualSubmitState = 'completed';
      setStatus(result.status === 'open' || result.status === 'trigger_wait'
        ? '合约委托已进入等待队列。'
        : '模拟合约成交完成。', 'positive');
      window.dispatchEvent(new CustomEvent('atlas:perpetual-ui-refresh', { detail: { result } }));
    } catch (error) {
      document.documentElement.dataset.perpetualSubmitState = 'error';
      document.documentElement.dataset.perpetualLastOrderResult = 'error';
      setStatus(`合约提交失败：${error?.message || error}`, 'negative');
      console.error('ATLAS perpetual submit failed', error);
    } finally {
      button.disabled = false;
      delete button.dataset.perpSubmitting;
      submitting = false;
    }
  }

  window.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-perp-submit]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submit(button.dataset.perpSubmit, button);
  }, true);

  window.AtlasPerpetualSubmit = Object.freeze({
    submit: side => {
      const button = document.querySelector(`[data-perp-submit="${side === 'short' ? 'short' : 'long'}"]`);
      return button ? submit(side, button) : Promise.resolve();
    },
    readOrder,
  });

  document.documentElement.dataset.perpetualSubmitOwner = 'ready';
})();
