(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const format = (value, digits) => Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  function currentPrice() {
    const text = $('#lastPrice')?.textContent || '0';
    return Number(text.replace(/,/g, '')) || 0;
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
    const legends = document.querySelectorAll('.chart-foot > span:not(.data-source)');

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

  function suppressInitializationToast() {
    const toast = $('#toast');
    if (!toast) return;
    toast.classList.remove('show');
    toast.textContent = '';
  }

  function init() {
    requestAnimationFrame(() => {
      suppressInitializationToast();
      syncIndicatorDisplay();
    });

    const price = $('#lastPrice');
    const tools = $('.chart-tools');
    if (price) new MutationObserver(syncIndicatorDisplay).observe(price, { childList: true, characterData: true, subtree: true });
    if (tools) new MutationObserver(syncIndicatorDisplay).observe(tools, { attributes: true, subtree: true, attributeFilter: ['class'] });

    document.addEventListener('click', event => {
      if (event.target.closest('[data-market], [data-indicator], [data-indicator-choice]')) {
        requestAnimationFrame(syncIndicatorDisplay);
      }
    });
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
