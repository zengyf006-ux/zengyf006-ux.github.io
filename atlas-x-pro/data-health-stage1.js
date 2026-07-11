(() => {
  'use strict';
  if (window.__ATLAS_STAGE1_DATA_HEALTH__) return;
  window.__ATLAS_STAGE1_DATA_HEALTH__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let updateFrame = 0;
  let updateTimer = 0;

  function engineState() {
    return window.AtlasMarketDataEngine?.getState?.() || null;
  }

  function connectionLabel(state) {
    const labels = {
      booting: '正在启动',
      live: '实时',
      reconnecting: '重连中',
      stale: '数据已过期',
      offline: '离线',
    };
    return labels[state?.connectionState] || '等待连接';
  }

  function modeLabel(state) {
    if (window.__ATLAS_QA_MODE__ || state?.source === 'fixture') return '演示行情';
    if (state?.connectionState === 'live') return '实时行情';
    if (state?.source === 'cache') return '缓存行情';
    return connectionLabel(state);
  }

  function routeHost(state, transport) {
    if (window.__ATLAS_QA_MODE__ || state?.source === 'fixture') return '本地可重复演示源';
    if (transport === 'rest') {
      if (state?.source === 'cache') return '浏览器行情缓存';
      return 'ATLAS 统一行情网关';
    }
    if (state?.provider) return `${String(state.provider).toUpperCase()} ${state.source === 'direct' ? '公开直连流' : '统一实时流'}`;
    return '等待实时流';
  }

  function healthState(state) {
    if (window.__ATLAS_QA_MODE__ || state?.source === 'fixture') return 'demo';
    if (state?.connectionState === 'live') return 'live';
    if (state?.connectionState === 'stale' || state?.connectionState === 'offline') return 'failed';
    return 'routing';
  }

  function update() {
    const state = engineState();
    if (!state) return;
    document.documentElement.dataset.stage1DataHealth = 'ready';
    $$('[data-open-data-health]').forEach(button => {
      button.dataset.healthState = healthState(state);
      button.title = `${modeLabel(state)} · ${routeHost(state, 'ws')}`;
    });
    if (!$('#dataHealthPanel')) return;
    const mode = $('#dataHealthMode');
    if (mode) mode.textContent = modeLabel(state);
    const attempts = $('#dataHealthAttempts');
    if (attempts) attempts.textContent = `${Math.max(1, Number(state.requestGeneration) || 1)} 代`;
    const latency = $('#dataHealthLatency');
    if (latency) latency.textContent = Number.isFinite(Number(state.latencyMs)) ? `${Math.max(0, Math.round(Number(state.latencyMs)))} ms` : '-- ms';
    const restHost = $('#dataHealthRestHost');
    if (restHost) restHost.textContent = routeHost(state, 'rest');
    const restStatus = $('#dataHealthRestStatus');
    if (restStatus) restStatus.textContent = state.source === 'cache' ? '缓存可用' : connectionLabel(state);
    const restMeta = $('#dataHealthRestMeta');
    if (restMeta) restMeta.textContent = state.interval || '--';
    const wsHost = $('#dataHealthWsHost');
    if (wsHost) wsHost.textContent = routeHost(state, 'ws');
    const wsStatus = $('#dataHealthWsStatus');
    if (wsStatus) wsStatus.textContent = connectionLabel(state);
    const wsMeta = $('#dataHealthWsMeta');
    if (wsMeta) wsMeta.textContent = state.provider ? String(state.provider).toUpperCase() : '--';
    const title = $('#dataHealthTitle')?.nextElementSibling;
    if (title) title.textContent = '统一行情内核、公开数据路由与自动降级';
  }

  function scheduleUpdate() {
    queueMicrotask(update);
    if (updateFrame) cancelAnimationFrame(updateFrame);
    updateFrame = requestAnimationFrame(() => {
      updateFrame = 0;
      update();
      clearTimeout(updateTimer);
      updateTimer = setTimeout(update, 60);
    });
  }

  function panelWasMounted(records) {
    return records.some(record => [...record.addedNodes].some(node => node.nodeType === 1
      && (node.id === 'dataHealthPanel' || node.querySelector?.('#dataHealthPanel'))));
  }

  function init() {
    window.AtlasMarketDataEngine?.subscribe?.(scheduleUpdate);
    window.addEventListener('atlas:data-route', scheduleUpdate);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-open-data-health]')) scheduleUpdate();
    }, true);
    const observer = new MutationObserver(records => {
      if (panelWasMounted(records)) scheduleUpdate();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleUpdate();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
