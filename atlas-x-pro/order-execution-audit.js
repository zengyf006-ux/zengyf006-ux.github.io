(() => {
  'use strict';
  if (window.__ATLAS_EXECUTION_AUDIT__) return;
  window.__ATLAS_EXECUTION_AUDIT__ = true;

  const CORE_KEY = 'atlasX.pro.v1';
  const OCO_KEY = 'atlasX.pro.advancedOrders.v1';
  const EXIT_KEY = 'atlasX.pro.exitStrategies.v1';
  const STORE_KEY = 'atlasX.pro.executionAudit.v1';
  const MAX_CANCELED = 80;
  const FILTERS = new Set(['all', 'pending', 'filled', 'strategy', 'canceled']);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let store = readStore();
  let currentRecords = [];
  let selectedRecordId = '';
  let refreshTimer = 0;
  let lastSignature = '';
  let mutationObserver = null;

  function numberFrom(value) {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function defaultStore() {
    return { version: 1, canceledOrders: [], ui: { filter: 'all' }, updatedAt: 0 };
  }

  function normalizeCanceled(order) {
    if (!order?.sourceId && !order?.id) return null;
    const sourceId = String(order.sourceId || order.id);
    return {
      sourceId,
      symbol: String(order.symbol || '').toUpperCase(),
      side: order.side === 'sell' ? 'sell' : 'buy',
      orderType: String(order.orderType || order.type || 'limit'),
      quantity: Math.max(0, numberFrom(order.quantity ?? order.qty)),
      requestedPrice: nullableNumber(order.requestedPrice ?? order.price),
      referencePrice: nullableNumber(order.referencePrice),
      estimatedFee: Math.max(0, numberFrom(order.estimatedFee)),
      createdAt: Math.max(0, numberFrom(order.createdAt)),
      canceledAt: Math.max(0, numberFrom(order.canceledAt)) || Date.now(),
      postOnly: order.postOnly === true,
      reduceOnly: order.reduceOnly === true,
    };
  }

  function readStore() {
    const raw = readJson(STORE_KEY, defaultStore());
    return {
      version: 1,
      canceledOrders: (Array.isArray(raw.canceledOrders) ? raw.canceledOrders : [])
        .map(normalizeCanceled).filter(Boolean)
        .sort((a, b) => b.canceledAt - a.canceledAt).slice(0, MAX_CANCELED),
      ui: { filter: FILTERS.has(raw.ui?.filter) ? raw.ui.filter : 'all' },
      updatedAt: Math.max(0, numberFrom(raw.updatedAt)),
    };
  }

  function writeStore() {
    store.version = 1;
    store.canceledOrders = store.canceledOrders.map(normalizeCanceled).filter(Boolean)
      .sort((a, b) => b.canceledAt - a.canceledAt).slice(0, MAX_CANCELED);
    store.updatedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function pairForSymbol(symbol) {
    const normalized = String(symbol || '').toUpperCase();
    return normalized.endsWith('USDT') ? `${normalized.slice(0, -4)}/USDT` : normalized || '--';
  }

  function formatNumber(value, maximumFractionDigits = 8) {
    const number = numberFrom(value);
    return number.toLocaleString('en-US', { maximumFractionDigits });
  }

  function formatPrice(value) {
    const number = nullableNumber(value);
    if (number === null) return '--';
    const digits = Math.abs(number) >= 1000 ? 2 : Math.abs(number) >= 1 ? 4 : 8;
    return number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits });
  }

  function formatMoney(value) {
    const number = nullableNumber(value);
    return number === null ? '--' : `${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`;
  }

  function formatTime(value) {
    const timestamp = numberFrom(value);
    if (!(timestamp > 0)) return '--';
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }

  function sideLabel(side) {
    return side === 'sell' ? '卖出' : '买入';
  }

  function sourceLabel(type) {
    return ({
      core_order: '核心委托',
      core_fill: '成交记录',
      oco: 'OCO 策略',
      exit_strategy: '退出策略',
      canceled_order: '已撤委托',
    })[type] || '执行记录';
  }

  function statusLabel(record) {
    const map = {
      pending: '等待执行', filled: '已成交', canceled: '已撤销',
      active: '运行中', waiting_activation: '等待激活',
      completed_stop: '止损完成', completed_take_profit: '止盈完成',
      completed: '已完成', partially_completed: '部分完成', partially_canceled: '部分取消',
      expired: '已过期', error: '执行异常', canceled_strategy: '已取消',
    };
    return map[record.status] || String(record.status || '未知状态');
  }

  function adverseSlippageBps(side, referencePrice, executionPrice) {
    const reference = nullableNumber(referencePrice);
    const execution = nullableNumber(executionPrice);
    if (!(reference > 0) || !(execution > 0)) return null;
    return (side === 'sell'
      ? (reference - execution) / reference
      : (execution - reference) / reference) * 10000;
  }

  function withCosts(record) {
    const quantity = Math.max(0, numberFrom(record.quantity));
    const executionPrice = nullableNumber(record.executionPrice);
    const requestedPrice = nullableNumber(record.requestedPrice);
    const grossNotional = executionPrice !== null
      ? executionPrice * quantity
      : requestedPrice !== null ? requestedPrice * quantity : 0;
    const fee = Math.max(0, numberFrom(record.fee));
    const slippageBps = adverseSlippageBps(record.side, record.referencePrice, executionPrice);
    const slippageCost = slippageBps === null ? null : grossNotional * slippageBps / 10000;
    const totalExecutionCost = fee + (slippageCost === null ? 0 : slippageCost);
    return {
      ...record,
      quantity,
      requestedPrice,
      referencePrice: nullableNumber(record.referencePrice),
      executionPrice,
      grossNotional,
      fee,
      slippageBps,
      slippageCost,
      totalExecutionCost,
      timeline: (Array.isArray(record.timeline) ? record.timeline : [])
        .filter(item => item && item.code)
        .sort((a, b) => numberFrom(a.at) - numberFrom(b.at)),
    };
  }

  function coreOrderRecords(core) {
    return (Array.isArray(core.orders) ? core.orders : []).filter(order => order?.id).map(order => withCosts({
      id: `core-order:${order.id}`,
      sourceType: 'core_order',
      sourceId: String(order.id),
      symbol: String(order.symbol || '').toUpperCase(),
      side: order.side === 'sell' ? 'sell' : 'buy',
      orderType: String(order.type || 'limit'),
      status: 'pending',
      quantity: order.qty,
      requestedPrice: order.price,
      referencePrice: order.referencePrice ?? null,
      executionPrice: null,
      fee: 0,
      createdAt: numberFrom(order.createdAt),
      completedAt: 0,
      parentOrderId: '',
      strategyId: '',
      childOrderIds: [],
      explanation: '委托已进入本地模拟撮合队列，尚未产生实际成交价格与手续费。',
      timeline: [
        { code: 'submitted', label: '创建委托', at: numberFrom(order.createdAt), detail: `${sideLabel(order.side)} ${formatNumber(order.qty)} ${pairForSymbol(order.symbol).split('/')[0]}` },
        { code: 'pending', label: '等待撮合', at: numberFrom(order.createdAt) + 1, detail: order.postOnly ? 'Post Only 委托等待进入订单簿' : '等待价格满足执行条件' },
      ],
    }));
  }

  function coreFillRecords(core) {
    return (Array.isArray(core.history) ? core.history : []).filter(fill => fill?.id).map(fill => {
      const createdAt = numberFrom(fill.createdAt);
      const submittedAt = numberFrom(fill.submittedAt || fill.orderCreatedAt || createdAt);
      const timeline = [];
      timeline.push({ code: 'submitted', label: '提交执行', at: submittedAt, detail: fill.orderType === 'market' ? '市价模拟订单提交' : '委托条件满足' });
      if (fill.triggeredAt) timeline.push({ code: 'triggered', label: '触发执行', at: numberFrom(fill.triggeredAt), detail: String(fill.executionReason || '价格条件已满足') });
      timeline.push({ code: 'filled', label: '成交入账', at: createdAt, detail: `${formatNumber(fill.qty)} @ ${formatPrice(fill.price)} USDT` });
      timeline.push({ code: 'fee_posted', label: '手续费计入', at: createdAt + 1, detail: formatMoney(fill.fee) });
      return withCosts({
        id: `core-fill:${fill.id}`,
        sourceType: 'core_fill',
        sourceId: String(fill.id),
        symbol: String(fill.symbol || '').toUpperCase(),
        side: fill.side === 'sell' ? 'sell' : 'buy',
        orderType: String(fill.orderType || fill.type || 'market'),
        status: 'filled',
        quantity: fill.qty,
        requestedPrice: fill.requestedPrice ?? fill.orderPrice ?? null,
        referencePrice: fill.referencePrice ?? null,
        executionPrice: fill.price,
        fee: fill.fee,
        createdAt: submittedAt,
        completedAt: createdAt,
        parentOrderId: String(fill.orderId || ''),
        strategyId: String(fill.strategyId || ''),
        childOrderIds: [],
        explanation: nullableNumber(fill.referencePrice) === null
          ? '成交记录缺少有效参考价，因此仅展示成交金额和手续费，不推测滑点。'
          : '滑点以提交参考价与实际成交价之间的不利差异计算；负值代表优于参考价。',
        timeline,
      });
    });
  }

  function ocoRecords(oco) {
    return (Array.isArray(oco.orders) ? oco.orders : []).filter(order => order?.id).map(order => {
      const status = String(order.status || 'active');
      const createdAt = numberFrom(order.createdAt);
      const completedAt = numberFrom(order.completedAt || order.updatedAt);
      const timeline = [
        { code: 'created', label: '创建 OCO', at: createdAt, detail: `止盈 ${formatPrice(order.takeProfit)} · 止损 ${formatPrice(order.stopTrigger)}` },
        { code: 'active', label: '双条件监控', at: createdAt + 1, detail: '止盈委托与止损监控互斥执行' },
      ];
      if (status !== 'active' && status !== 'creating') {
        timeline.push({ code: status, label: statusLabel({ status }), at: completedAt || createdAt + 2, detail: status === 'completed_stop' ? '止损腿触发，止盈腿终止' : '策略进入终态' });
      }
      return withCosts({
        id: `oco:${order.id}`,
        sourceType: 'oco',
        sourceId: String(order.id),
        symbol: String(order.symbol || '').toUpperCase(),
        side: 'sell',
        orderType: 'oco',
        status,
        quantity: order.quantity,
        requestedPrice: order.takeProfit ?? null,
        referencePrice: order.referencePrice ?? null,
        executionPrice: order.executionPrice ?? order.fillPrice ?? null,
        fee: order.fee,
        createdAt,
        completedAt,
        parentOrderId: '',
        strategyId: String(order.id),
        childOrderIds: [order.tpOrderId, order.stopOrderId].filter(Boolean).map(String),
        explanation: 'OCO 将止盈委托与止损监控作为同一退出计划追踪，任一腿完成后另一腿停止。',
        timeline,
      });
    });
  }

  function exitRecords(exits) {
    return (Array.isArray(exits.strategies) ? exits.strategies : []).filter(strategy => strategy?.id).map(strategy => {
      const status = String(strategy.status || 'active');
      const createdAt = numberFrom(strategy.createdAt);
      const completedAt = numberFrom(strategy.completedAt || strategy.updatedAt);
      const trailing = strategy.kind === 'trailing_stop';
      const timeline = [
        { code: 'created', label: '创建退出策略', at: createdAt, detail: trailing ? `追踪距离 ${formatNumber(strategy.trailPercent, 4)}%` : '分批退出计划' },
        { code: status === 'waiting_activation' ? 'waiting_activation' : 'active', label: status === 'waiting_activation' ? '等待激活' : '策略运行', at: createdAt + 1, detail: trailing ? `触发参考 ${formatPrice(strategy.triggerPrice)}` : '等待各档位价格条件' },
      ];
      if (!['active', 'waiting_activation'].includes(status)) {
        timeline.push({ code: status, label: statusLabel({ status }), at: completedAt || createdAt + 2, detail: trailing && status === 'completed' ? '追踪止损触发并减仓' : '退出策略状态已更新' });
      }
      return withCosts({
        id: `exit:${strategy.id}`,
        sourceType: 'exit_strategy',
        sourceId: String(strategy.id),
        symbol: String(strategy.symbol || '').toUpperCase(),
        side: 'sell',
        orderType: String(strategy.kind || 'exit_strategy'),
        status,
        quantity: strategy.quantity,
        requestedPrice: strategy.triggerPrice ?? null,
        referencePrice: strategy.referencePrice ?? null,
        executionPrice: strategy.executionPrice ?? strategy.fillPrice ?? null,
        fee: strategy.fee,
        createdAt,
        completedAt,
        parentOrderId: '',
        strategyId: String(strategy.id),
        childOrderIds: (Array.isArray(strategy.orderIds) ? strategy.orderIds : []).map(String),
        explanation: trailing
          ? '追踪止损根据最高有利价格和追踪距离更新触发线，触发后通过核心模拟撮合减仓。'
          : '分批退出将多个目标价格归入同一策略，按各档位状态形成时间线。',
        timeline,
      });
    });
  }

  function canceledRecords() {
    return store.canceledOrders.map(order => withCosts({
      id: `canceled-order:${order.sourceId}`,
      sourceType: 'canceled_order',
      sourceId: order.sourceId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      status: 'canceled',
      quantity: order.quantity,
      requestedPrice: order.requestedPrice,
      referencePrice: order.referencePrice,
      executionPrice: null,
      fee: 0,
      createdAt: order.createdAt,
      completedAt: order.canceledAt,
      parentOrderId: '',
      strategyId: '',
      childOrderIds: [],
      explanation: '该委托在成交前被撤销。快照仅用于审计展示，不参与余额、风险或持仓计算。',
      timeline: [
        { code: 'submitted', label: '创建委托', at: order.createdAt, detail: `${sideLabel(order.side)} ${formatNumber(order.quantity)}` },
        { code: 'canceled', label: '撤销委托', at: order.canceledAt, detail: '委托从核心等待队列移除' },
      ],
    }));
  }

  function buildRecords() {
    store = readStore();
    const core = readJson(CORE_KEY, {});
    const oco = readJson(OCO_KEY, { orders: [] });
    const exits = readJson(EXIT_KEY, { strategies: [] });
    return [
      ...coreOrderRecords(core),
      ...coreFillRecords(core),
      ...ocoRecords(oco),
      ...exitRecords(exits),
      ...canceledRecords(),
    ].sort((a, b) => Math.max(b.completedAt || 0, b.createdAt || 0) - Math.max(a.completedAt || 0, a.createdAt || 0));
  }

  function getRecords() {
    currentRecords = buildRecords();
    return JSON.parse(JSON.stringify(currentRecords));
  }

  function recordCategory(record) {
    if (record.sourceType === 'core_order') return 'pending';
    if (record.sourceType === 'core_fill') return 'filled';
    if (record.sourceType === 'oco' || record.sourceType === 'exit_strategy') return 'strategy';
    if (record.sourceType === 'canceled_order') return 'canceled';
    return 'all';
  }

  function filteredRecords() {
    const filter = FILTERS.has(store.ui.filter) ? store.ui.filter : 'all';
    return filter === 'all' ? currentRecords : currentRecords.filter(record => recordCategory(record) === filter);
  }

  function summary() {
    const fills = currentRecords.filter(record => record.sourceType === 'core_fill');
    const slippageRows = fills.filter(record => record.slippageBps !== null);
    const fees = fills.reduce((sum, record) => sum + numberFrom(record.fee), 0);
    const averageSlippage = slippageRows.length
      ? slippageRows.reduce((sum, record) => sum + numberFrom(record.slippageBps), 0) / slippageRows.length
      : null;
    const riskStates = currentRecords.filter(record => ['completed_stop', 'error', 'expired'].includes(record.status)).length;
    return { total: currentRecords.length, fees, averageSlippage, riskStates };
  }

  function mount() {
    const tabs = $('.account-tabs');
    const workspace = $('#accountWorkspace');
    if (!tabs || !workspace) return false;
    if (!$('[data-account-tab="audit"]', tabs)) {
      const balancesTab = $('[data-account-tab="balances"]', tabs);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.accountTab = 'audit';
      button.innerHTML = '审计 <span id="executionAuditCount">0</span>';
      tabs.insertBefore(button, balancesTab || null);
    }
    if (!$('[data-account-view="audit"]', workspace)) {
      const balancesView = $('[data-account-view="balances"]', workspace);
      const view = document.createElement('div');
      view.className = 'account-view execution-audit-view';
      view.dataset.accountView = 'audit';
      view.innerHTML = `<div class="execution-audit-shell">
        <section class="execution-audit-summary"></section>
        <nav class="execution-audit-filters" aria-label="审计筛选">
          <button type="button" data-audit-filter="all">全部</button>
          <button type="button" data-audit-filter="pending">进行中</button>
          <button type="button" data-audit-filter="filled">已成交</button>
          <button type="button" data-audit-filter="strategy">策略</button>
          <button type="button" data-audit-filter="canceled">已取消</button>
        </nav>
        <div class="execution-audit-list"></div>
      </div>
      <aside class="execution-audit-detail" data-open="false" data-record-id="" aria-label="执行审计详情"></aside>`;
      workspace.insertBefore(view, balancesView || null);
    }
    return true;
  }

  function summaryMarkup() {
    const stats = summary();
    return `<div><span>审计记录</span><b>${stats.total}</b></div>
      <div><span>累计手续费</span><b>${stats.fees.toFixed(4)}</b><small>USDT</small></div>
      <div><span>平均不利滑点</span><b>${stats.averageSlippage === null ? '--' : `${stats.averageSlippage.toFixed(2)} bps`}</b></div>
      <div class="${stats.riskStates ? 'warning' : ''}"><span>风险终态</span><b>${stats.riskStates}</b></div>`;
  }

  function recordRowMarkup(record) {
    const price = record.executionPrice !== null ? record.executionPrice : record.requestedPrice;
    const statusClass = ['error', 'completed_stop'].includes(record.status) ? 'critical'
      : ['expired', 'canceled', 'partially_canceled'].includes(record.status) ? 'warning'
        : record.status === 'filled' || record.status === 'completed_take_profit' || record.status === 'completed' ? 'positive' : '';
    return `<button type="button" class="execution-audit-row ${statusClass}" data-audit-record-id="${escapeHtml(record.id)}">
      <span class="execution-audit-pair"><b>${escapeHtml(pairForSymbol(record.symbol))}</b><small>${escapeHtml(sourceLabel(record.sourceType))}</small></span>
      <span><small>状态</small><b>${escapeHtml(statusLabel(record))}</b></span>
      <span><small>方向 / 数量</small><b class="${record.side === 'sell' ? 'negative' : 'positive'}">${sideLabel(record.side)} ${formatNumber(record.quantity)}</b></span>
      <span><small>${record.executionPrice !== null ? '执行价格' : '委托价格'}</small><b>${formatPrice(price)}</b></span>
      <span><small>执行成本</small><b>${formatMoney(record.totalExecutionCost)}</b></span>
      <span><small>时间</small><b>${escapeHtml(formatTime(record.completedAt || record.createdAt))}</b></span>
      <em>查看详情</em>
    </button>`;
  }

  function renderList() {
    const list = $('.execution-audit-list');
    if (!list) return;
    const records = filteredRecords();
    list.innerHTML = records.length
      ? records.map(recordRowMarkup).join('')
      : '<div class="execution-audit-empty"><b>当前筛选没有审计记录</b><small>订单、成交和策略状态变化后会自动显示。</small></div>';
  }

  function renderDetail(record) {
    const detail = $('.execution-audit-detail');
    if (!detail) return;
    if (!record) {
      detail.dataset.open = 'false';
      detail.dataset.recordId = '';
      detail.innerHTML = '';
      return;
    }
    selectedRecordId = record.id;
    detail.dataset.open = 'true';
    detail.dataset.recordId = record.id;
    const slippage = record.slippageBps === null
      ? '<b>无参考价</b><small>未推测滑点</small>'
      : `<b class="${record.slippageBps > 0 ? 'negative' : 'positive'}">${record.slippageBps.toFixed(2)} bps</b><small>${record.slippageBps > 0 ? '不利滑点' : '优于参考价'}</small>`;
    const relationships = [
      record.parentOrderId ? `<span>父订单 <b>${escapeHtml(record.parentOrderId)}</b></span>` : '',
      record.strategyId ? `<span>策略 <b>${escapeHtml(record.strategyId)}</b></span>` : '',
      record.childOrderIds?.length ? `<span>子订单 <b>${escapeHtml(record.childOrderIds.join('、'))}</b></span>` : '',
    ].filter(Boolean).join('');
    detail.innerHTML = `<header><div><strong>${escapeHtml(pairForSymbol(record.symbol))} · ${escapeHtml(sourceLabel(record.sourceType))}</strong><small>${escapeHtml(record.sourceId)}</small></div><button type="button" data-audit-detail-close aria-label="关闭审计详情">×</button></header>
      <div class="execution-audit-detail-scroll">
        <section class="execution-audit-status"><span class="${record.side === 'sell' ? 'negative' : 'positive'}">${sideLabel(record.side)}</span><b>${escapeHtml(statusLabel(record))}</b><small>${escapeHtml(record.explanation)}</small></section>
        <section class="execution-audit-costs">
          <div><span>成交名义金额</span><b>${formatMoney(record.grossNotional)}</b></div>
          <div><span>手续费</span><b>${formatMoney(record.fee)}</b></div>
          <div><span>滑点</span>${slippage}</div>
          <div><span>滑点成本</span><b>${record.slippageCost === null ? '--' : formatMoney(record.slippageCost)}</b></div>
          <div class="total"><span>总执行成本</span><b>${formatMoney(record.totalExecutionCost)}</b></div>
        </section>
        <section class="execution-audit-prices"><div><span>委托价</span><b>${formatPrice(record.requestedPrice)}</b></div><div><span>参考价</span><b>${formatPrice(record.referencePrice)}</b></div><div><span>执行价</span><b>${formatPrice(record.executionPrice)}</b></div><div><span>数量</span><b>${formatNumber(record.quantity)}</b></div></section>
        <section class="execution-audit-timeline"><header><strong>执行时间线</strong><small>${record.timeline.length} 个节点</small></header>${record.timeline.map(item => `<article><i></i><div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail || '')}</small></div><time>${escapeHtml(formatTime(item.at))}</time></article>`).join('')}</section>
        ${relationships ? `<section class="execution-audit-relations"><header><strong>关联关系</strong></header>${relationships}</section>` : ''}
        <p class="execution-audit-integrity">审计中心为现有本地账本的只读投影；撤单快照不参与余额、持仓、风险和绩效计算。</p>
      </div>`;
  }

  function render() {
    if (!mount()) return;
    currentRecords = buildRecords();
    const count = $('#executionAuditCount');
    if (count) count.textContent = String(currentRecords.length);
    const summaryElement = $('.execution-audit-summary');
    if (summaryElement) summaryElement.innerHTML = summaryMarkup();
    $$('[data-audit-filter]').forEach(button => {
      const active = button.dataset.auditFilter === store.ui.filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderList();
    if (selectedRecordId) {
      const record = currentRecords.find(item => item.id === selectedRecordId);
      if (record) renderDetail(record);
      else renderDetail(null);
    }
    injectRowEntries();
  }

  function openRecord(id) {
    currentRecords = buildRecords();
    const record = currentRecords.find(item => item.id === id);
    if (!record) return false;
    if (innerWidth <= 820) $('[data-mobile-view="account"]')?.click();
    $('[data-account-tab="audit"]')?.click();
    $$('[data-account-tab]').forEach(button => button.classList.toggle('active', button.dataset.accountTab === 'audit'));
    $$('[data-account-view]').forEach(view => view.classList.toggle('active', view.dataset.accountView === 'audit'));
    render();
    renderDetail(record);
    return true;
  }

  function closeDetail() {
    selectedRecordId = '';
    renderDetail(null);
  }

  function archiveCanceledOrder(order) {
    if (!order?.id) return false;
    store = readStore();
    const snapshot = normalizeCanceled({
      sourceId: order.id,
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      quantity: order.qty,
      requestedPrice: order.price,
      referencePrice: order.referencePrice,
      estimatedFee: order.estimatedFee,
      createdAt: order.createdAt,
      canceledAt: Date.now(),
      postOnly: order.postOnly,
      reduceOnly: order.reduceOnly,
    });
    if (!snapshot) return false;
    store.canceledOrders = [snapshot, ...store.canceledOrders.filter(item => item.sourceId !== snapshot.sourceId)].slice(0, MAX_CANCELED);
    writeStore();
    scheduleRefresh();
    return true;
  }

  function appendAuditButton(row, recordId, label = '审计') {
    if (!row || !recordId || $('[data-open-audit]', row)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-action execution-audit-entry';
    button.dataset.openAudit = recordId;
    button.textContent = label;
    const existingAction = $('.row-action', row);
    if (existingAction) row.insertBefore(button, existingAction);
    else row.append(button);
  }

  function injectRowEntries() {
    const core = readJson(CORE_KEY, {});
    const orders = Array.isArray(core.orders) ? core.orders : [];
    const history = Array.isArray(core.history) ? core.history : [];
    const positions = Array.isArray(core.positions) ? core.positions : [];
    $$('#ordersBody .table-row').forEach((row, index) => {
      const order = orders[index];
      if (order?.id) appendAuditButton(row, `core-order:${order.id}`);
    });
    $$('#historyBody .table-row').forEach((row, index) => {
      const fill = history[index];
      if (fill?.id) appendAuditButton(row, `core-fill:${fill.id}`);
    });
    $$('#positionsBody .table-row').forEach((row, index) => {
      const position = positions[index];
      if (!position) return;
      const related = currentRecords.find(record => record.sourceType === 'core_fill' && record.symbol === position.symbol);
      if (related) appendAuditButton(row, related.id);
    });
  }

  function sourceSignature() {
    return [CORE_KEY, OCO_KEY, EXIT_KEY, STORE_KEY]
      .map(key => localStorage.getItem(key) || '')
      .join('|');
  }

  function refresh(force = false) {
    const signature = sourceSignature();
    if (!force && signature === lastSignature) {
      injectRowEntries();
      return;
    }
    lastSignature = signature;
    render();
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), 40);
  }

  function bind() {
    document.addEventListener('click', event => {
      const cancel = event.target.closest?.('[data-cancel-order]');
      if (!cancel) return;
      const id = cancel.dataset.cancelOrder;
      const core = readJson(CORE_KEY, {});
      const order = (Array.isArray(core.orders) ? core.orders : []).find(item => String(item.id) === String(id));
      if (order) archiveCanceledOrder(order);
    }, true);

    document.addEventListener('click', event => {
      const open = event.target.closest?.('[data-open-audit]');
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        openRecord(open.dataset.openAudit);
        return;
      }
      const row = event.target.closest?.('[data-audit-record-id]');
      if (row) {
        openRecord(row.dataset.auditRecordId);
        return;
      }
      const filter = event.target.closest?.('[data-audit-filter]')?.dataset.auditFilter;
      if (FILTERS.has(filter)) {
        store.ui.filter = filter;
        writeStore();
        render();
        return;
      }
      if (event.target.closest?.('[data-audit-detail-close]')) closeDetail();
      if (event.target.closest?.('[data-account-tab="audit"]')) scheduleRefresh();
    });

    window.addEventListener('storage', event => {
      if ([CORE_KEY, OCO_KEY, EXIT_KEY, STORE_KEY].includes(event.key)) scheduleRefresh();
    });
    mutationObserver = new MutationObserver(scheduleRefresh);
    ['#positionsBody', '#ordersBody', '#historyBody']
      .map(selector => $(selector)).filter(Boolean)
      .forEach(element => mutationObserver.observe(element, { childList: true, subtree: true }));
    setInterval(() => refresh(), 500);
  }

  function init() {
    mount();
    bind();
    refresh(true);
    window.AtlasExecutionAudit = {
      getRecords,
      openRecord,
      refresh: () => refresh(true),
      archiveCanceledOrder,
    };
    document.documentElement.dataset.executionAudit = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
