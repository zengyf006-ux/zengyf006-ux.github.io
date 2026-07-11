(() => {
  'use strict';
  if (window.__ATLAS_WORKSPACE_COMMAND_CENTER__) return;
  window.__ATLAS_WORKSPACE_COMMAND_CENTER__ = true;

  const STORE_KEY = 'atlasX.pro.workspace.v1';
  const MODES = new Set(['standard', 'chart', 'execution', 'risk']);
  const PRESETS = {
    conservative: { orderType: 'limit', postOnly: true, riskPercent: 0.5 },
    balanced: { orderType: 'limit', postOnly: false, riskPercent: 1 },
    active: { orderType: 'market', postOnly: false, riskPercent: 1.5 },
  };
  const DEFAULT_STATE = {
    version: 1,
    mode: 'standard',
    preset: 'balanced',
    locked: false,
    updatedAt: 0,
  };
  const TRADE_SUBMIT_SELECTOR = [
    '#submitOrder',
    '#createOcoOrder',
    '#createTrailingStop',
    '#createScaledExit',
    '[data-create-trailing-exit]',
    '[data-create-scaled-exit]',
  ].join(',');
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let state = readState();
  let commandResults = [];
  let selectedCommandIndex = 0;
  let lastFocusedElement = null;
  let unlockPendingUntil = 0;
  let unlockTimer = 0;

  function readState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!stored || typeof stored !== 'object') return { ...DEFAULT_STATE };
      return {
        version: 1,
        mode: MODES.has(stored.mode) ? stored.mode : DEFAULT_STATE.mode,
        preset: PRESETS[stored.preset] ? stored.preset : DEFAULT_STATE.preset,
        locked: stored.locked === true,
        updatedAt: Number(stored.updatedAt) || 0,
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  function writeState() {
    state.version = 1;
    state.updatedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function markup() {
    return `
      <button id="workspaceStatusChip" class="workspace-status-chip" type="button" aria-label="打开专业工作区">
        <i></i><span id="workspaceStatusMode">标准工作区</span><b id="workspaceStatusLock">可交易</b>
      </button>

      <div id="workspaceCommandBackdrop" class="workspace-backdrop" hidden></div>
      <section id="workspaceCommandDialog" class="workspace-command-dialog" role="dialog" aria-modal="true" aria-labelledby="workspaceCommandTitle" hidden>
        <header class="workspace-command-head">
          <div><strong id="workspaceCommandTitle">快速命令</strong><small>市场与终端操作</small></div>
          <kbd>ESC</kbd>
        </header>
        <label class="workspace-command-search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="workspaceCommandInput" type="search" autocomplete="off" placeholder="搜索交易对、工作区或操作" aria-label="搜索命令">
        </label>
        <div id="workspaceCommandResults" class="workspace-command-results" role="listbox"></div>
        <footer class="workspace-command-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 执行</span><span><kbd>⌘/Ctrl K</kbd> 打开</span></footer>
      </section>

      <div id="workspacePanelBackdrop" class="workspace-panel-backdrop" hidden></div>
      <section id="workspacePanel" class="workspace-panel" role="dialog" aria-modal="true" aria-labelledby="workspacePanelTitle" hidden>
        <header class="workspace-panel-head">
          <div><strong id="workspacePanelTitle">专业工作区</strong><small>布局、预设与安全控制</small></div>
          <button id="workspacePanelClose" type="button" aria-label="关闭工作区面板">×</button>
        </header>

        <section class="workspace-panel-section">
          <div class="workspace-section-title"><strong>工作区模式</strong><small>按当前任务减少无关信息</small></div>
          <div class="workspace-mode-grid">
            <button type="button" data-workspace-mode-option="standard"><b>标准</b><small>完整四列终端</small></button>
            <button type="button" data-workspace-mode-option="chart"><b>图表专注</b><small>最大化分析区域</small></button>
            <button type="button" data-workspace-mode-option="execution"><b>执行专注</b><small>图表、盘口与下单</small></button>
            <button type="button" data-workspace-mode-option="risk"><b>风险复核</b><small>持仓与退出策略</small></button>
          </div>
        </section>

        <section class="workspace-panel-section">
          <div class="workspace-section-title"><strong>交易预设</strong><small>只填参数，不会自动提交</small></div>
          <div class="workspace-preset-grid">
            <button type="button" data-workspace-preset="conservative"><b>保守</b><small>限价 · Post Only · 风险 0.5%</small></button>
            <button type="button" data-workspace-preset="balanced"><b>均衡</b><small>限价 · 风险 1.0%</small></button>
            <button type="button" data-workspace-preset="active"><b>主动</b><small>市价 · 风险 1.5%</small></button>
          </div>
        </section>

        <section class="workspace-lock-card">
          <div class="workspace-lock-copy"><span><i></i><strong>交易安全锁</strong></span><small id="workspaceLockStatus">当前允许创建模拟订单与退出策略。</small></div>
          <button id="workspaceLockButton" type="button">锁定交易</button>
        </section>

        <section class="workspace-shortcuts">
          <div class="workspace-section-title"><strong>快捷键</strong><small>输入框聚焦时自动停用</small></div>
          <div><span>买入 / 卖出</span><b><kbd>B</kbd><kbd>S</kbd></b></div>
          <div><span>市价 / 限价 / 止盈止损</span><b><kbd>M</kbd><kbd>L</kbd><kbd>T</kbd></b></div>
          <div><span>锁定交易</span><b><kbd>⌘/Ctrl</kbd><kbd>Shift</kbd><kbd>L</kbd></b></div>
        </section>
      </section>`;
  }

  function mount() {
    if ($('#workspaceCommandDialog')) return;
    document.body.insertAdjacentHTML('beforeend', markup());
    const statusAnchor = $('#layoutButton');
    const statusChip = $('#workspaceStatusChip');
    if (statusAnchor && statusChip) statusAnchor.before(statusChip);
  }

  function modeLabel(mode = state.mode) {
    return ({ standard: '标准工作区', chart: '图表专注', execution: '执行专注', risk: '风险复核' })[mode] || '标准工作区';
  }

  function renderState() {
    document.documentElement.dataset.workspaceMode = state.mode;
    document.documentElement.dataset.tradingLocked = String(state.locked);
    document.documentElement.dataset.unlockPending = String(unlockPendingUntil > Date.now());
    const modeCopy = $('#workspaceStatusMode');
    const lockCopy = $('#workspaceStatusLock');
    if (modeCopy) modeCopy.textContent = modeLabel();
    if (lockCopy) lockCopy.textContent = state.locked ? '已锁定' : '可交易';
    const chip = $('#workspaceStatusChip');
    chip?.classList.toggle('locked', state.locked);
    $$('[data-workspace-mode-option]').forEach(button => {
      button.classList.toggle('active', button.dataset.workspaceModeOption === state.mode);
    });
    $$('[data-workspace-preset]').forEach(button => {
      button.classList.toggle('active', button.dataset.workspacePreset === state.preset);
    });
    const lockButton = $('#workspaceLockButton');
    if (lockButton) {
      const pending = unlockPendingUntil > Date.now();
      lockButton.textContent = state.locked ? (pending ? '再次确认解锁' : '请求解锁') : '锁定交易';
      lockButton.classList.toggle('unlock-pending', pending);
    }
    const status = $('#workspaceLockStatus');
    if (status) {
      if (!state.locked) status.textContent = '当前允许创建模拟订单与退出策略。';
      else if (unlockPendingUntil > Date.now()) status.textContent = '3 秒内再次确认，才会解除交易锁。';
      else status.textContent = '所有普通订单与高级退出策略已锁定。';
    }
  }

  function setMode(mode, { persist = true, announce = true } = {}) {
    if (!MODES.has(mode)) return false;
    state.mode = mode;
    if (persist) writeState();
    renderState();
    if (mode === 'risk') $('[data-account-tab="positions"]')?.click();
    if (innerWidth <= 820) {
      const mobileView = mode === 'risk' ? 'account' : 'chart';
      $(`[data-mobile-view="${mobileView}"]`)?.click();
    }
    window.dispatchEvent(new Event('resize'));
    if (announce) showToast(`已切换至${modeLabel(mode)}`);
    return true;
  }

  function setCheckbox(element, checked) {
    if (!element) return;
    element.checked = checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setInput(element, value) {
    if (!element) return;
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyPreset(id, { announce = true } = {}) {
    const preset = PRESETS[id];
    if (!preset) return false;
    $(`[data-order-type="${preset.orderType}"]`)?.click();
    setCheckbox($('#postOnly'), preset.postOnly);
    setInput($('#riskPercent'), preset.riskPercent);
    state.preset = id;
    writeState();
    renderState();
    if (announce) {
      const label = ({ conservative: '保守', balanced: '均衡', active: '主动' })[id];
      showToast(`已应用${label}预设，仅更新参数`);
    }
    return true;
  }

  function clearUnlockPending() {
    unlockPendingUntil = 0;
    clearTimeout(unlockTimer);
    renderState();
  }

  function setLocked(locked, { force = false, announce = true } = {}) {
    if (locked) {
      clearTimeout(unlockTimer);
      unlockPendingUntil = 0;
      state.locked = true;
      writeState();
      renderState();
      if (announce) showToast('交易安全锁已开启');
      return true;
    }
    if (!state.locked) return true;
    if (!force && unlockPendingUntil <= Date.now()) {
      unlockPendingUntil = Date.now() + 3000;
      clearTimeout(unlockTimer);
      unlockTimer = setTimeout(clearUnlockPending, 3050);
      renderState();
      if (announce) showToast('请在 3 秒内再次确认解锁');
      return false;
    }
    clearTimeout(unlockTimer);
    unlockPendingUntil = 0;
    state.locked = false;
    writeState();
    renderState();
    if (announce) showToast('交易安全锁已解除');
    return true;
  }

  function openPanel() {
    closeCommand({ restoreFocus: false });
    const panel = $('#workspacePanel');
    const backdrop = $('#workspacePanelBackdrop');
    if (!panel || !backdrop) return;
    lastFocusedElement = document.activeElement;
    panel.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('workspace-panel-open');
    renderState();
    $('#workspacePanelClose')?.focus();
  }

  function closePanel({ restoreFocus = true } = {}) {
    const panel = $('#workspacePanel');
    const backdrop = $('#workspacePanelBackdrop');
    if (panel) panel.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('workspace-panel-open');
    if (restoreFocus && lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  }

  function togglePanel() {
    if ($('#workspacePanel')?.hidden === false) closePanel();
    else openPanel();
  }

  function marketIndex() {
    const markets = new Map();
    $$('[data-symbol]').forEach(element => {
      const symbol = String(element.dataset.symbol || '').toUpperCase();
      if (!/^[A-Z0-9]+USDT$/.test(symbol) || markets.has(symbol)) return;
      const base = symbol.replace(/USDT$/, '');
      const pair = `${base}/USDT`;
      const name = element.querySelector('.pair-cell small')?.textContent?.trim()
        || element.querySelector('small')?.textContent?.trim()
        || base;
      const price = element.querySelector('.price-cell')?.textContent?.trim() || '';
      markets.set(symbol, {
        type: 'market',
        id: `market-${symbol}`,
        symbol,
        label: pair,
        detail: `${name}${price ? ` · ${price}` : ''}`,
        keywords: `${symbol} ${pair} ${base} ${name}`.toLowerCase(),
      });
    });
    return [...markets.values()];
  }

  function actionIndex() {
    return [
      { type: 'action', id: 'mode-standard', label: '标准工作区', detail: '恢复完整四列终端', category: '工作区', keywords: '标准 工作区 完整 布局', run: () => setMode('standard') },
      { type: 'action', id: 'mode-chart', label: '图表专注', detail: '隐藏侧栏、盘口与下单区', category: '工作区', keywords: '图表 专注 k线 分析', run: () => setMode('chart') },
      { type: 'action', id: 'mode-execution', label: '执行专注', detail: '保留图表、盘口与下单区', category: '工作区', keywords: '执行 专注 下单 盘口', run: () => setMode('execution') },
      { type: 'action', id: 'mode-risk', label: '风险复核', detail: '放大持仓、风险与退出策略', category: '工作区', keywords: '风险 复核 持仓 退出', run: () => setMode('risk') },
      { type: 'action', id: 'preset-conservative', label: '应用保守预设', detail: '限价 · Post Only · 风险 0.5%', category: '预设', keywords: '保守 预设 limit post only', run: () => applyPreset('conservative') },
      { type: 'action', id: 'preset-balanced', label: '应用均衡预设', detail: '限价 · 风险 1.0%', category: '预设', keywords: '均衡 预设 limit', run: () => applyPreset('balanced') },
      { type: 'action', id: 'preset-active', label: '应用主动预设', detail: '市价 · 风险 1.5%', category: '预设', keywords: '主动 预设 market', run: () => applyPreset('active') },
      { type: 'action', id: 'side-buy', label: '切换买入', detail: '只切换方向，不提交订单', category: '交易', keywords: '买入 buy b', shortcut: 'B', run: () => activateSide('buy') },
      { type: 'action', id: 'side-sell', label: '切换卖出', detail: '只切换方向，不提交订单', category: '交易', keywords: '卖出 sell s', shortcut: 'S', run: () => activateSide('sell') },
      { type: 'action', id: 'type-market', label: '切换市价单', detail: '订单类型：市价', category: '订单', keywords: '市价 market m', shortcut: 'M', run: () => clickControl('[data-order-type="market"]') },
      { type: 'action', id: 'type-limit', label: '切换限价单', detail: '订单类型：限价', category: '订单', keywords: '限价 limit l', shortcut: 'L', run: () => clickControl('[data-order-type="limit"]') },
      { type: 'action', id: 'type-stop', label: '切换止盈止损', detail: '订单类型：条件触发', category: '订单', keywords: '止盈 止损 stop trigger t', shortcut: 'T', run: () => clickControl('[data-order-type="stop"]') },
      { type: 'action', id: 'lock-trading', label: state.locked ? '请求解除交易锁' : '锁定全部交易', detail: state.locked ? '需要二次确认' : '阻止普通单与高级退出策略', category: '安全', keywords: '锁定 解锁 安全 lock', run: () => setLocked(!state.locked) },
    ];
  }

  function commandIndex() {
    return [...marketIndex(), ...actionIndex()];
  }

  function renderCommandResults(query = '') {
    const normalized = String(query || '').trim().toLowerCase();
    const items = commandIndex();
    commandResults = items
      .filter(item => !normalized || `${item.label} ${item.detail} ${item.keywords || ''}`.toLowerCase().includes(normalized))
      .slice(0, 12);
    selectedCommandIndex = Math.min(selectedCommandIndex, Math.max(0, commandResults.length - 1));
    const list = $('#workspaceCommandResults');
    if (!list) return;
    if (!commandResults.length) {
      list.innerHTML = '<div class="workspace-command-empty"><b>没有匹配结果</b><small>尝试输入交易对、工作区或订单类型</small></div>';
      return;
    }
    list.innerHTML = commandResults.map((item, index) => {
      const data = item.type === 'market'
        ? `data-workspace-market="${escapeHtml(item.symbol)}"`
        : `data-workspace-command="${escapeHtml(item.id)}"`;
      const leading = item.type === 'market' ? item.symbol.replace(/USDT$/, '').slice(0, 2) : (item.category || '命').slice(0, 1);
      return `<button class="workspace-command-result${index === selectedCommandIndex ? ' selected' : ''}" type="button" role="option" aria-selected="${index === selectedCommandIndex}" data-workspace-result-index="${index}" ${data}>
        <i>${escapeHtml(leading)}</i><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></span>
        <em>${escapeHtml(item.type === 'market' ? '市场' : item.category || '操作')}</em>${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ''}
      </button>`;
    }).join('');
  }

  function openCommand() {
    closePanel({ restoreFocus: false });
    const dialog = $('#workspaceCommandDialog');
    const backdrop = $('#workspaceCommandBackdrop');
    if (!dialog || !backdrop) return;
    lastFocusedElement = document.activeElement;
    dialog.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('workspace-command-open');
    selectedCommandIndex = 0;
    const input = $('#workspaceCommandInput');
    if (input) input.value = '';
    renderCommandResults('');
    requestAnimationFrame(() => input?.focus());
  }

  function closeCommand({ restoreFocus = true } = {}) {
    const dialog = $('#workspaceCommandDialog');
    const backdrop = $('#workspaceCommandBackdrop');
    if (dialog) dialog.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('workspace-command-open');
    if (restoreFocus && lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  }

  function clickControl(selector) {
    const element = $(selector);
    if (!element) {
      showToast('当前视图暂不可执行该操作');
      return false;
    }
    element.click();
    return true;
  }

  function activateSide(side) {
    if (innerWidth <= 820) {
      const mobile = $(`[data-mobile-side="${side}"]`);
      if (mobile) {
        mobile.click();
        return true;
      }
    }
    return clickControl(`.side-selector [data-side="${side}"]`);
  }

  function executeCommand(index = selectedCommandIndex) {
    const item = commandResults[index];
    if (!item) return;
    if (item.type === 'market') {
      const marketButton = $(`[data-symbol="${item.symbol}"]`);
      if (marketButton) marketButton.click();
      else showToast('当前市场不可用');
    } else {
      item.run?.();
    }
    closeCommand();
  }

  function moveCommandSelection(delta) {
    if (!commandResults.length) return;
    selectedCommandIndex = (selectedCommandIndex + delta + commandResults.length) % commandResults.length;
    renderCommandResults($('#workspaceCommandInput')?.value || '');
    $(`[data-workspace-result-index="${selectedCommandIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function isEditableTarget(target) {
    return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function handleGlobalKeydown(event) {
    const key = String(event.key || '').toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && key === 'k') {
      event.preventDefault();
      event.stopImmediatePropagation();
      openCommand();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'l') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setLocked(!state.locked);
      return;
    }
    if (event.key === 'Escape') {
      if ($('#workspaceCommandDialog')?.hidden === false) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeCommand();
        return;
      }
      if ($('#workspacePanel')?.hidden === false) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePanel();
        return;
      }
    }
    if ($('#workspaceCommandDialog')?.hidden === false) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveCommandSelection(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveCommandSelection(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        executeCommand();
      }
      return;
    }
    if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey) return;
    if (event.altKey) {
      const timeframe = ({ '1': '1m', '5': '5m', h: '1h', '4': '4h', d: '1d' })[key];
      if (timeframe) {
        event.preventDefault();
        clickControl(`[data-timeframe="${timeframe}"]`);
      }
      return;
    }
    const actions = {
      b: () => activateSide('buy'),
      s: () => activateSide('sell'),
      m: () => clickControl('[data-order-type="market"]'),
      l: () => clickControl('[data-order-type="limit"]'),
      t: () => clickControl('[data-order-type="stop"]'),
    };
    if (actions[key]) {
      event.preventDefault();
      actions[key]();
    }
  }

  function blockLockedTrade(event) {
    if (!state.locked) return;
    const target = event.target.closest?.(TRADE_SUBMIT_SELECTOR);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const id = target.id || target.dataset.createTrailingExit || target.dataset.createScaledExit || 'tradeAction';
    document.documentElement.dataset.lastBlockedTrade = id;
    const status = $('#workspaceLockStatus');
    if (status) status.textContent = `已阻止 ${target.textContent.trim() || '交易操作'}；请先完成二次解锁。`;
    showToast('交易安全锁已阻止本次操作');
  }

  function bind() {
    document.addEventListener('keydown', handleGlobalKeydown, true);
    document.addEventListener('click', blockLockedTrade, true);
    $('#quickSearchButton')?.addEventListener('click', event => {
      event.preventDefault();
      openCommand();
    });
    $('#layoutButton')?.addEventListener('click', event => {
      event.preventDefault();
      togglePanel();
    });
    $('#workspaceStatusChip')?.addEventListener('click', openPanel);
    $('#workspacePanelClose')?.addEventListener('click', closePanel);
    $('#workspacePanelBackdrop')?.addEventListener('click', closePanel);
    $('#workspaceCommandBackdrop')?.addEventListener('click', closeCommand);
    $('#workspaceCommandInput')?.addEventListener('input', event => {
      selectedCommandIndex = 0;
      renderCommandResults(event.target.value);
    });
    $('#workspaceCommandResults')?.addEventListener('mousemove', event => {
      const button = event.target.closest('[data-workspace-result-index]');
      if (!button) return;
      selectedCommandIndex = Number(button.dataset.workspaceResultIndex) || 0;
      $$('.workspace-command-result').forEach((item, index) => {
        item.classList.toggle('selected', index === selectedCommandIndex);
        item.setAttribute('aria-selected', String(index === selectedCommandIndex));
      });
    });
    $('#workspaceCommandResults')?.addEventListener('click', event => {
      const button = event.target.closest('[data-workspace-result-index]');
      if (!button) return;
      executeCommand(Number(button.dataset.workspaceResultIndex));
    });
    $('#workspacePanel')?.addEventListener('click', event => {
      const mode = event.target.closest('[data-workspace-mode-option]')?.dataset.workspaceModeOption;
      if (mode) {
        setMode(mode);
        return;
      }
      const preset = event.target.closest('[data-workspace-preset]')?.dataset.workspacePreset;
      if (preset) {
        applyPreset(preset);
        return;
      }
      if (event.target.closest('#workspaceLockButton')) {
        setLocked(!state.locked);
      }
    });
    window.addEventListener('storage', event => {
      if (event.key !== STORE_KEY) return;
      state = readState();
      unlockPendingUntil = 0;
      renderState();
    });
  }

  function init() {
    mount();
    bind();
    setMode(state.mode, { persist: false, announce: false });
    renderState();
    window.AtlasWorkspace = {
      getState: () => ({ ...state }),
      openCommand,
      closeCommand,
      setMode,
      applyPreset,
      setLocked,
    };
    document.documentElement.dataset.workspaceCenter = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
