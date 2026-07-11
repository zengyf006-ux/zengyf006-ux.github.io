(() => {
  'use strict';
  if (window.__ATLAS_ALERT_CREATE_STABILITY__) return;
  window.__ATLAS_ALERT_CREATE_STABILITY__ = true;

  let lastCommit = { signature: '', at: 0 };

  const numberFrom = value => {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  function captureDraft() {
    const direction = document.querySelector('#alertRuleDirection')?.value;
    const threshold = document.querySelector('#alertRuleThreshold')?.value;
    const pair = document.querySelector('#activePair')?.textContent?.trim() || 'BTC/USDT';
    const currentPrice = numberFrom(document.querySelector('#lastPrice')?.textContent);
    return {
      symbol: pair.replace('/', ''),
      type: direction,
      threshold,
      currentPrice,
      signature: `${pair}|${direction}|${threshold}`,
    };
  }

  function showResult(result) {
    queueMicrotask(() => {
      const status = document.querySelector('#alertRuleFormStatus');
      if (!status) return;
      status.textContent = result?.message || (result?.ok
        ? '提醒规则已创建并开始监听真实价格穿越。'
        : '无法创建提醒规则');
      status.className = result?.ok ? 'positive' : 'negative';
    });
  }

  function commit(event) {
    const button = event.target.closest?.('#controlPopover.alert-center-popover #alertRuleCreate');
    if (!button) return false;
    const api = window.AtlasAlertCenter;
    if (!api?.createPriceRule) return false;

    const draft = captureDraft();
    const at = Date.now();
    if (lastCommit.signature === draft.signature && at - lastCommit.at < 900) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    lastCommit = { signature: draft.signature, at };
    const result = api.createPriceRule(draft);
    showResult(result);
    return true;
  }

  // The live price stream can replace the rules form between pointerdown and
  // click on mobile. Commit on pointerdown while the exact draft DOM still
  // exists, then suppress the synthetic click to avoid duplicate rules.
  document.addEventListener('pointerdown', commit, true);
  document.addEventListener('click', commit, true);

  document.documentElement.dataset.alertCreateStability = 'ready';
})();