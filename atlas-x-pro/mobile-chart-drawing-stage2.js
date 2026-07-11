(() => {
  'use strict';
  if (window.__ATLAS_MOBILE_CHART_DRAWING_STAGE2__) return;
  window.__ATLAS_MOBILE_CHART_DRAWING_STAGE2__ = true;

  const LABELS = {
    crosshair: '十字光标',
    hline: '水平线',
    clear: '清除绘图',
    'order-price': '选择委托价',
    'plan-stop': '选择止损价',
    'plan-target': '选择目标价',
  };
  let mounted = false;

  function originalFor(value) {
    const escaped = CSS.escape(value);
    return document.querySelector(`.chart-drawing-tools [data-chart-tool="${escaped}"], .chart-tools [data-chart-tool="${escaped}"]`);
  }

  function sync() {
    document.querySelectorAll('[data-stage2-proxy-attribute="data-chart-tool"]')
      .forEach(proxy => {
        const value = proxy.dataset.stage2ProxyValue;
        const original = originalFor(value);
        const active = original?.classList.contains('active')
          || original?.getAttribute('aria-pressed') === 'true'
          || false;
        proxy.classList.toggle('active', active);
        proxy.setAttribute('aria-pressed', String(active));
      });
  }

  function collectOriginals() {
    const byValue = new Map();
    document.querySelectorAll('.chart-drawing-tools [data-chart-tool], .chart-tools [data-chart-tool]')
      .forEach(original => {
        const value = original.dataset.chartTool;
        if (value && !byValue.has(value)) byValue.set(value, original);
      });
    return [...byValue.values()];
  }

  function mount() {
    if (mounted) return true;
    const group = document.querySelector('[data-stage2-tools-group="drawing"]');
    const originals = collectOriginals();
    if (!group || !originals.length) return false;

    const existingActions = [...group.children];
    group.innerHTML = '';
    originals.forEach(original => {
      const value = original.dataset.chartTool;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.stage2ProxyAttribute = 'data-chart-tool';
      button.dataset.stage2ProxyValue = value;
      button.textContent = LABELS[value] || original.getAttribute('aria-label') || value;
      button.setAttribute('aria-label', LABELS[value] || value);
      group.append(button);
    });
    existingActions.forEach(button => group.append(button));

    const observer = new MutationObserver(sync);
    originals.forEach(original => observer.observe(original, {
      attributes: true,
      attributeFilter: ['class', 'aria-pressed'],
    }));
    mounted = true;
    sync();
    document.documentElement.dataset.mobileChartDrawingStage2 = 'ready';
    return true;
  }

  function init() {
    if (mount()) return;
    const observer = new MutationObserver(() => {
      if (mount()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
