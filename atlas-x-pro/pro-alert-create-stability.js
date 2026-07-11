(() => {
  'use strict';
  if (window.__ATLAS_ALERT_CREATE_STABILITY__) return;
  window.__ATLAS_ALERT_CREATE_STABILITY__ = true;

  const numberFrom = value => {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  document.addEventListener('click', event => {
    const button = event.target.closest?.('#controlPopover.alert-center-popover #alertRuleCreate');
    if (!button) return;

    const api = window.AtlasAlertCenter;
    const direction = document.querySelector('#alertRuleDirection')?.value;
    const threshold = document.querySelector('#alertRuleThreshold')?.value;
    const pair = document.querySelector('#activePair')?.textContent?.trim() || 'BTC/USDT';
    const currentPrice = numberFrom(document.querySelector('#lastPrice')?.textContent);
    if (!api?.createPriceRule) return;

    // Commit from the captured form values before a live-price mutation can
    // replace the rules DOM. Stop the legacy bubble handler to avoid a second
    // rule from the same tap.
    event.preventDefault();
    event.stopImmediatePropagation();
    const result = api.createPriceRule({
      symbol: pair.replace('/', ''),
      type: direction,
      threshold,
      currentPrice,
    });

    queueMicrotask(() => {
      const status = document.querySelector('#alertRuleFormStatus');
      if (!status) return;
      status.textContent = result?.message || (result?.ok
        ? '提醒规则已创建并开始监听真实价格穿越。'
        : '无法创建提醒规则');
      status.className = result?.ok ? 'positive' : 'negative';
    });
  }, true);

  document.documentElement.dataset.alertCreateStability = 'ready';
})();