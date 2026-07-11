(() => {
  'use strict';

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = './release-polish.css';
  document.head.append(style);

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function sanitizeModuleRows(overlay) {
    $$('.module-table-row .asset-name', overlay).forEach(name => {
      const text = name.textContent.replace(/\s+/g, ' ').replace(/\/USDT\s*·\s*\/USDT/g, '/USDT').trim();
      if (name.textContent.trim() !== text) name.textContent = text;
    });
  }

  function marketLowerGrid() {
    return `
      <section class="module-lower-grid">
        <article class="module-panel">
          <header><strong>市场广度</strong><span>观察列表实时分布</span></header>
          <div class="breadth-wrap">
            <div class="breadth-value"><b class="positive">67%</b><span>上涨市场占比</span></div>
            <div class="breadth-bar"><i></i><em></em></div>
            <div class="breadth-legend"><span>上涨 8</span><span>下跌 4</span></div>
          </div>
        </article>
        <article class="module-panel">
          <header><strong>板块热度</strong><span>模拟分类视图</span></header>
          <div class="sector-grid">
            <div class="sector-card"><span>主流资产</span><b>BTC · ETH</b><small>流动性最高</small></div>
            <div class="sector-card"><span>高性能链</span><b>SOL · AVAX</b><small>活跃度上升</small></div>
            <div class="sector-card"><span>基础设施</span><b>LINK · DOT</b><small>中性偏多</small></div>
          </div>
        </article>
      </section>`;
  }

  function assetLowerGrid() {
    const historyCount = $('#historyCount')?.textContent || '0';
    return `
      <section class="module-lower-grid">
        <article class="module-panel">
          <header><strong>账户风险</strong><span>本地模拟账户</span></header>
          <div class="risk-summary">
            <div><span>风险水平</span><b>低</b></div>
            <div class="risk-meter"><i></i></div>
            <p>当前账户仅承担模拟持仓风险，不连接交易所账户，不保存 API 密钥，也不支持真实充值与提现。</p>
          </div>
        </article>
        <article class="module-panel">
          <header><strong>账户动态</strong><span>${historyCount} 条成交记录</span></header>
          <div class="ledger-list">
            <div class="ledger-row"><time>刚刚</time><span>模拟账户权益更新</span><b class="positive">正常</b></div>
            <div class="ledger-row"><time>本会话</time><span>委托与持仓已本地保存</span><b>已完成</b></div>
            <div class="ledger-row"><time>安全边界</time><span>真实资金功能未启用</span><b>受保护</b></div>
          </div>
        </article>
      </section>`;
  }

  function analyticsLowerGrid() {
    return `
      <section class="module-lower-grid">
        <article class="module-panel">
          <header><strong>表现拆解</strong><span>模拟统计</span></header>
          <div class="insight-list">
            <div class="insight-row"><div><b>交易执行</b><small>订单、手续费与滑点均进入本地账本</small></div><span class="positive">正常</span></div>
            <div class="insight-row"><div><b>风险敞口</b><small>根据持仓市值与账户权益动态估算</small></div><span>低</span></div>
            <div class="insight-row"><div><b>数据完整性</b><small>刷新后恢复交易对、委托和持仓</small></div><span class="positive">已保存</span></div>
          </div>
        </article>
        <article class="module-panel">
          <header><strong>分析边界</strong><span>非投资建议</span></header>
          <div class="risk-summary">
            <div><span>数据范围</span><b>模拟</b></div>
            <div class="risk-meter"><i style="width:22%"></i></div>
            <p>当前分析用于验证产品与交易流程，不预测收益，不提供荐币，也不构成任何投资建议。</p>
          </div>
        </article>
      </section>`;
  }

  function upgradeOverlay(overlay) {
    if (!overlay || overlay.dataset.upgraded === 'true') return;
    overlay.dataset.upgraded = 'true';
    sanitizeModuleRows(overlay);
    const type = overlay.dataset.module;
    if (type === 'markets') overlay.insertAdjacentHTML('beforeend', marketLowerGrid());
    if (type === 'assets') overlay.insertAdjacentHTML('beforeend', assetLowerGrid());
    if (type === 'analytics') overlay.insertAdjacentHTML('beforeend', analyticsLowerGrid());
  }

  function inspect() {
    upgradeOverlay($('.module-overlay'));
  }

  const observer = new MutationObserver(inspect);
  const start = () => {
    const shell = $('.pro-shell');
    if (shell) observer.observe(shell, { childList: true });
    inspect();
  };

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
