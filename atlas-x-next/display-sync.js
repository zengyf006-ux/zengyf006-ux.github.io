(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const numberFrom = text => Number(String(text || '').replace(/[^0-9.-]/g, '')) || 0;
  const format = (value, digits = 2) => Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  function loadFinalStyles() {
    if (document.querySelector('link[href="./finalize.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './finalize.css';
    document.head.append(link);
  }

  function mountToastInHeader() {
    const toast = $('#toast');
    const actions = $('.topbar-actions');
    if (toast && actions && !actions.contains(toast)) {
      actions.insertBefore(toast, actions.firstChild);
    }
  }

  function currentPrice() {
    return numberFrom($('#lastPrice')?.textContent);
  }

  function precisionForPrice(price) {
    return price >= 10000 ? 1 : 2;
  }

  function replaceLabel(element, label) {
    if (!element) return;
    const textNode = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = `${label} `;
  }

  function replaceLegend(element, label) {
    if (!element) return;
    const textNode = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = label;
  }

  function syncIndicatorDisplay() {
    const price = currentPrice();
    if (!price) return;
    const digits = precisionForPrice(price);
    const bollActive = $('[data-indicator="boll"]')?.classList.contains('active');
    const first = $('.chart-info-bar span:first-child');
    const second = $('.chart-info-bar span:nth-child(2)');
    const firstValue = $('#ema10Value');
    const secondValue = $('#ema20Value');
    const legends = $$('.chart-foot > span:not(.data-source)');

    if (bollActive) {
      replaceLabel(first, 'BOLL(UP)');
      replaceLabel(second, 'BOLL(DN)');
      if (firstValue) firstValue.textContent = format(price * 1.012, digits);
      if (secondValue) secondValue.textContent = format(price * 0.988, digits);
      replaceLegend(legends[0], 'BOLL 上轨');
      replaceLegend(legends[1], 'BOLL 下轨');
    } else {
      replaceLabel(first, 'EMA(10)');
      replaceLabel(second, 'EMA(20)');
      if (firstValue) firstValue.textContent = format(price * 0.9986, digits);
      if (secondValue) secondValue.textContent = format(price * 0.9951, digits);
      replaceLegend(legends[0], 'EMA 10');
      replaceLegend(legends[1], 'EMA 20');
    }
  }

  function createAccountOverview() {
    const panel = $('.account-panel');
    const tableWrap = panel?.querySelector('.account-table-wrap');
    if (!panel || !tableWrap || panel.querySelector('.mobile-account-overview')) return;

    const overview = document.createElement('div');
    overview.className = 'mobile-account-overview';
    overview.innerHTML = `
      <div><span>账户权益</span><b id="mobileEquity">100,000.00</b></div>
      <div><span>可用资金</span><b id="mobileAvailable">100,000.00</b></div>
      <div><span>风险占用</span><b id="mobileRisk">0.00%</b></div>`;
    tableWrap.before(overview);

    const insight = document.createElement('div');
    insight.className = 'mobile-account-insight';
    insight.innerHTML = `
      <div><span>账户风险水平</span><b id="mobileRiskLevel">安全</b></div>
      <div class="risk-track"><i id="mobileRiskBar"></i></div>
      <small>模拟资金与订单仅保存在当前浏览器，不涉及真实资产。</small>`;
    tableWrap.after(insight);
  }

  function syncAccountOverview() {
    const equity = numberFrom($('.account-summary b')?.textContent) || 100000;
    let occupied = 0;
    $$('#accountBody tr:not(.empty-row)').forEach(row => {
      const quantity = numberFrom(row.querySelector('[data-label="持仓数量"]')?.textContent);
      const entry = numberFrom(row.querySelector('[data-label="开仓均价"]')?.textContent);
      if (quantity > 0 && entry > 0) occupied += quantity * entry;
    });
    const available = Math.max(0, 100000 - occupied);
    const risk = equity > 0 ? Math.min(100, occupied / equity * 100) : 0;
    const riskLevel = risk < 20 ? '安全' : risk < 50 ? '适中' : '偏高';

    if ($('#mobileEquity')) $('#mobileEquity').textContent = format(equity);
    if ($('#mobileAvailable')) $('#mobileAvailable').textContent = format(available);
    if ($('#mobileRisk')) $('#mobileRisk').textContent = `${risk.toFixed(2)}%`;
    if ($('#mobileRiskLevel')) {
      $('#mobileRiskLevel').textContent = riskLevel;
      $('#mobileRiskLevel').className = risk >= 50 ? 'negative' : 'positive';
    }
    if ($('#mobileRiskBar')) $('#mobileRiskBar').style.setProperty('--risk', `${Math.max(2, risk)}%`);
  }

  function suppressInitializationToast() {
    const toast = $('#toast');
    if (!toast) return;
    toast.classList.remove('show');
    toast.textContent = '';
  }

  function init() {
    loadFinalStyles();
    mountToastInHeader();
    createAccountOverview();
    requestAnimationFrame(() => {
      suppressInitializationToast();
      syncIndicatorDisplay();
      syncAccountOverview();
    });

    const price = $('#lastPrice');
    const tools = $('.chart-tools');
    const accountBody = $('#accountBody');
    const accountSummary = $('.account-summary');
    if (price) new MutationObserver(syncIndicatorDisplay).observe(price, { childList: true, characterData: true, subtree: true });
    if (tools) new MutationObserver(syncIndicatorDisplay).observe(tools, { attributes: true, subtree: true, attributeFilter: ['class'] });
    if (accountBody) new MutationObserver(syncAccountOverview).observe(accountBody, { childList: true, subtree: true });
    if (accountSummary) new MutationObserver(syncAccountOverview).observe(accountSummary, { childList: true, characterData: true, subtree: true });

    document.addEventListener('click', event => {
      if (event.target.closest('[data-market], [data-indicator], [data-indicator-choice]')) {
        requestAnimationFrame(syncIndicatorDisplay);
      }
      if (event.target.closest('#submitOrder, [data-close-position], [data-cancel-order], [data-account-view]')) {
        requestAnimationFrame(syncAccountOverview);
      }
    });
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
