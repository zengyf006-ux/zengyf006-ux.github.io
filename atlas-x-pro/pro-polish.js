(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const shell = () => $('.pro-shell');
  let aggregatingBookPrices = false;

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function addTicketContext() {
    const ticket = $('.ticket-scroll');
    const note = $('.risk-note');
    if (!ticket || !note || $('.ticket-context')) return;
    const context = document.createElement('section');
    context.className = 'ticket-context';
    context.innerHTML = `
      <div><span>账户等级</span><b>模拟账户 · Level 0</b></div>
      <div><span>Maker / Taker</span><b>0.080% / 0.080%</b></div>
      <div><span>订单保护</span><b id="orderProtection">滑点检测已开启</b></div>
      <small>委托、持仓、费用和资金变化均由本地模拟撮合引擎计算。</small>`;
    note.after(context);
  }

  function createPopover() {
    if ($('#controlPopover')) return;
    const popover = document.createElement('section');
    popover.id = 'controlPopover';
    popover.className = 'control-popover';
    popover.hidden = true;
    popover.innerHTML = `
      <header><strong id="popoverTitle">系统通知</strong><button type="button" data-close-popover aria-label="关闭">×</button></header>
      <div class="popover-body" id="popoverBody"></div>`;
    document.body.append(popover);
  }

  function openPopover(type) {
    const popover = $('#controlPopover');
    if (!popover) return;
    const title = $('#popoverTitle');
    const body = $('#popoverBody');
    if (type === 'notifications') {
      title.textContent = '系统通知';
      body.innerHTML = `
        <div class="notification-item"><i></i><div><b>模拟交易环境运行正常</b><span>行情不可用时会自动切换到演示数据，不影响本地模拟撮合。</span></div></div>
        <div class="notification-item"><i></i><div><b>账户状态已保存</b><span>交易对、委托、持仓和成交记录会保存在当前浏览器。</span></div></div>`;
    } else {
      title.textContent = '市场显示';
      body.innerHTML = `
        <div class="notification-item"><i></i><div><b>快捷筛选</b><span>可使用“全部 / 自选 / 涨幅”切换市场列表，或按 ⌘K 搜索。</span></div></div>
        <div class="notification-item"><i></i><div><b>行情来源</b><span>公开数据端点优先；无法连接时明确标记为演示行情。</span></div></div>`;
    }
    popover.hidden = false;
  }

  function closePopover() {
    const popover = $('#controlPopover');
    if (popover) popover.hidden = true;
  }

  function marketRowsForModule() {
    const rows = $$('#marketList .market-row').slice(0, 10);
    if (!rows.length) return '<div class="empty-table"><b>市场数据正在准备</b></div>';
    return rows.map(row => {
      const pair = row.querySelector('.pair-cell b')?.textContent?.replace(/\s+/g, '') || '--';
      const name = row.querySelector('.pair-cell small')?.textContent || '';
      const price = row.querySelector('.price-cell')?.textContent || '--';
      const change = row.querySelector('.change-cell')?.textContent || '--';
      const cls = row.querySelector('.change-cell')?.classList.contains('negative') ? 'negative' : 'positive';
      return `<div class="module-table-row"><span class="asset-name">${pair}<small> · ${name}</small></span><span>${price}</span><span class="${cls}">${change}</span><span>USDT</span></div>`;
    }).join('');
  }

  function accountSnapshot() {
    const equity = $('#accountEquity')?.textContent || '100,000.00 USDT';
    const available = $('#availableBalance')?.textContent || '100,000.00';
    const pnl = $('#unrealizedPnl')?.textContent || '+0.00';
    const positions = $('#positionsCount')?.textContent || '0';
    return { equity, available, pnl, positions };
  }

  function analyticsBars() {
    const values = [32,37,35,43,41,49,46,54,58,55,63,68,65,72,76,74,83,88,84,92,96,90,98,94,100];
    return values.map(value => `<i style="--h:${value}%"></i>`).join('');
  }

  function moduleMarkup(type) {
    const account = accountSnapshot();
    if (type === 'markets') {
      return `
        <header class="module-header"><div><h1>市场中心</h1><p>观察主要数字资产的价格、成交和强弱分布。</p></div><button class="module-close" type="button">返回交易终端</button></header>
        <section class="module-grid">
          <article class="module-stat"><span>观察市场</span><b>12</b><small>USDT 现货</small></article>
          <article class="module-stat"><span>上涨市场</span><b class="positive">8</b><small>当前列表</small></article>
          <article class="module-stat"><span>市场情绪</span><b>中性偏多</b><small>动态估算</small></article>
          <article class="module-stat"><span>数据状态</span><b>自动降级</b><small>公开行情优先</small></article>
        </section>
        <section class="module-panel"><header><strong>市场排行榜</strong><span>最新价格与 24h 变化</span></header>${marketRowsForModule()}</section>`;
    }
    if (type === 'assets') {
      return `
        <header class="module-header"><div><h1>模拟资产</h1><p>资金、持仓与可用余额均由本地模拟账户计算。</p></div><button class="module-close" type="button">返回交易终端</button></header>
        <section class="module-grid">
          <article class="module-stat"><span>账户权益</span><b>${account.equity.replace(' USDT','')}</b><small>USDT</small></article>
          <article class="module-stat"><span>可用余额</span><b>${account.available}</b><small>USDT</small></article>
          <article class="module-stat"><span>未实现盈亏</span><b class="positive">${account.pnl}</b><small>实时估算</small></article>
          <article class="module-stat"><span>持仓数量</span><b>${account.positions}</b><small>模拟持仓</small></article>
        </section>
        <section class="asset-allocation">
          <article class="module-panel allocation-chart"><div class="allocation-ring"><div><b>${account.equity.replace(' USDT','')}</b><span>总权益 USDT</span></div></div></article>
          <article class="module-panel"><header><strong>资产说明</strong><span>安全边界</span></header>
            <div class="module-table-row"><span class="asset-name">USDT</span><span>${account.available}</span><span>可用资金</span><span>模拟</span></div>
            <div class="module-table-row"><span class="asset-name">持仓资产</span><span>${account.positions}</span><span>随标记价变化</span><span>模拟</span></div>
            <div class="module-table-row"><span class="asset-name">真实充值 / 提现</span><span>未启用</span><span>不处理资金</span><span>安全</span></div>
          </article>
        </section>`;
    }
    return `
      <header class="module-header"><div><h1>账户分析</h1><p>根据本地模拟订单生成的账户表现摘要。</p></div><button class="module-close" type="button">返回交易终端</button></header>
      <section class="module-grid">
        <article class="module-stat"><span>模拟净值</span><b>${account.equity.replace(' USDT','')}</b><small>USDT</small></article>
        <article class="module-stat"><span>当前盈亏</span><b class="positive">${account.pnl}</b><small>未实现</small></article>
        <article class="module-stat"><span>风险占用</span><b>${account.positions === '0' ? '0.00%' : '低'}</b><small>当前持仓</small></article>
        <article class="module-stat"><span>成交记录</span><b>${$('#historyCount')?.textContent || '0'}</b><small>本地保存</small></article>
      </section>
      <section class="module-panel"><header><strong>模拟净值趋势</strong><span>演示可视化</span></header><div class="analytics-chart">${analyticsBars()}</div></section>`;
  }

  function openModule(type) {
    closeModule();
    const overlay = document.createElement('section');
    overlay.className = 'module-overlay';
    overlay.dataset.module = type;
    overlay.innerHTML = moduleMarkup(type);
    shell()?.append(overlay);
    document.body.classList.add('module-open');
  }

  function closeModule() {
    $('.module-overlay')?.remove();
    document.body.classList.remove('module-open');
    $$('[data-main-nav]').forEach(button => button.classList.toggle('active', button.dataset.mainNav === 'trade'));
  }

  function aggregateBookPrices() {
    if (aggregatingBookPrices) return;
    const select = $('#pricePrecision');
    if (!select) return;
    aggregatingBookPrices = true;
    try {
      const step = Number(select.value) || 0.1;
      $$('#orderBook .book-row [class="ask"], #orderBook .book-row [class="bid"]').forEach(price => {
        const raw = Number(String(price.textContent).replace(/,/g, ''));
        if (!Number.isFinite(raw)) return;
        const rounded = Math.round(raw / step) * step;
        const digits = step < 1 ? Math.max(1, String(step).split('.')[1]?.length || 1) : 0;
        const next = rounded.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
        if (price.textContent !== next) price.textContent = next;
      });
      select.classList.add('price-precision-active');
      clearTimeout(aggregateBookPrices.timer);
      aggregateBookPrices.timer = setTimeout(() => select.classList.remove('price-precision-active'), 500);
    } finally {
      queueMicrotask(() => { aggregatingBookPrices = false; });
    }
  }

  function activateAccount() {
    $('[data-account-tab="balances"]')?.click();
    if (innerWidth <= 820) $('[data-mobile-view="account"]')?.click();
    else $('#accountWorkspace')?.scrollIntoView({ block: 'nearest' });
    showToast('已打开模拟资产账户');
  }

  function focusMarketSearch() {
    if (innerWidth <= 820) $('#mobilePairButton')?.click();
    else {
      const input = $('#marketSearch');
      input?.focus();
      input?.select();
    }
  }

  function bindControls() {
    $('#quickSearchButton')?.addEventListener('click', focusMarketSearch);
    $('#layoutButton')?.addEventListener('click', () => {
      const compact = shell()?.classList.toggle('compact-mode');
      try { localStorage.setItem('atlasX.pro.compact', compact ? '1' : '0'); } catch {}
      showToast(compact ? '已切换为紧凑布局' : '已切换为标准布局');
      window.dispatchEvent(new Event('resize'));
    });
    $('.notification-button')?.addEventListener('click', event => { event.stopPropagation(); openPopover('notifications'); });
    $('.account-avatar')?.addEventListener('click', activateAccount);
    $('.sidebar-head .icon-button')?.addEventListener('click', event => { event.stopPropagation(); openPopover('market'); });
    $('#pricePrecision')?.addEventListener('change', aggregateBookPrices);
    const orderBook = $('#orderBook');
    if (orderBook) new MutationObserver(aggregateBookPrices).observe(orderBook, { childList: true, subtree: true });

    document.addEventListener('click', event => {
      if (event.target.closest('[data-close-popover]')) closePopover();
      if (!event.target.closest('#controlPopover, .notification-button, .sidebar-head .icon-button')) closePopover();
      if (event.target.closest('.module-close')) closeModule();
    });

    document.addEventListener('click', event => {
      const button = event.target.closest('[data-main-nav]');
      if (!button) return;
      const type = button.dataset.mainNav;
      if (type === 'trade') {
        closeModule();
      } else {
        event.preventDefault();
        event.stopPropagation();
        $$('[data-main-nav]').forEach(item => item.classList.toggle('active', item === button));
        openModule(type);
        button.classList.add('active');
      }
    }, true);
  }

  function restorePreferences() {
    try { if (localStorage.getItem('atlasX.pro.compact') === '1') shell()?.classList.add('compact-mode'); } catch {}
  }

  function init() {
    addTicketContext();
    createPopover();
    restorePreferences();
    bindControls();
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
