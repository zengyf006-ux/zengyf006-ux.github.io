(() => {
  'use strict';
  if (window.__ATLAS_DATA_HEALTH__) return;
  window.__ATLAS_DATA_HEALTH__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function engine() {
    return window.AtlasMarketDataEngine;
  }

  function router() {
    return window.__ATLAS_DATA_ROUTER__;
  }

  function current() {
    const market = engine()?.getState?.() || null;
    const routes = router()?.snapshot?.() || {};
    return { market, routes };
  }

  function isFixture(market) {
    return market?.provider === 'fixture' || market?.source === 'fixture' || Boolean(window.__ATLAS_QA_MODE__);
  }

  function modeLabel(market) {
    if (!market) return '连接中';
    if (isFixture(market)) return '确定性测试行情';
    if (market.connectionState === 'live') return '实时行情';
    if (market.connectionState === 'reconnecting') return '重连中';
    if (market.connectionState === 'stale') return '数据已过期';
    if (market.connectionState === 'offline') return '离线';
    if (market.source === 'cache') return '缓存启动';
    return '连接中';
  }

  function healthState(market) {
    if (!market) return 'routing';
    if (isFixture(market)) return 'demo';
    return market.connectionState || 'routing';
  }

  function hostFromUrl(value, fallback) {
    try { return new URL(String(value)).host || fallback; }
    catch { return fallback; }
  }

  function gatewayHost() {
    return hostFromUrl(engine()?.gatewayBase, '统一行情网关');
  }

  function streamLabel(market) {
    if (!market) return '等待实时流';
    if (isFixture(market)) return '本地确定性测试源';
    if (market.source === 'direct') return `${String(market.provider || '公开市场').toUpperCase()} 直连流`;
    if (market.source === 'gateway') return `${String(market.provider || '公共市场').toUpperCase()} 网关流`;
    if (market.source === 'cache') return '浏览器行情缓存';
    return String(market.provider || '等待实时流').toUpperCase();
  }

  function statusText(market) {
    if (!market) return '等待连接';
    const labels = {
      booting: '正在启动',
      live: '已实时连接',
      reconnecting: '正在重连',
      stale: '数据已过期',
      offline: '当前离线',
    };
    return labels[market.connectionState] || market.connectionState || '等待连接';
  }

  function ageText(market) {
    if (!market?.lastReceivedAt) return '--';
    const age = Math.max(0, Date.now() - Number(market.lastReceivedAt));
    if (age < 1000) return '<1秒';
    if (age < 60_000) return `${Math.floor(age / 1000)}秒`;
    return `${Math.floor(age / 60_000)}分`;
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
      const anchor = $('[data-open-price-alert="mobile"]') || $('.mobile-alert-button') || $('.mobile-market-center-button');
      anchor?.before(button);
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
      <header><div><strong id="dataHealthTitle">行情连接健康</strong><small>统一公共行情、实时流与缓存状态</small></div><button type="button" data-close-data-health aria-label="关闭">×</button></header>
      <section class="data-health-summary">
        <div><span>当前模式</span><b id="dataHealthMode">连接中</b></div>
        <div><span>请求代际</span><b id="dataHealthAttempts">#0</b></div>
        <div><span>数据延迟</span><b id="dataHealthLatency">-- ms</b></div>
      </section>
      <div class="data-health-routes">
        <div class="data-health-route"><i>REST</i><div><strong id="dataHealthRestHost">统一行情网关</strong><small id="dataHealthRestStatus">等待快照</small></div><span id="dataHealthRestMeta">--</span></div>
        <div class="data-health-route"><i>流</i><div><strong id="dataHealthWsHost">等待实时流</strong><small id="dataHealthWsStatus">等待连接</small></div><span id="dataHealthWsMeta">--</span></div>
      </div>
      <p class="data-health-note">仅处理交易所公开市场数据，不使用API密钥，不读取真实账户，不执行真实交易。行情、订单簿和逐笔成交来自同一市场会话；所有订单与资产仍为模拟记录。</p>`;
    document.body.append(panel);
  }

  function updatePanel() {
    const { market } = current();
    const state = healthState(market);
    $$('[data-open-data-health]').forEach(button => {
      button.dataset.healthState = state;
      button.title = `${modeLabel(market)} · ${streamLabel(market)}`;
    });

    if (!$('#dataHealthPanel')) return;
    $('#dataHealthMode').textContent = modeLabel(market);
    $('#dataHealthAttempts').textContent = `#${Number(market?.requestGeneration || 0)}`;
    $('#dataHealthLatency').textContent = Number.isFinite(Number(market?.latencyMs)) ? `${Math.max(0, Math.round(Number(market.latencyMs)))} ms` : '-- ms';
    $('#dataHealthRestHost').textContent = isFixture(market) ? '本地确定性测试源' : gatewayHost();
    $('#dataHealthRestStatus').textContent = market?.loading ? '正在获取快照与K线' : market?.error ? '最近请求失败' : '快照与K线已就绪';
    $('#dataHealthRestMeta').textContent = String(market?.interval || market?.source || '--');
    $('#dataHealthWsHost').textContent = streamLabel(market);
    $('#dataHealthWsStatus').textContent = statusText(market);
    $('#dataHealthWsMeta').textContent = market?.provider ? String(market.provider).toUpperCase() : ageText(market);
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
    window.addEventListener('atlas:market-state', updatePanel);
    window.addEventListener('atlas:data-route', updatePanel);
    document.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-open-data-health], #dataHealthPanel')) return;
      closePanel();
    }, true);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-open-data-health]')) {
        event.preventDefault();
        event.stopPropagation();
        openPanel();
        return;
      }
      if (event.target.closest('[data-close-data-health]')) {
        event.preventDefault();
        closePanel();
      }
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
