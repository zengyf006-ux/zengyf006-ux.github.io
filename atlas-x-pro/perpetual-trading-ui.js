(() => {
  'use strict';

  if (window.__ATLAS_PERPETUAL_UI__) return;
  window.__ATLAS_PERPETUAL_UI__ = true;

  const controller = window.AtlasPerpetual;
  const ledger = window.AtlasPerpetualLedger;
  const risk = window.AtlasPerpetualRisk;
  const funding = window.AtlasPerpetualFunding;
  const marketEngine = window.AtlasMarketDataEngine;
  if (!controller || !ledger || !risk || !funding) throw new Error('Perpetual UI requires perpetual runtime');

  const MODE_KEY = 'atlasX.pro.tradingMode.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
  const formatNumber = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const formatPrice = value => {
    const number = positive(value);
    if (!number) return '--';
    const digits = number >= 1000 ? 1 : number >= 10 ? 2 : 4;
    return formatNumber(number, digits);
  };
  const formatSigned = (value, digits = 2) => {
    const number = finite(value);
    return `${number >= 0 ? '+' : ''}${formatNumber(number, digits)}`;
  };
  const formatTime = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '--';
  const formatDuration = milliseconds => {
    const seconds = Math.max(0, Math.floor(positive(milliseconds) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  };

  let mode = 'spot';
  let selectedOrderType = 'market';
  let selectedMarginMode = 'cross';
  let selectedAccountTab = 'positions';
  let renderQueued = false;
  let countdownTimer = null;
  let unsubMarket = null;

  function preferredMode() {
    const params = new URLSearchParams(location.search);
    if (params.get('perpetual') === '1') return 'perpetual';
    return localStorage.getItem(MODE_KEY) === 'perpetual' ? 'perpetual' : 'spot';
  }

  function modeSwitchMarkup(scope = '') {
    return `<div class="trading-mode-switch ${scope}" role="tablist" aria-label="交易模式">
      <button type="button" data-trading-mode="spot">现货</button>
      <button type="button" class="perpetual" data-trading-mode="perpetual">永续</button>
    </div>`;
  }

  function marketContextMarkup() {
    return `<section class="perp-market-context" id="perpMarketContext" aria-label="合约市场状态">
      <div><span>标记价格</span><b id="perpMarkPrice">--</b></div>
      <div><span>指数价格</span><b id="perpIndexPrice">--</b></div>
      <div class="funding"><span>资金费率</span><b id="perpFundingRate">--</b></div>
      <div><span>下次结算</span><b id="perpFundingCountdown">--</b></div>
    </section>`;
  }

  function ticketMarkup() {
    return `<section class="order-ticket panel perpetual-workspace" id="perpetualWorkspace" aria-label="模拟永续下单">
      <header class="perp-ticket-header">
        <div class="perp-ticket-title">
          <div><strong>USDT 永续</strong><small>标记价风控 · 独立合约账本</small></div>
          <span class="perp-sim-label" data-perpetual-sim-label>模拟合约</span>
        </div>
        <div class="perp-context-grid">
          <select id="perpSymbol" aria-label="合约交易对">
            <option value="BTC-USDT-SWAP">BTC-USDT-SWAP</option>
            <option value="ETH-USDT-SWAP">ETH-USDT-SWAP</option>
          </select>
          <select id="perpLeverage" aria-label="杠杆">
            ${[1,2,3,5,10,20,25,50,75,100,125].map(value => `<option value="${value}" ${value === 10 ? 'selected' : ''}>${value}x</option>`).join('')}
          </select>
        </div>
        <div class="perp-segment">
          <button class="active" type="button" data-perp-margin-mode="cross">全仓</button>
          <button type="button" data-perp-margin-mode="isolated">逐仓</button>
        </div>
      </header>
      <div class="perp-ticket-scroll">
        <nav class="perp-order-types" aria-label="合约委托类型">
          <button class="active" type="button" data-perp-order-type="market">市价</button>
          <button type="button" data-perp-order-type="limit">限价</button>
          <button type="button" data-perp-order-type="stop_market">止损市价</button>
          <button type="button" data-perp-order-type="stop_limit">止损限价</button>
        </nav>
        <label class="perp-field perp-price-field" hidden>
          <span>委托价格</span><input id="perpPrice" inputmode="decimal" autocomplete="off" placeholder="0.00"><b>USDT</b>
        </label>
        <label class="perp-field perp-trigger-field" hidden>
          <span>触发价格</span><input id="perpTriggerPrice" inputmode="decimal" autocomplete="off" placeholder="0.00"><b>USDT</b>
        </label>
        <label class="perp-field">
          <span>数量</span><input id="perpQuantity" inputmode="decimal" autocomplete="off" placeholder="0.000"><b id="perpQuantityUnit">BTC</b>
        </label>
        <label class="perp-field">
          <span>金额</span><input id="perpNotional" inputmode="decimal" autocomplete="off" placeholder="0.00"><b>USDT</b>
        </label>
        <div class="perp-quick-percent">
          <button type="button" data-perp-percent="25">25%</button><button type="button" data-perp-percent="50">50%</button>
          <button type="button" data-perp-percent="75">75%</button><button type="button" data-perp-percent="100">100%</button>
        </div>
        <div class="perp-advanced">
          <label><input id="perpReduceOnly" type="checkbox">只减仓</label>
          <label><input id="perpPostOnly" type="checkbox">Post Only</label>
          <label><input id="perpAttachProtection" type="checkbox">附加 TP/SL</label>
        </div>
        <div class="perp-estimate" id="perpEstimate">
          <div><span>预计保证金</span><b id="perpEstimatedMargin">--</b></div>
          <div><span>预计手续费</span><b id="perpEstimatedFee">--</b></div>
          <div><span>预计均价</span><b id="perpEstimatedAverage">--</b></div>
          <div class="risk"><span>预估强平价</span><b id="perpEstimatedLiquidation">--</b></div>
        </div>
        <div class="perp-submit-row">
          <button class="long" type="button" data-perp-submit="long">买入做多</button>
          <button class="short" type="button" data-perp-submit="short">卖出做空</button>
        </div>
        <div class="perp-form-status" id="perpFormStatus" role="status">使用标记价格计算保证金与模拟强平。</div>
        <div class="perp-boundary-note"><i></i><span>仅为模拟 USDT 永续合约，不处理真实资产、充值、提现、密钥或交易所账户。</span></div>
      </div>
    </section>`;
  }

  function accountMarkup() {
    return `<section class="account-workspace panel" id="perpAccountWorkspace" data-mobile-panel="account" aria-label="合约账户">
      <header class="perp-account-head">
        <nav class="perp-account-tabs" aria-label="合约账户视图">
          <button class="active" type="button" data-perp-account-tab="positions">合约持仓</button>
          <button type="button" data-perp-account-tab="orders">合约委托</button>
          <button type="button" data-perp-account-tab="fills">成交</button>
          <button type="button" data-perp-account-tab="funding">资金费</button>
          <button type="button" data-perp-account-tab="liquidations">强平记录</button>
          <button type="button" data-perp-account-tab="audit">合约审计</button>
        </nav>
        <div class="perp-account-metrics">
          <span>合约权益 <b id="perpAccountEquity">--</b></span>
          <span>可用保证金 <b id="perpAvailableMargin">--</b></span>
          <span>未实现盈亏 <b id="perpUnrealizedPnl">--</b></span>
        </div>
      </header>
      ${['positions','orders','fills','funding','liquidations','audit'].map((tab, index) => `<div class="perp-account-view ${index === 0 ? 'active' : ''}" data-perp-account-view="${tab}"></div>`).join('')}
    </section>`;
  }

  function mount() {
    const pairIdentity = $('.pair-identity');
    if (pairIdentity && !pairIdentity.querySelector('.trading-mode-switch')) {
      pairIdentity.insertAdjacentHTML('beforeend', modeSwitchMarkup('desktop-mode-switch'));
    }
    const mobileHead = $('.mobile-market-head');
    if (mobileHead && !mobileHead.querySelector('.trading-mode-switch')) {
      mobileHead.insertAdjacentHTML('beforeend', modeSwitchMarkup('mobile-mode-switch'));
    }
    const overview = $('.market-overview');
    if (overview && !$('#perpMarketContext')) overview.insertAdjacentHTML('beforeend', marketContextMarkup());
    const ticket = $('#orderTicket');
    if (ticket && !$('#perpetualWorkspace')) ticket.insertAdjacentHTML('beforebegin', ticketMarkup());
    const account = $('#accountWorkspace');
    if (account && !$('#perpAccountWorkspace')) account.insertAdjacentHTML('afterend', accountMarkup());
  }

  function setMode(nextMode) {
    mode = nextMode === 'perpetual' ? 'perpetual' : 'spot';
    localStorage.setItem(MODE_KEY, mode);
    document.body.classList.toggle('perpetual-mode', mode === 'perpetual');
    document.documentElement.dataset.tradingMode = mode;
    $$('[data-trading-mode]').forEach(button => button.classList.toggle('active', button.dataset.tradingMode === mode));
    const activeName = $('#activeMarketName');
    const mobileSub = $('#mobilePairButton small');
    if (mode === 'perpetual') {
      if (activeName) activeName.textContent = 'USDT 永续 · 模拟合约';
      if (mobileSub) mobileSub.textContent = '永续 · 模拟';
    } else {
      if (activeName) activeName.textContent = 'Bitcoin · 现货';
      if (mobileSub) mobileSub.textContent = '现货 · 模拟';
    }
    render();
  }

  function setStatus(message, level = '') {
    const status = $('#perpFormStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `perp-form-status ${level}`.trim();
  }

  function currentInputs() {
    const symbol = $('#perpSymbol')?.value || 'BTC-USDT-SWAP';
    const market = controller.setActiveContract(symbol).market;
    const leverage = positive($('#perpLeverage')?.value, 10);
    const quantity = positive($('#perpQuantity')?.value);
    const notional = positive($('#perpNotional')?.value);
    const markPrice = positive(market.markPrice || market.lastPrice);
    const effectiveQuantity = quantity || (markPrice > 0 ? notional / markPrice : 0);
    return { symbol, market, leverage, quantity: effectiveQuantity, markPrice };
  }

  function updateEstimate(source = '') {
    const { symbol, market, leverage, quantity, markPrice } = currentInputs();
    const notional = quantity * markPrice;
    const margin = leverage > 0 ? notional / leverage : 0;
    const fee = notional * ($('#perpPostOnly')?.checked ? 0.0002 : 0.0005);
    const side = source === 'short' ? 'short' : 'long';
    const estimate = risk.calculatePosition({
      symbol,
      side,
      quantity,
      entryPrice: markPrice,
      markPrice,
      leverage,
      marginMode: selectedMarginMode,
      isolatedMargin: selectedMarginMode === 'isolated' ? margin : 0,
      crossMarginAllocation: selectedMarginMode === 'cross' ? margin : 0,
    });
    if ($('#perpEstimatedMargin')) $('#perpEstimatedMargin').textContent = quantity > 0 ? `${formatNumber(margin, 4)} USDT` : '--';
    if ($('#perpEstimatedFee')) $('#perpEstimatedFee').textContent = quantity > 0 ? `${formatNumber(fee, 4)} USDT` : '--';
    if ($('#perpEstimatedAverage')) $('#perpEstimatedAverage').textContent = quantity > 0 ? formatPrice(markPrice) : '--';
    if ($('#perpEstimatedLiquidation')) $('#perpEstimatedLiquidation').textContent = quantity > 0 ? formatPrice(estimate.liquidationPrice) : '--';
    return { notional, margin, fee, estimate };
  }

  function renderMarket(snapshot) {
    const market = snapshot.market;
    const mark = $('#perpMarkPrice');
    const index = $('#perpIndexPrice');
    const rate = $('#perpFundingRate');
    const countdown = $('#perpFundingCountdown');
    if (mark) mark.textContent = formatPrice(market.markPrice);
    if (index) index.textContent = formatPrice(market.indexPrice);
    if (rate) rate.textContent = `${formatSigned(market.fundingRate * 100, 4)}%`;
    if (countdown) countdown.textContent = formatDuration(funding.getCountdown(Date.now(), market.symbol));
    const quantityUnit = $('#perpQuantityUnit');
    if (quantityUnit) quantityUnit.textContent = market.symbol.split('-')[0];
    const symbolSelect = $('#perpSymbol');
    if (symbolSelect && symbolSelect.value !== market.symbol) symbolSelect.value = market.symbol;
    const priceInput = $('#perpPrice');
    const triggerInput = $('#perpTriggerPrice');
    if (priceInput && !priceInput.value) priceInput.placeholder = formatPrice(market.markPrice);
    if (triggerInput && !triggerInput.value) triggerInput.placeholder = formatPrice(market.markPrice);
  }

  function emptyMarkup(title, description) {
    return `<div class="perp-empty"><b>${escapeHtml(title)}</b><small>${escapeHtml(description)}</small></div>`;
  }

  function renderPositions(snapshot) {
    const view = $('[data-perp-account-view="positions"]');
    if (!view) return;
    if (!snapshot.positions.length) {
      view.innerHTML = emptyMarkup('暂无合约仓位', '买入做多或卖出做空后，保证金与强平风险会显示在这里。');
      return;
    }
    view.innerHTML = `<div class="perp-table-head"><span>合约</span><span>方向</span><span>数量</span><span>开仓价</span><span>标记价</span><span>未实现盈亏</span><span>强平价</span><span>操作</span></div>${snapshot.positions.map(position => `<article class="perp-table-row" data-perp-position-id="${escapeHtml(position.id)}">
      <span>${escapeHtml(position.symbol)}</span><span class="${position.side}">${position.side === 'long' ? '多' : '空'} · ${position.leverage}x</span>
      <span>${formatNumber(position.quantity, 4)}</span><span>${formatPrice(position.entryPrice)}</span><span>${formatPrice(position.markPrice)}</span>
      <span class="${position.unrealizedPnl >= 0 ? 'long' : 'short'}">${formatSigned(position.unrealizedPnl, 4)}</span><span>${formatPrice(position.liquidationPrice)}</span>
      <button type="button" data-perp-close-position="${escapeHtml(position.id)}">市价平仓</button>
    </article>`).join('')}`;
  }

  function renderOrders(snapshot) {
    const view = $('[data-perp-account-view="orders"]');
    if (!view) return;
    if (!snapshot.orders.length) { view.innerHTML = emptyMarkup('暂无合约委托', '限价单、条件单和止损单会显示在这里。'); return; }
    view.innerHTML = `<div class="perp-event-list">${snapshot.orders.map(order => `<article class="perp-event"><i></i><div><strong>${escapeHtml(order.symbol)} · ${escapeHtml(order.type)}</strong><small>${order.side === 'buy' ? '买入' : '卖出'} ${formatNumber(order.quantity, 4)} · ${escapeHtml(order.status)}</small></div><button type="button" data-perp-cancel-order="${escapeHtml(order.id)}">撤单</button></article>`).join('')}</div>`;
  }

  function renderFills(snapshot) {
    const view = $('[data-perp-account-view="fills"]');
    if (!view) return;
    if (!snapshot.fills.length) { view.innerHTML = emptyMarkup('暂无合约成交', '成交均价、手续费、滑点和已实现盈亏会显示在这里。'); return; }
    view.innerHTML = `<div class="perp-event-list">${snapshot.fills.map(fill => `<article class="perp-event"><i></i><div><strong>${escapeHtml(fill.symbol)} ${fill.side === 'buy' ? '买入' : '卖出'} @ ${formatPrice(fill.price)}</strong><small>${formatNumber(fill.quantity, 4)} · 手续费 ${formatNumber(fill.fee, 4)} · PnL ${formatSigned(fill.realizedPnl, 4)}</small></div><time>${formatTime(fill.createdAt)}</time></article>`).join('')}</div>`;
  }

  function renderFunding(snapshot) {
    const view = $('[data-perp-account-view="funding"]');
    if (!view) return;
    if (!snapshot.fundingEvents.length) { view.innerHTML = emptyMarkup('暂无资金费结算', '每个结算窗口只记录一次，离线补结算会明确标注。'); return; }
    view.innerHTML = `<div class="perp-event-list">${snapshot.fundingEvents.map(event => `<article class="perp-event funding"><i></i><div><strong>${escapeHtml(event.symbol)} · ${event.side === 'long' ? '多头' : '空头'}</strong><small>费率 ${formatSigned(event.fundingRate * 100, 4)}% · ${event.amount >= 0 ? '支付' : '收取'} ${formatNumber(Math.abs(event.amount), 6)} USDT${event.offlineCatchUp ? ' · 离线补结算' : ''}</small></div><time>${formatTime(event.settledAt)}</time></article>`).join('')}</div>`;
  }

  function renderLiquidations(snapshot) {
    const view = $('[data-perp-account-view="liquidations"]');
    if (!view) return;
    if (!snapshot.liquidationEvents.length) { view.innerHTML = emptyMarkup('暂无模拟强平', '标记价触及风险阈值后，强平事件会完整记录。'); return; }
    view.innerHTML = `<div class="perp-event-list">${snapshot.liquidationEvents.map(event => `<article class="perp-event liquidation"><i></i><div><strong>${escapeHtml(event.symbol)} 模拟强平</strong><small>${event.side === 'long' ? '多头' : '空头'} ${formatNumber(event.quantity, 4)} @ ${formatPrice(event.markPrice)} · 费用 ${formatNumber(event.liquidationFee, 4)}</small></div><time>${formatTime(event.createdAt)}</time></article>`).join('')}</div>`;
  }

  function renderAudit(snapshot) {
    const view = $('[data-perp-account-view="audit"]');
    if (!view) return;
    if (!snapshot.auditEvents.length) { view.innerHTML = emptyMarkup('暂无合约审计事件', '杠杆、保证金、委托、成交、资金费与强平都会记录。'); return; }
    view.innerHTML = `<div class="perp-event-list">${snapshot.auditEvents.map(event => `<article class="perp-event ${event.type === 'liquidation' ? 'liquidation' : event.type === 'funding' ? 'funding' : ''}"><i></i><div><strong>${escapeHtml(event.type)} · ${escapeHtml(event.status || '')}</strong><small>${escapeHtml(event.message || event.symbol || '')}</small></div><time>${formatTime(event.createdAt)}</time></article>`).join('')}</div>`;
  }

  function renderAccount(snapshot) {
    const account = snapshot.account;
    if ($('#perpAccountEquity')) $('#perpAccountEquity').textContent = `${formatNumber(account.equity, 2)} USDT`;
    if ($('#perpAvailableMargin')) $('#perpAvailableMargin').textContent = `${formatNumber(account.availableMargin, 2)} USDT`;
    if ($('#perpUnrealizedPnl')) $('#perpUnrealizedPnl').textContent = `${formatSigned(account.unrealizedPnl, 2)} USDT`;
    renderPositions(snapshot);
    renderOrders(snapshot);
    renderFills(snapshot);
    renderFunding(snapshot);
    renderLiquidations(snapshot);
    renderAudit(snapshot);
    $$('[data-perp-account-tab]').forEach(button => button.classList.toggle('active', button.dataset.perpAccountTab === selectedAccountTab));
    $$('[data-perp-account-view]').forEach(view => view.classList.toggle('active', view.dataset.perpAccountView === selectedAccountTab));
  }

  function render() {
    renderQueued = false;
    if (!$('#perpetualWorkspace')) return;
    const snapshot = controller.getSnapshot();
    selectedMarginMode = snapshot.preferences.marginModeBySymbol[snapshot.market.symbol] || selectedMarginMode || 'cross';
    renderMarket(snapshot);
    renderAccount(snapshot);
    $$('[data-perp-margin-mode]').forEach(button => button.classList.toggle('active', button.dataset.perpMarginMode === selectedMarginMode));
    const selectedLeverage = snapshot.preferences.leverageBySymbol[snapshot.market.symbol] || positive($('#perpLeverage')?.value, 10);
    if ($('#perpLeverage')) $('#perpLeverage').value = String(selectedLeverage);
    updateEstimate();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  async function changeSymbol(symbol) {
    controller.setActiveContract(symbol);
    const spot = symbol.replace('-USDT-SWAP', 'USDT');
    if (marketEngine?.getState?.().symbol !== spot) {
      try { await marketEngine.switchSession({ symbol: spot, interval: marketEngine.getState().interval || '1h' }); }
      catch {}
    }
    selectedMarginMode = ledger.getState().preferences.marginModeBySymbol[symbol] || 'cross';
    scheduleRender();
  }

  function orderInput(side) {
    const symbol = $('#perpSymbol')?.value || 'BTC-USDT-SWAP';
    const quantity = positive($('#perpQuantity')?.value) || (() => {
      const mark = positive(controller.getSnapshot().market.markPrice);
      return mark > 0 ? positive($('#perpNotional')?.value) / mark : 0;
    })();
    const postOnly = Boolean($('#perpPostOnly')?.checked);
    return {
      symbol,
      side: side === 'short' ? 'sell' : 'buy',
      positionSide: side === 'short' ? 'short' : 'long',
      type: selectedOrderType,
      quantity,
      price: positive($('#perpPrice')?.value) || undefined,
      triggerPrice: positive($('#perpTriggerPrice')?.value) || undefined,
      triggerDirection: side === 'short' ? 'below' : 'above',
      marginMode: selectedMarginMode,
      leverage: positive($('#perpLeverage')?.value, 10),
      reduceOnly: Boolean($('#perpReduceOnly')?.checked),
      timeInForce: postOnly ? 'POST_ONLY' : 'GTC',
    };
  }

  async function submit(side) {
    updateEstimate(side);
    const input = orderInput(side);
    if (!(input.quantity > 0)) { setStatus('请输入有效合约数量或金额。', 'negative'); return; }
    setStatus('正在校验保证金、标记价和订单参数…');
    const result = await controller.submitOrder(input);
    if (!result.ok) {
      setStatus(result.message || result.errorCode || '委托失败', 'negative');
      return;
    }
    setStatus(result.status === 'open' || result.status === 'trigger_wait' ? '合约委托已进入等待队列。' : '模拟合约成交完成。', 'positive');
    scheduleRender();
  }

  function bind() {
    document.addEventListener('click', async event => {
      const modeButton = event.target.closest?.('[data-trading-mode]');
      if (modeButton) { setMode(modeButton.dataset.tradingMode); return; }
      const marginButton = event.target.closest?.('[data-perp-margin-mode]');
      if (marginButton) {
        const symbol = $('#perpSymbol')?.value || 'BTC-USDT-SWAP';
        const result = await controller.setMarginMode(symbol, marginButton.dataset.perpMarginMode);
        if (!result.ok) setStatus(result.message || result.errorCode, 'negative');
        else { selectedMarginMode = result.marginMode; setStatus(result.marginMode === 'cross' ? '已切换为全仓。' : '已切换为逐仓。', 'positive'); }
        scheduleRender(); return;
      }
      const orderTypeButton = event.target.closest?.('[data-perp-order-type]');
      if (orderTypeButton) {
        selectedOrderType = orderTypeButton.dataset.perpOrderType;
        $$('[data-perp-order-type]').forEach(button => button.classList.toggle('active', button === orderTypeButton));
        const limit = selectedOrderType === 'limit' || selectedOrderType === 'stop_limit';
        const trigger = selectedOrderType.startsWith('stop_') || selectedOrderType.startsWith('trigger_');
        $('.perp-price-field').hidden = !limit;
        $('.perp-trigger-field').hidden = !trigger;
        updateEstimate(); return;
      }
      const percentButton = event.target.closest?.('[data-perp-percent]');
      if (percentButton) {
        const snapshot = controller.getSnapshot();
        const percentage = positive(percentButton.dataset.perpPercent) / 100;
        const leverage = positive($('#perpLeverage')?.value, 10);
        const mark = positive(snapshot.market.markPrice);
        const notional = Math.max(0, snapshot.account.availableMargin) * leverage * percentage;
        if ($('#perpNotional')) $('#perpNotional').value = notional > 0 ? notional.toFixed(2) : '';
        if ($('#perpQuantity')) $('#perpQuantity').value = mark > 0 ? (notional / mark).toFixed(6) : '';
        updateEstimate(); return;
      }
      const submitButton = event.target.closest?.('[data-perp-submit]');
      if (submitButton) { await submit(submitButton.dataset.perpSubmit); return; }
      const accountTab = event.target.closest?.('[data-perp-account-tab]');
      if (accountTab) { selectedAccountTab = accountTab.dataset.perpAccountTab; scheduleRender(); return; }
      const closeButton = event.target.closest?.('[data-perp-close-position]');
      if (closeButton) {
        const snapshot = controller.getSnapshot();
        const position = snapshot.positions.find(item => item.id === closeButton.dataset.perpClosePosition);
        if (position) {
          const result = await controller.closePosition({ symbol: position.symbol, positionSide: position.side, quantity: position.quantity });
          setStatus(result.ok ? '仓位已按市价全部平仓。' : result.message || result.errorCode, result.ok ? 'positive' : 'negative');
          scheduleRender();
        }
        return;
      }
      const cancelButton = event.target.closest?.('[data-perp-cancel-order]');
      if (cancelButton) {
        const result = await window.AtlasPerpetualOrders.cancelOrder(cancelButton.dataset.perpCancelOrder);
        setStatus(result.ok ? '委托已撤销。' : result.errorCode, result.ok ? 'positive' : 'negative');
        scheduleRender();
      }
    });

    document.addEventListener('change', async event => {
      if (event.target.matches('#perpSymbol')) { await changeSymbol(event.target.value); return; }
      if (event.target.matches('#perpLeverage')) {
        const result = await controller.setLeverage($('#perpSymbol').value, event.target.value);
        if (!result.ok) { event.target.value = String(result.maxLeverage || 10); setStatus(result.message || result.errorCode, 'negative'); }
        else setStatus(`杠杆已调整为 ${result.leverage}x。`, 'positive');
        updateEstimate();
      }
      if (event.target.matches('#perpPostOnly,#perpReduceOnly')) updateEstimate();
    });

    document.addEventListener('input', event => {
      if (event.target.matches('#perpQuantity')) {
        const mark = positive(controller.getSnapshot().market.markPrice);
        if ($('#perpNotional')) $('#perpNotional').value = mark > 0 && positive(event.target.value) > 0 ? (positive(event.target.value) * mark).toFixed(2) : '';
        updateEstimate();
      } else if (event.target.matches('#perpNotional')) {
        const mark = positive(controller.getSnapshot().market.markPrice);
        if ($('#perpQuantity')) $('#perpQuantity').value = mark > 0 && positive(event.target.value) > 0 ? (positive(event.target.value) / mark).toFixed(6) : '';
        updateEstimate();
      } else if (event.target.matches('#perpPrice,#perpTriggerPrice')) updateEstimate();
    });

    window.addEventListener('atlas:perpetual-ledger', scheduleRender);
    window.addEventListener('atlas:market-state', scheduleRender);
    if (marketEngine?.subscribe) unsubMarket = marketEngine.subscribe(scheduleRender);
  }

  function init() {
    mount();
    bind();
    mode = preferredMode();
    setMode(mode);
    countdownTimer = setInterval(() => {
      const countdown = $('#perpFundingCountdown');
      if (countdown && mode === 'perpetual') countdown.textContent = formatDuration(funding.getCountdown(Date.now(), $('#perpSymbol')?.value));
    }, 1000);
    window.addEventListener('pagehide', () => {
      clearInterval(countdownTimer);
      unsubMarket?.();
    }, { once: true });
    document.documentElement.dataset.perpetualUi = 'ready';
  }

  init();
})();
