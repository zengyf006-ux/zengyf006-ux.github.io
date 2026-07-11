(() => {
  'use strict';
  if (window.__ATLAS_RISK_POSITION_SIZING__) return;
  window.__ATLAS_RISK_POSITION_SIZING__ = true;

  const CORE_STORAGE_KEY = 'atlasX.pro.v1';
  const PLAN_STORAGE_KEY = 'atlasX.pro.riskPlans.v1';
  const FEE_RATE = 0.0008;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let renderedSymbol = '';
  let refreshTimer = 0;

  function numberFrom(value) {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readCoreState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CORE_STORAGE_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function readPlans() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writePlans(plans) {
    try {
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plans));
    } catch {}
  }

  function activeSymbol() {
    return readCoreState().activeSymbol || ($('#activePair')?.textContent || 'BTC/USDT').replace('/', '');
  }

  function currentSide() {
    return $('.side-selector [data-side].active')?.dataset.side === 'sell' ? 'sell' : 'buy';
  }

  function currentOrderType() {
    return $('.order-type-tabs [data-order-type].active')?.dataset.orderType || 'market';
  }

  function entryPrice() {
    if (currentOrderType() !== 'market') {
      const orderPrice = numberFrom($('#orderPrice')?.value);
      if (orderPrice > 0) return orderPrice;
    }
    return numberFrom($('#lastPrice')?.textContent) || numberFrom($('#mobileLastPrice')?.textContent);
  }

  function accountEquity() {
    const visible = numberFrom($('#accountEquity')?.textContent);
    if (visible > 0) return visible;
    const state = readCoreState();
    const cash = Number(state.cash) || 0;
    const positions = Array.isArray(state.positions) ? state.positions : [];
    return cash + positions.reduce((sum, position) => sum + Number(position.qty || 0) * Number(position.entry || 0), 0);
  }

  function availableCash() {
    const visible = numberFrom($('#availableBalance')?.textContent);
    if (visible >= 0) return visible;
    return Number(readCoreState().cash) || 0;
  }

  function heldQuantity(symbol = activeSymbol()) {
    const state = readCoreState();
    return (Array.isArray(state.positions) ? state.positions : [])
      .filter(position => position.symbol === symbol)
      .reduce((sum, position) => sum + Number(position.qty || 0), 0);
  }

  function quantityPrecision(price) {
    return price > 1000 ? 6 : 4;
  }

  function formatNumber(value, digits = 2) {
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function calculateRiskSizing({
    side,
    equity,
    availableCash: cash,
    heldQuantity: held,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    riskPercent,
    feeRate = FEE_RATE,
  }) {
    const result = {
      valid: false,
      reason: '',
      riskBudget: 0,
      quantity: 0,
      maxLoss: 0,
      reward: 0,
      riskReward: 0,
      cappedBy: '',
    };

    if (![equity, entry, riskPercent].every(value => Number.isFinite(value) && value > 0)) {
      result.reason = '账户权益、入场价或风险比例无效';
      return result;
    }
    if (riskPercent < 0.1 || riskPercent > 5) {
      result.reason = '单笔风险必须在 0.1%–5%';
      return result;
    }

    if (side === 'sell') {
      if (!(held > 0)) {
        result.reason = '当前交易对没有可卖持仓';
        return result;
      }
      result.valid = true;
      result.quantity = held;
      result.cappedBy = 'position';
      result.reason = '现货卖出按可用持仓上限计算';
      return result;
    }

    if (!(stop > 0)) {
      result.reason = '填写止损价后计算建议仓位';
      return result;
    }
    if (stop >= entry) {
      result.reason = '买入计划的止损价必须低于入场价';
      return result;
    }
    if (target > 0 && target <= entry) {
      result.reason = '买入计划的目标价必须高于入场价';
      return result;
    }

    const riskBudget = equity * riskPercent / 100;
    const unitRisk = Math.abs(entry - stop) + entry * feeRate + stop * feeRate;
    const rawQuantity = riskBudget / Math.max(unitRisk, Number.EPSILON);
    const cashCap = Math.max(0, cash) / Math.max(entry * (1 + feeRate), Number.EPSILON);
    const quantity = Math.max(0, Math.min(rawQuantity, cashCap));
    if (!(quantity > 0)) {
      result.reason = '风险预算或可用余额不足';
      return result;
    }

    result.valid = true;
    result.riskBudget = riskBudget;
    result.quantity = quantity;
    result.maxLoss = quantity * unitRisk;
    result.cappedBy = cashCap + 1e-12 < rawQuantity ? 'cash' : '';
    if (target > 0) {
      result.reward = quantity * (target - entry) - quantity * (entry + target) * feeRate;
      result.riskReward = result.maxLoss > 0 ? result.reward / result.maxLoss : 0;
    }
    result.reason = result.cappedBy === 'cash' ? '已按可用余额上限调整' : '风险预算内';
    return result;
  }

  window.AtlasRiskSizing = { calculate: calculateRiskSizing };

  function markup() {
    return `<section class="risk-sizing-panel" data-risk-sizing-state="idle" data-valid="false">
      <button class="risk-sizing-toggle" type="button" aria-expanded="false">
        <span><b>交易计划</b><small>按止损距离计算建议仓位</small></span>
        <strong id="riskSizingCompact">风险 1.00%</strong>
        <i aria-hidden="true"></i>
      </button>
      <div class="risk-sizing-body" hidden>
        <div class="risk-sizing-inputs">
          <label><span>入场价</span><input id="riskEntryPrice" inputmode="decimal" readonly><b>USDT</b></label>
          <label><span>止损价</span><input id="riskStopPrice" inputmode="decimal" autocomplete="off" placeholder="必须低于入场价"><b>USDT</b></label>
          <label><span>目标价</span><input id="riskTargetPrice" inputmode="decimal" autocomplete="off" placeholder="可选"><b>USDT</b></label>
          <label><span>单笔风险</span><input id="riskPercent" inputmode="decimal" autocomplete="off" value="1"><b>%</b></label>
        </div>
        <div class="risk-sizing-presets" aria-label="单笔风险快捷选择">
          <button type="button" data-risk-percent="0.25">0.25%</button>
          <button type="button" data-risk-percent="0.5">0.5%</button>
          <button class="active" type="button" data-risk-percent="1">1%</button>
          <button type="button" data-risk-percent="2">2%</button>
        </div>
        <div class="risk-sizing-results">
          <div><span>风险预算</span><b id="riskBudgetValue">--</b></div>
          <div><span>建议数量</span><b id="riskQuantityValue">--</b></div>
          <div><span>预计最大亏损</span><b id="riskMaxLossValue">--</b></div>
          <div><span>盈亏比</span><b id="riskRewardValue">--</b></div>
        </div>
        <p class="risk-sizing-status" id="riskSizingStatus">填写止损价后计算建议仓位</p>
        <button class="risk-sizing-apply" type="button" data-risk-sizing-apply disabled>使用建议数量</button>
        <small class="risk-sizing-disclaimer">基于当前模拟权益、止损距离和预计双边手续费计算，不构成投资建议。</small>
      </div>
    </section>`;
  }

  function mount() {
    const anchor = $('.advanced-options');
    if (!anchor || $('.risk-sizing-panel')) return Boolean($('.risk-sizing-panel'));
    anchor.insertAdjacentHTML('afterend', markup());
    bindPanelEvents();
    syncContext(true);
    return true;
  }

  function getPlan(symbol = activeSymbol()) {
    const plan = readPlans()[symbol];
    return plan && typeof plan === 'object' ? plan : { riskPercent: 1, stopPrice: '', targetPrice: '' };
  }

  function saveCurrentPlan() {
    const symbol = activeSymbol();
    if (!symbol) return;
    const plans = readPlans();
    plans[symbol] = {
      riskPercent: Math.min(5, Math.max(0.1, numberFrom($('#riskPercent')?.value) || 1)),
      stopPrice: $('#riskStopPrice')?.value || '',
      targetPrice: $('#riskTargetPrice')?.value || '',
    };
    writePlans(plans);
  }

  function loadPlan(symbol) {
    const plan = getPlan(symbol);
    const riskInput = $('#riskPercent');
    const stopInput = $('#riskStopPrice');
    const targetInput = $('#riskTargetPrice');
    if (riskInput) riskInput.value = String(plan.riskPercent ?? 1);
    if (stopInput) stopInput.value = plan.stopPrice ?? '';
    if (targetInput) targetInput.value = plan.targetPrice ?? '';
    updatePresetState();
  }

  function updatePresetState() {
    const current = numberFrom($('#riskPercent')?.value);
    $$('[data-risk-percent]').forEach(button => {
      button.classList.toggle('active', Math.abs(Number(button.dataset.riskPercent) - current) < 0.0001);
    });
  }

  function renderCalculation() {
    const panel = $('.risk-sizing-panel');
    if (!panel) return;
    const entry = entryPrice();
    const stop = numberFrom($('#riskStopPrice')?.value);
    const target = numberFrom($('#riskTargetPrice')?.value);
    const percent = numberFrom($('#riskPercent')?.value) || 1;
    const symbol = activeSymbol();
    const result = calculateRiskSizing({
      side: currentSide(),
      equity: accountEquity(),
      availableCash: availableCash(),
      heldQuantity: heldQuantity(symbol),
      entryPrice: entry,
      stopPrice: stop,
      targetPrice: target,
      riskPercent: percent,
    });

    const precision = quantityPrecision(entry);
    const base = ($('#quantityUnit')?.textContent || symbol.replace('USDT', '') || '资产').trim();
    $('#riskEntryPrice').value = entry > 0 ? String(entry.toFixed(Math.min(8, Math.max(2, numberFrom($('#lastPrice')?.textContent) < 1 ? 5 : 2)))) : '';
    $('#riskSizingCompact').textContent = `风险 ${percent.toFixed(2)}%`;
    $('#riskBudgetValue').textContent = result.riskBudget > 0 ? `${formatNumber(result.riskBudget, 2)} USDT` : '--';
    $('#riskQuantityValue').textContent = result.quantity > 0 ? `${formatNumber(result.quantity, precision)} ${base}` : '--';
    $('#riskMaxLossValue').textContent = result.maxLoss > 0 ? `${formatNumber(result.maxLoss, 2)} USDT` : '--';
    $('#riskRewardValue').textContent = target > 0 && result.valid ? `${result.riskReward.toFixed(2)} : 1` : '--';
    $('#riskSizingStatus').textContent = result.reason;
    $('#riskSizingStatus').className = `risk-sizing-status ${result.valid ? (result.cappedBy ? 'warning' : 'positive') : 'negative'}`;
    const applyButton = $('[data-risk-sizing-apply]');
    if (applyButton) applyButton.disabled = !result.valid || !(result.quantity > 0);

    panel.dataset.valid = String(result.valid);
    panel.dataset.riskBudget = String(result.riskBudget);
    panel.dataset.suggestedQuantity = String(result.quantity);
    panel.dataset.maxLoss = String(result.maxLoss);
    panel.dataset.riskReward = String(result.riskReward);
    panel.dataset.cappedBy = result.cappedBy;
    panel.dataset.symbol = symbol;
    panel.dataset.riskSide = currentSide();
    panel.dataset.riskSizingState = result.valid ? 'ready' : 'invalid';
  }

  function syncContext(forcePlan = false) {
    if (!mount()) return;
    const symbol = activeSymbol();
    if (forcePlan || symbol !== renderedSymbol) {
      renderedSymbol = symbol;
      loadPlan(symbol);
    }
    renderCalculation();
  }

  function scheduleRefresh(forcePlan = false) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => syncContext(forcePlan), 30);
  }

  function applySuggestedQuantity() {
    const panel = $('.risk-sizing-panel');
    const quantity = Number(panel?.dataset.suggestedQuantity || 0);
    const entry = entryPrice();
    if (!(quantity > 0) || panel?.dataset.valid !== 'true') return;
    const quantityInput = $('#orderQuantity');
    if (!quantityInput) return;
    quantityInput.value = quantity.toFixed(quantityPrecision(entry));
    quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
    const status = $('#riskSizingStatus');
    if (status) {
      status.textContent = '建议数量已填入原订单表单';
      status.className = 'risk-sizing-status positive';
    }
  }

  function bindPanelEvents() {
    const toggle = $('.risk-sizing-toggle');
    const body = $('.risk-sizing-body');
    toggle?.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      if (body) body.hidden = expanded;
      scheduleRefresh();
    });

    ['#riskStopPrice', '#riskTargetPrice', '#riskPercent'].forEach(selector => {
      $(selector)?.addEventListener('input', () => {
        updatePresetState();
        saveCurrentPlan();
        renderCalculation();
      });
    });

    $$('[data-risk-percent]').forEach(button => {
      button.addEventListener('click', () => {
        const input = $('#riskPercent');
        if (input) input.value = button.dataset.riskPercent;
        updatePresetState();
        saveCurrentPlan();
        renderCalculation();
      });
    });
    $('[data-risk-sizing-apply]')?.addEventListener('click', applySuggestedQuantity);
  }

  function bindContextEvents() {
    document.addEventListener('click', event => {
      if (event.target.closest('[data-symbol]')) scheduleRefresh(true);
      if (event.target.closest('[data-side], [data-order-type]')) scheduleRefresh();
    });
    ['#orderPrice', '#orderTotal', '#orderQuantity'].forEach(selector => {
      $(selector)?.addEventListener('input', () => scheduleRefresh());
    });

    const watch = ['#activePair', '#lastPrice', '#accountEquity', '#availableBalance']
      .map(selector => $(selector))
      .filter(Boolean);
    if (watch.length) {
      const observer = new MutationObserver(() => scheduleRefresh(true));
      watch.forEach(element => observer.observe(element, { childList: true, characterData: true, subtree: true }));
    }
  }

  function init() {
    if (!mount()) {
      const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    bindContextEvents();
    document.documentElement.dataset.riskSizing = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
