(() => {
  'use strict';
  if (window.__ATLAS_PRO_ALERT_CENTER__) return;
  window.__ATLAS_PRO_ALERT_CENTER__ = true;

  const STORE_KEY = 'atlasX.pro.alertCenter.v1';
  const CORE_KEY = 'atlasX.pro.v1';
  const OCO_KEY = 'atlasX.pro.advancedOrders.v1';
  const EXIT_KEY = 'atlasX.pro.exitStrategies.v1';
  const MAX_RULES = 30;
  const MAX_EVENTS = 100;
  const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
  const PRICE_RULE_TYPES = new Set(['price_above', 'price_below']);
  const OCO_TERMINAL = new Set(['completed_stop', 'completed_take_profit', 'expired', 'canceled', 'error']);
  const EXIT_EVENT_STATUSES = new Set(['partially_completed', 'partially_canceled', 'completed', 'expired', 'canceled', 'error']);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let storeExists = false;
  let state = readState();
  let evaluateTimer = 0;
  let rendering = false;

  function numberFrom(value) {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function defaultState() {
    return {
      version: 1,
      rules: [],
      events: [],
      snapshots: {
        initialized: false,
        historyIds: [],
        ocoStatuses: {},
        exitStatuses: {},
      },
      ui: { tab: 'all' },
      updatedAt: 0,
    };
  }

  function normalizeRule(rule) {
    const type = PRICE_RULE_TYPES.has(rule?.type) ? rule.type : 'price_above';
    const threshold = numberFrom(rule?.threshold);
    if (!rule?.id || !rule?.symbol || !(threshold > 0)) return null;
    return {
      id: String(rule.id),
      symbol: String(rule.symbol).toUpperCase(),
      type,
      threshold,
      enabled: rule.enabled !== false,
      cooldownMs: Math.max(1000, numberFrom(rule.cooldownMs) || DEFAULT_COOLDOWN_MS),
      lastTriggeredAt: Math.max(0, numberFrom(rule.lastTriggeredAt)),
      lastObservedPrice: Math.max(0, numberFrom(rule.lastObservedPrice)),
      createdAt: Math.max(0, numberFrom(rule.createdAt)) || Date.now(),
      updatedAt: Math.max(0, numberFrom(rule.updatedAt)) || Date.now(),
    };
  }

  function normalizeEvent(event) {
    if (!event?.id || !event?.sourceKey || !event?.title) return null;
    return {
      id: String(event.id),
      sourceKey: String(event.sourceKey),
      kind: String(event.kind || 'system'),
      severity: ['info', 'warning', 'critical'].includes(event.severity) ? event.severity : 'info',
      symbol: String(event.symbol || '').toUpperCase(),
      title: String(event.title),
      message: String(event.message || ''),
      ruleId: event.ruleId ? String(event.ruleId) : '',
      read: event.read === true,
      createdAt: Math.max(0, numberFrom(event.createdAt)) || Date.now(),
    };
  }

  function readState() {
    const rawText = localStorage.getItem(STORE_KEY);
    storeExists = Boolean(rawText);
    const raw = readJson(STORE_KEY, defaultState());
    const base = defaultState();
    const snapshots = raw.snapshots && typeof raw.snapshots === 'object' ? raw.snapshots : {};
    return {
      version: 1,
      rules: (Array.isArray(raw.rules) ? raw.rules : []).map(normalizeRule).filter(Boolean).slice(0, MAX_RULES),
      events: (Array.isArray(raw.events) ? raw.events : []).map(normalizeEvent).filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_EVENTS),
      snapshots: {
        initialized: snapshots.initialized === true,
        historyIds: Array.isArray(snapshots.historyIds) ? snapshots.historyIds.map(String).slice(0, 300) : [],
        ocoStatuses: snapshots.ocoStatuses && typeof snapshots.ocoStatuses === 'object' ? { ...snapshots.ocoStatuses } : {},
        exitStatuses: snapshots.exitStatuses && typeof snapshots.exitStatuses === 'object' ? { ...snapshots.exitStatuses } : {},
      },
      ui: { tab: ['all', 'unread', 'rules'].includes(raw.ui?.tab) ? raw.ui.tab : base.ui.tab },
      updatedAt: Math.max(0, numberFrom(raw.updatedAt)),
    };
  }

  function writeState({ render = true } = {}) {
    state.version = 1;
    state.rules = state.rules.map(normalizeRule).filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RULES);
    state.events = state.events.map(normalizeEvent).filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_EVENTS);
    state.snapshots.historyIds = [...new Set(state.snapshots.historyIds.map(String))].slice(0, 300);
    state.updatedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
    updateBadge();
    if (render && isOpen()) renderCenter();
  }

  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function activePair() {
    return ($('#activePair')?.textContent || 'BTC/USDT').trim();
  }

  function activeSymbol() {
    return activePair().replace('/', '');
  }

  function pairForSymbol(symbol) {
    const normalized = String(symbol || '').toUpperCase();
    return normalized.endsWith('USDT') ? `${normalized.slice(0, -4)}/USDT` : normalized;
  }

  function currentPrice() {
    return numberFrom($('#lastPrice')?.textContent);
  }

  function formatPrice(value) {
    const number = numberFrom(value);
    const decimals = number >= 1000 ? 2 : number >= 1 ? 4 : 8;
    return number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals });
  }

  function formatQuantity(value) {
    return numberFrom(value).toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  function formatTime(timestamp) {
    const date = new Date(numberFrom(timestamp));
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function unreadCount() {
    return state.events.filter(event => !event.read).length;
  }

  function addEvent(input) {
    if (!input?.sourceKey || state.events.some(event => event.sourceKey === input.sourceKey)) return false;
    state.events.unshift(normalizeEvent({
      id: uid('alert-event'),
      createdAt: Date.now(),
      read: false,
      ...input,
    }));
    state.events = state.events.filter(Boolean).slice(0, MAX_EVENTS);
    return true;
  }

  function establishBaseline() {
    if (state.snapshots.initialized) return;
    const core = readJson(CORE_KEY, {});
    const oco = readJson(OCO_KEY, { orders: [] });
    const exits = readJson(EXIT_KEY, { strategies: [] });
    state.snapshots.historyIds = (Array.isArray(core.history) ? core.history : []).map(item => String(item.id));
    state.snapshots.ocoStatuses = Object.fromEntries((Array.isArray(oco.orders) ? oco.orders : [])
      .filter(item => item?.id).map(item => [String(item.id), String(item.status || '')]));
    state.snapshots.exitStatuses = Object.fromEntries((Array.isArray(exits.strategies) ? exits.strategies : [])
      .filter(item => item?.id).map(item => [String(item.id), String(item.status || '')]));
    state.snapshots.initialized = true;
    writeState({ render: false });
  }

  function evaluatePriceRules(symbol, price) {
    const normalizedSymbol = String(symbol || '').toUpperCase();
    const numericPrice = numberFrom(price);
    if (!normalizedSymbol || !(numericPrice > 0)) return false;
    const now = Date.now();
    let changed = false;
    state.rules.forEach(rule => {
      if (rule.symbol !== normalizedSymbol) return;
      const previous = numberFrom(rule.lastObservedPrice);
      const crossedAbove = rule.type === 'price_above' && previous > 0 && previous < rule.threshold && numericPrice >= rule.threshold;
      const crossedBelow = rule.type === 'price_below' && previous > 0 && previous > rule.threshold && numericPrice <= rule.threshold;
      const crossed = crossedAbove || crossedBelow;
      const cooledDown = now - numberFrom(rule.lastTriggeredAt) >= rule.cooldownMs;
      if (rule.enabled && crossed && cooledDown) {
        const direction = rule.type === 'price_above' ? '上穿' : '下穿';
        addEvent({
          sourceKey: `price:${rule.id}:${now}`,
          kind: 'price',
          severity: 'info',
          symbol: rule.symbol,
          ruleId: rule.id,
          title: `${pairForSymbol(rule.symbol)} 已${direction} ${formatPrice(rule.threshold)}`,
          message: `当前价格 ${formatPrice(numericPrice)}，规则已触发并进入 ${Math.round(rule.cooldownMs / 60000)} 分钟冷却。`,
        });
        rule.lastTriggeredAt = now;
        rule.updatedAt = now;
        changed = true;
      }
      if (rule.lastObservedPrice !== numericPrice) {
        rule.lastObservedPrice = numericPrice;
        rule.updatedAt = now;
        changed = true;
      }
    });
    return changed;
  }

  function sideLabel(side) {
    return side === 'sell' ? '卖出' : '买入';
  }

  function collectCoreEvents() {
    const core = readJson(CORE_KEY, {});
    const history = Array.isArray(core.history) ? core.history : [];
    const known = new Set(state.snapshots.historyIds.map(String));
    let changed = false;
    history.forEach(fill => {
      if (!fill?.id) return;
      const id = String(fill.id);
      if (!known.has(id)) {
        addEvent({
          sourceKey: `core-fill:${id}`,
          kind: 'order',
          severity: 'info',
          symbol: String(fill.symbol || '').toUpperCase(),
          title: `${pairForSymbol(fill.symbol)} 模拟${sideLabel(fill.side)}已成交`,
          message: `${formatQuantity(fill.qty)} · ${formatPrice(fill.price)} USDT · 手续费 ${numberFrom(fill.fee).toFixed(4)} USDT`,
        });
        changed = true;
      }
    });
    const nextIds = history.map(fill => String(fill.id)).slice(0, 300);
    if (JSON.stringify(nextIds) !== JSON.stringify(state.snapshots.historyIds)) {
      state.snapshots.historyIds = nextIds;
      changed = true;
    }
    return changed;
  }

  function ocoEvent(order) {
    const status = String(order.status || '');
    const pair = pairForSymbol(order.symbol);
    if (status === 'completed_stop') return {
      severity: 'critical', title: `${pair} OCO 止损已执行`,
      message: `${formatQuantity(order.quantity)} 已按止损逻辑减仓，止盈腿已终止。`,
    };
    if (status === 'completed_take_profit') return {
      severity: 'info', title: `${pair} OCO 止盈已完成`,
      message: `${formatQuantity(order.quantity)} 已完成止盈，止损监控已终止。`,
    };
    if (status === 'expired') return {
      severity: 'warning', title: `${pair} OCO 已到期`, message: '关联止盈委托已撤销，未执行止损。',
    };
    if (status === 'canceled') return {
      severity: 'warning', title: `${pair} OCO 已取消`, message: '两条退出条件均已停止。',
    };
    return { severity: 'critical', title: `${pair} OCO 执行异常`, message: '请检查本地订单状态与可用持仓。' };
  }

  function collectOcoEvents() {
    const oco = readJson(OCO_KEY, { orders: [] });
    const orders = Array.isArray(oco.orders) ? oco.orders : [];
    const nextStatuses = {};
    let changed = false;
    orders.forEach(order => {
      if (!order?.id) return;
      const id = String(order.id);
      const status = String(order.status || '');
      const previous = state.snapshots.ocoStatuses[id];
      nextStatuses[id] = status;
      if (OCO_TERMINAL.has(status) && previous !== status) {
        const content = ocoEvent(order);
        addEvent({
          sourceKey: `oco:${id}:${status}`,
          kind: 'oco',
          severity: content.severity,
          symbol: String(order.symbol || '').toUpperCase(),
          title: content.title,
          message: content.message,
        });
        changed = true;
      }
    });
    if (JSON.stringify(nextStatuses) !== JSON.stringify(state.snapshots.ocoStatuses)) {
      state.snapshots.ocoStatuses = nextStatuses;
      changed = true;
    }
    return changed;
  }

  function exitEvent(strategy) {
    const status = String(strategy.status || '');
    const pair = pairForSymbol(strategy.symbol);
    const trailing = strategy.kind === 'trailing_stop';
    if (status === 'completed' && trailing) return {
      severity: 'critical', title: `${pair} 追踪止损已触发`,
      message: `${formatQuantity(strategy.quantity)} 已通过核心市价减仓。`,
    };
    if (status === 'completed') return {
      severity: 'info', title: `${pair} 分批止盈已全部完成`, message: '全部止盈档位均已成交。',
    };
    if (status === 'partially_completed') return {
      severity: 'warning', title: `${pair} 分批止盈部分完成`, message: '至少一个止盈档位已成交，其余档位继续等待。',
    };
    if (status === 'partially_canceled') return {
      severity: 'warning', title: `${pair} 分批止盈部分取消`, message: '部分档位已撤销，已成交部分保留。',
    };
    if (status === 'expired') return {
      severity: 'warning', title: `${pair} 退出策略已到期`, message: '未完成的退出委托已停止。',
    };
    if (status === 'canceled') return {
      severity: 'warning', title: `${pair} 退出策略已取消`, message: '该策略不再占用可用持仓。',
    };
    return { severity: 'critical', title: `${pair} 退出策略异常`, message: '请检查模拟账本与策略状态。' };
  }

  function collectExitEvents() {
    const exits = readJson(EXIT_KEY, { strategies: [] });
    const strategies = Array.isArray(exits.strategies) ? exits.strategies : [];
    const nextStatuses = {};
    let changed = false;
    strategies.forEach(strategy => {
      if (!strategy?.id) return;
      const id = String(strategy.id);
      const status = String(strategy.status || '');
      const previous = state.snapshots.exitStatuses[id];
      nextStatuses[id] = status;
      if (EXIT_EVENT_STATUSES.has(status) && previous !== status) {
        const content = exitEvent(strategy);
        addEvent({
          sourceKey: `exit:${id}:${status}`,
          kind: 'exit',
          severity: content.severity,
          symbol: String(strategy.symbol || '').toUpperCase(),
          title: content.title,
          message: content.message,
        });
        changed = true;
      }
    });
    if (JSON.stringify(nextStatuses) !== JSON.stringify(state.snapshots.exitStatuses)) {
      state.snapshots.exitStatuses = nextStatuses;
      changed = true;
    }
    return changed;
  }

  function evaluateNow(options = {}) {
    state = readState();
    establishBaseline();
    const symbol = String(options.symbol || activeSymbol()).toUpperCase();
    const price = numberFrom(options.price) || currentPrice();
    const changed = evaluatePriceRules(symbol, price)
      | collectCoreEvents()
      | collectOcoEvents()
      | collectExitEvents();
    if (changed) writeState();
    else {
      updateBadge();
      if (isOpen()) renderCenter();
    }
    return { changed: Boolean(changed), unread: unreadCount() };
  }

  function scheduleEvaluate() {
    clearTimeout(evaluateTimer);
    evaluateTimer = setTimeout(() => evaluateNow(), 40);
  }

  function createPriceRule(input = {}) {
    state = readState();
    const symbol = String(input.symbol || activeSymbol()).toUpperCase();
    const type = PRICE_RULE_TYPES.has(input.type) ? input.type : 'price_above';
    const threshold = numberFrom(input.threshold);
    if (!symbol || !(threshold > 0)) return { ok: false, message: '请输入有效提醒价格' };
    if (state.rules.length >= MAX_RULES) return { ok: false, message: `最多保存 ${MAX_RULES} 条提醒规则` };
    const now = Date.now();
    const rule = normalizeRule({
      id: uid('alert-rule'),
      symbol,
      type,
      threshold,
      enabled: true,
      cooldownMs: numberFrom(input.cooldownMs) || DEFAULT_COOLDOWN_MS,
      lastTriggeredAt: 0,
      lastObservedPrice: numberFrom(input.currentPrice) || (symbol === activeSymbol() ? currentPrice() : 0),
      createdAt: now,
      updatedAt: now,
    });
    state.rules.unshift(rule);
    writeState();
    return { ok: true, rule };
  }

  function markAllRead() {
    state = readState();
    let changed = false;
    state.events.forEach(event => {
      if (!event.read) {
        event.read = true;
        changed = true;
      }
    });
    if (changed) writeState();
    else updateBadge();
  }

  function clearReadEvents() {
    state = readState();
    state.events = state.events.filter(event => !event.read);
    writeState();
  }

  function setRuleEnabled(id, enabled) {
    state = readState();
    const rule = state.rules.find(item => item.id === id);
    if (!rule) return;
    rule.enabled = enabled;
    rule.lastObservedPrice = rule.symbol === activeSymbol() ? currentPrice() : rule.lastObservedPrice;
    rule.updatedAt = Date.now();
    writeState();
  }

  function deleteRule(id) {
    state = readState();
    state.rules = state.rules.filter(rule => rule.id !== id);
    writeState();
  }

  function markEventRead(id) {
    state = readState();
    const event = state.events.find(item => item.id === id);
    if (!event || event.read) return;
    event.read = true;
    writeState();
  }

  function badgeElement() {
    return $('.notification-button .alert-center-badge');
  }

  function mountBadge() {
    const button = $('.notification-button');
    if (!button || badgeElement()) return;
    const legacy = [...button.children].find(element => element.tagName === 'I');
    legacy?.classList.add('notification-legacy-dot');
    const badge = document.createElement('span');
    badge.className = 'alert-center-badge';
    badge.hidden = true;
    badge.setAttribute('aria-label', '未读预警');
    button.append(badge);
  }

  function updateBadge() {
    mountBadge();
    const badge = badgeElement();
    if (!badge) return;
    const count = unreadCount();
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.dataset.unreadCount = String(count);
    $('.notification-button')?.classList.toggle('has-alerts', count > 0);
  }

  function isOpen() {
    const popover = $('#controlPopover');
    return Boolean(popover && !popover.hidden && popover.classList.contains('alert-center-popover'));
  }

  function summaryMarkup() {
    const activeRules = state.rules.filter(rule => rule.enabled).length;
    const unread = unreadCount();
    const critical = state.events.filter(event => !event.read && event.severity === 'critical').length;
    return `<div class="alert-center-summary">
      <div><span>活动规则</span><b>${activeRules}</b></div>
      <div><span>未读事件</span><b>${unread}</b></div>
      <div class="${critical ? 'critical' : ''}"><span>高风险未读</span><b>${critical}</b></div>
    </div>`;
  }

  function tabsMarkup() {
    const tabs = [['all', '全部'], ['unread', '未读'], ['rules', '规则']];
    return `<nav class="alert-center-tabs">${tabs.map(([id, label]) => `<button type="button" data-alert-tab="${id}" class="${state.ui.tab === id ? 'active' : ''}">${label}${id === 'unread' && unreadCount() ? `<b>${unreadCount()}</b>` : ''}</button>`).join('')}</nav>`;
  }

  function severityLabel(severity) {
    return ({ info: '信息', warning: '注意', critical: '高风险' })[severity] || '信息';
  }

  function eventListMarkup() {
    const events = state.ui.tab === 'unread' ? state.events.filter(event => !event.read) : state.events;
    if (!events.length) return `<div class="alert-center-empty"><b>${state.ui.tab === 'unread' ? '没有未读事件' : '暂无预警事件'}</b><small>价格规则触发、模拟成交和退出策略状态会显示在这里。</small></div>`;
    return `<div class="alert-center-event-list">${events.map(event => `<button type="button" class="alert-center-event ${event.severity} ${event.read ? 'read' : 'unread'}" data-alert-event-id="${escapeHtml(event.id)}">
      <i></i><span><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.message)}</small><em>${escapeHtml(formatTime(event.createdAt))}${event.symbol ? ` · ${escapeHtml(pairForSymbol(event.symbol))}` : ''}</em></span><b>${severityLabel(event.severity)}</b>
    </button>`).join('')}</div>`;
  }

  function ruleFormMarkup() {
    const price = currentPrice();
    return `<section class="alert-center-rule-form">
      <header><div><strong>创建价格提醒</strong><small>${escapeHtml(activePair())} · 仅当前浏览器运行时监控</small></div><b>5 分钟冷却</b></header>
      <div class="alert-center-rule-inputs">
        <select id="alertRuleDirection" aria-label="价格提醒方向"><option value="price_above">价格上穿</option><option value="price_below">价格下穿</option></select>
        <input id="alertRuleThreshold" type="number" min="0" step="any" value="${price > 0 ? escapeHtml(String(price)) : ''}" placeholder="提醒价格" aria-label="提醒价格">
        <button id="alertRuleCreate" type="button">创建提醒</button>
      </div>
      <div class="alert-center-price-shortcuts"><button type="button" data-alert-price-offset="1">当前价 +1%</button><button type="button" data-alert-price-offset="-1">当前价 -1%</button><span>当前 ${price > 0 ? formatPrice(price) : '--'}</span></div>
      <p id="alertRuleFormStatus" role="status">创建后必须真实穿越阈值才会触发，不会立即补发。</p>
    </section>`;
  }

  function ruleListMarkup() {
    if (!state.rules.length) return '<div class="alert-center-empty compact"><b>尚未创建提醒规则</b><small>可为当前交易对设置上穿或下穿价格。</small></div>';
    return `<div class="alert-center-rule-list">${state.rules.map(rule => `<article class="alert-center-rule ${rule.enabled ? 'enabled' : 'disabled'}" data-alert-rule-id="${escapeHtml(rule.id)}">
      <i></i><div><strong>${escapeHtml(pairForSymbol(rule.symbol))} ${rule.type === 'price_above' ? '上穿' : '下穿'} ${escapeHtml(formatPrice(rule.threshold))}</strong><small>${rule.enabled ? '运行中' : '已停用'} · 冷却 ${Math.round(rule.cooldownMs / 60000)} 分钟${rule.lastTriggeredAt ? ` · 最近触发 ${escapeHtml(formatTime(rule.lastTriggeredAt))}` : ''}</small></div>
      <button type="button" data-alert-rule-toggle>${rule.enabled ? '停用' : '启用'}</button>
      <button type="button" data-alert-rule-delete aria-label="删除提醒规则">删除</button>
    </article>`).join('')}</div>`;
  }

  function contentMarkup() {
    if (state.ui.tab === 'rules') return `${ruleFormMarkup()}${ruleListMarkup()}`;
    return eventListMarkup();
  }

  function shellMarkup() {
    return `<section class="alert-center-shell">
      ${summaryMarkup()}
      <div class="alert-center-toolbar">${tabsMarkup()}<div><button id="alertCenterMarkAllRead" type="button">全部已读</button><button id="alertCenterClearRead" type="button">清空已读</button></div></div>
      <div class="alert-center-content">${contentMarkup()}</div>
      <footer class="alert-center-foot"><i></i><span>页面关闭后不会继续监控；预警不会自动提交订单。</span></footer>
    </section>`;
  }

  function renderCenter() {
    if (rendering || !isOpen()) return;
    rendering = true;
    try {
      const body = $('#popoverBody');
      if (body) body.innerHTML = shellMarkup();
      updateBadge();
    } finally {
      rendering = false;
    }
  }

  function open() {
    state = readState();
    evaluateNow();
    const popover = $('#controlPopover');
    const title = $('#popoverTitle');
    const body = $('#popoverBody');
    if (!popover || !title || !body) return;
    title.textContent = '专业预警中心';
    popover.classList.add('alert-center-popover');
    popover.hidden = false;
    renderCenter();
  }

  function close() {
    const popover = $('#controlPopover');
    if (popover) popover.hidden = true;
  }

  function setFormStatus(message, level = '') {
    const status = $('#alertRuleFormStatus');
    if (!status) return;
    status.textContent = message;
    status.className = level;
  }

  function bindPopoverEvents() {
    document.addEventListener('click', event => {
      const notification = event.target.closest?.('.notification-button');
      if (notification) {
        event.preventDefault();
        event.stopImmediatePropagation();
        open();
        return;
      }
      if (event.target.closest?.('.sidebar-head .icon-button')) {
        $('#controlPopover')?.classList.remove('alert-center-popover');
      }
    }, true);

    document.addEventListener('click', event => {
      const popover = event.target.closest?.('#controlPopover.alert-center-popover');
      if (!popover) return;
      const tab = event.target.closest?.('[data-alert-tab]')?.dataset.alertTab;
      if (tab && ['all', 'unread', 'rules'].includes(tab)) {
        state.ui.tab = tab;
        writeState();
        return;
      }
      if (event.target.closest('#alertCenterMarkAllRead')) {
        markAllRead();
        return;
      }
      if (event.target.closest('#alertCenterClearRead')) {
        clearReadEvents();
        return;
      }
      const eventId = event.target.closest?.('[data-alert-event-id]')?.dataset.alertEventId;
      if (eventId) {
        markEventRead(eventId);
        return;
      }
      const offset = numberFrom(event.target.closest?.('[data-alert-price-offset]')?.dataset.alertPriceOffset);
      if (offset) {
        const input = $('#alertRuleThreshold');
        const price = currentPrice();
        if (input && price > 0) input.value = String(Number((price * (1 + offset / 100)).toFixed(8)));
        return;
      }
      if (event.target.closest('#alertRuleCreate')) {
        const result = createPriceRule({
          symbol: activeSymbol(),
          type: $('#alertRuleDirection')?.value,
          threshold: $('#alertRuleThreshold')?.value,
          currentPrice: currentPrice(),
        });
        setFormStatus(result.message || (result.ok ? '提醒规则已创建并开始监听真实价格穿越。' : '无法创建提醒规则'), result.ok ? 'positive' : 'negative');
        return;
      }
      const ruleCard = event.target.closest?.('[data-alert-rule-id]');
      if (!ruleCard) return;
      const id = ruleCard.dataset.alertRuleId;
      if (event.target.closest('[data-alert-rule-toggle]')) {
        const rule = state.rules.find(item => item.id === id);
        if (rule) setRuleEnabled(id, !rule.enabled);
      } else if (event.target.closest('[data-alert-rule-delete]')) {
        deleteRule(id);
      }
    });
  }

  function bindObservers() {
    const observer = new MutationObserver(scheduleEvaluate);
    ['#lastPrice', '#activePair', '#positionsBody', '#ordersBody', '#advancedOcoList', '#advancedExitList']
      .map(selector => $(selector)).filter(Boolean)
      .forEach(element => observer.observe(element, { childList: true, characterData: true, subtree: true }));
    window.addEventListener('storage', event => {
      if (event.key === STORE_KEY) {
        state = readState();
        updateBadge();
        if (isOpen()) renderCenter();
      } else if ([CORE_KEY, OCO_KEY, EXIT_KEY].includes(event.key)) {
        scheduleEvaluate();
      }
    });
  }

  function init() {
    mountBadge();
    establishBaseline();
    bindPopoverEvents();
    bindObservers();
    updateBadge();
    window.AtlasAlertCenter = {
      getState: () => JSON.parse(JSON.stringify(state)),
      open,
      close,
      evaluateNow,
      createPriceRule,
      markAllRead,
    };
    document.documentElement.dataset.alertCenter = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
