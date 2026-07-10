(() => {
  'use strict';
  if (window.__ATLAS_DATA_HEALTH__) return;
  window.__ATLAS_DATA_HEALTH__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function router() {
    return window.__ATLAS_DATA_ROUTER__;
  }

  function modeLabel(snapshot) {
    const shellMode = $('.pro-shell')?.dataset.feedMode;
    if (router()?.qaMode || shellMode === 'demo') return '演示行情';
    if (shellMode === 'live') return '实时行情';
    return '连接中';
  }

  function healthState(snapshot) {
    const shellMode = $('.pro-shell')?.dataset.feedMode;
    if (router()?.qaMode || shellMode === 'demo') return 'demo';
    if (shellMode === 'live' || snapshot?.websocket?.status === 'connected') return 'live';
    return 'routing';
  }

  function endpointText(route, fallback) {
    if (!route) return fallback;
    if (route.status === 'qa-demo' || route.status === 'qa-offline') return '本地可重复演示源';
    return route.host || fallback;
  }

  function routeStatus(route) {
    if (!route) return '等待连接';
    const labels = {
      connected: '已连接', retrying: '切换端点', failed: '连接失败', disconnected: '已断开',
      'qa-demo': '演示数据', 'qa-offline': '离线模拟', 'terminal-http': `HTTP ${route.httpStatus || ''}`,
    };
    return labels[route.status] || route.status || '未知';
  }

  function createButtons() {
    if (!$('[data-open-data-health="desktop"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'data-health-button';
      button.dataset.openDataHealth = 'desktop';
      button.setAttribute('aria-label', '查看行情连接健康');
      button.innerHTML = '<i></i><span>数据源</span>';
      $('.connection-detail')?.append(button);
    }
    if (!$('[data-open-data-health="mobile"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-data-health-button';
      button.dataset.openDataHealth = 'mobile';
      button.setAttribute('aria-label', '查看行情连接健康');
      button.innerHTML = '<i></i>';
      $('[data-open-price-alert="mobile"]')?.before(button);
    }
  }

  function createPanel() {
    if ($('#dataHealthPanel')) return;
    const panel = document.createElement('section');
    panel.id = 'dataHealthPanel';
    panel.className = 'data-health-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'dataHealthTitle');
    panel.innerHTML = `
      <header><div><strong id="dataHealthTitle">行情连接健康</strong><small>公开市场数据路由与自动降级</small></div><button type="button" data-close-data-health aria-label="关闭">×</button></header>
      <section class="data-health-summary">
        <div><span>当前模式</span><b id="dataHealthMode">连接中</b></div>
        <div><span>端点切换</span><b id="dataHealthAttempts">0 次</b></div>
        <div><span>最近延迟</span><b id="dataHealthLatency">-- ms</b></div>
      </section>
      <div class="data-health-routes">
        <div class="data-health-route"><i>REST</i><div><strong id="dataHealthRestHost">等待K线请求</strong><small id="dataHealthRestStatus">等待连接</small></div><span id="dataHealthRestMeta">--</span></div>
        <div class="data-health-route"><i>WS</i><div><strong id="dataHealthWsHost">等待实时流</strong><small id="dataHealthWsStatus">等待连接</small></div><span id="dataHealthWsMeta">--</span></div>
      </div>
      <p class="data-health-note">仅连接交易所公开市场数据端点，不使用API密钥，不读取真实账户，不执行真实交易。所有订单与资产均为当前浏览器中的模拟记录。</p>`;
    document.body.append(panel);
  }

  function updatePanel() {
    const snapshot = router()?.snapshot?.() || {};
    const rest = snapshot.rest;
    const websocket = snapshot.websocket;
    const state = healthState(snapshot);
    $$('[data-open-data-health]').forEach(button => {
      button.dataset.healthState = state;
      button.title = `${modeLabel(snapshot)} · ${endpointText(websocket || rest, '等待端点')}`;
    });

    if (!$('#dataHealthPanel')) return;
    $('#dataHealthMode').textContent = modeLabel(snapshot);
    const attempts = Math.max(rest?.attempt || 0, websocket?.attempt || 0);
    $('#dataHealthAttempts').textContent = `${attempts} 次`;
    const latest = [rest, websocket].filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    $('#dataHealthLatency').textContent = Number.isFinite(latest?.latency) ? `${latest.latency} ms` : '-- ms';
    $('#dataHealthRestHost').textContent = endpointText(rest, '等待K线请求');
    $('#dataHealthRestStatus').textContent = routeStatus(rest);
    $('#dataHealthRestMeta').textContent = rest?.attempt ? `#${rest.attempt}` : '--';
    $('#dataHealthWsHost').textContent = endpointText(websocket, '等待实时流');
    $('#dataHealthWsStatus').textContent = routeStatus(websocket);
    $('#dataHealthWsMeta').textContent = websocket?.attempt ? `#${websocket.attempt}` : '--';
  }

  function openPanel() {
    const panel = $('#dataHealthPanel');
    if (!panel) return;
    updatePanel();
    panel.hidden = false;
    $$('[data-open-data-health]').forEach(button => button.classList.add('active'));
  }

  function closePanel() {
    const panel = $('#dataHealthPanel');
    if (panel) panel.hidden = true;
    $$('[data-open-data-health]').forEach(button => button.classList.remove('active'));
  }

  function bind() {
    window.addEventListener('atlas:data-route', updatePanel);
    const shell = $('.pro-shell');
    if (shell) new MutationObserver(updatePanel).observe(shell, { attributes: true, attributeFilter: ['data-feed-mode'] });
    document.addEventListener('click', event => {
      if (event.target.closest('[data-open-data-health]')) {
        event.preventDefault();
        event.stopPropagation();
        openPanel();
        return;
      }
      if (event.target.closest('[data-close-data-health]')) {
        closePanel();
        return;
      }
      if (!event.target.closest('#dataHealthPanel')) closePanel();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('#dataHealthPanel')?.hidden) closePanel();
    });
  }

  function init() {
    createButtons();
    createPanel();
    bind();
    updatePanel();
    document.documentElement.dataset.dataHealth = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
