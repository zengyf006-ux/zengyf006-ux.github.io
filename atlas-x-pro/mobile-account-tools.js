(() => {
  'use strict';
  if (window.__ATLAS_MOBILE_ACCOUNT_TOOLS__) return;
  window.__ATLAS_MOBILE_ACCOUNT_TOOLS__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const STORAGE_KEY = 'atlasX.pro.v1';

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1900);
  }

  function readState() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return state && typeof state === 'object' ? state : {};
    } catch {
      return {};
    }
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function buildLedgerCsv() {
    const state = readState();
    const history = Array.isArray(state.history) ? state.history : [];
    const header = ['时间', '交易对', '方向', '成交价', '数量', '成交额', '手续费(USDT)', '状态'];
    const rows = history.map(fill => {
      const symbol = String(fill.symbol || '--');
      const pair = symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
      const price = Number(fill.price) || 0;
      const quantity = Number(fill.qty) || 0;
      return [
        new Date(Number(fill.createdAt) || Date.now()).toLocaleString('zh-CN', { hour12: false }),
        pair,
        fill.side === 'sell' ? '卖出' : '买入',
        price,
        quantity,
        (price * quantity).toFixed(8),
        Number(fill.fee || 0).toFixed(8),
        fill.status || '已成交',
      ];
    });
    return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  function exportLedger() {
    const state = readState();
    const history = Array.isArray(state.history) ? state.history : [];
    if (!history.length) {
      showToast('暂无成交记录可导出');
      return;
    }
    const blob = new Blob([buildLedgerCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `ATLAS-X-模拟成交-${timestamp}.csv`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${history.length} 条模拟成交`);
  }

  function openModule(type) {
    const button = $(`[data-main-nav="${type}"]`);
    if (!button) {
      showToast('模块暂不可用');
      return;
    }
    button.click();
  }

  function createTools() {
    const metrics = $('.account-metrics');
    if (!metrics || $('.mobile-account-tools')) return;
    const tools = document.createElement('nav');
    tools.className = 'mobile-account-tools';
    tools.setAttribute('aria-label', '账户工具');
    tools.innerHTML = `
      <button type="button" data-mobile-account-tool="assets">
        <svg viewBox="0 0 24 24"><path d="M4 7h16v11H4z"/><path d="M7 7V5h10v2M15 12h3"/></svg>
        <span><strong>资产总览</strong><small>权益与分配</small></span>
      </button>
      <button type="button" data-mobile-account-tool="analytics">
        <svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/></svg>
        <span><strong>账户分析</strong><small>盈亏与回撤</small></span>
      </button>
      <button type="button" data-mobile-account-tool="export">
        <svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 18v3h16v-3"/></svg>
        <span><strong>导出成交</strong><small>CSV账本</small></span>
      </button>`;
    metrics.after(tools);
  }

  function bind() {
    document.addEventListener('click', event => {
      const tool = event.target.closest('[data-mobile-account-tool]')?.dataset.mobileAccountTool;
      if (!tool) return;
      if (tool === 'export') exportLedger();
      else openModule(tool);
    });
  }

  function init() {
    createTools();
    bind();
    document.documentElement.dataset.mobileAccountTools = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
