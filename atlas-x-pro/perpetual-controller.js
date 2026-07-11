(() => {
  'use strict';

  if (window.__ATLAS_PERPETUAL_CONTROLLER__) return;
  window.__ATLAS_PERPETUAL_CONTROLLER__ = true;

  const ledger = window.AtlasPerpetualLedger;
  const risk = window.AtlasPerpetualRisk;
  const orders = window.AtlasPerpetualOrders;
  const funding = window.AtlasPerpetualFunding;
  const marketEngine = window.AtlasMarketDataEngine;
  if (!ledger || !risk || !orders || !funding) {
    throw new Error('Perpetual controller requires ledger, risk, order and funding engines');
  }

  const EPSILON = 1e-9;
  const LIQUIDATION_FEE_RATE = 0.001;
  let activeContract = 'BTC-USDT-SWAP';
  let pendingEvaluation = Promise.resolve();
  let unsubscribeMarket = null;

  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
  const contractSymbol = value => {
    const raw = String(value || activeContract).toUpperCase();
    if (raw.endsWith('-USDT-SWAP')) return raw;
    const compact = raw.replace(/[^A-Z0-9]/g, '');
    const base = compact.endsWith('USDT') ? compact.slice(0, -4) : compact || 'BTC';
    return `${base}-USDT-SWAP`;
  };
  const spotSymbol = value => contractSymbol(value).replace('-USDT-SWAP', 'USDT');
  const clone = value => JSON.parse(JSON.stringify(value));

  function marketFor(symbol = activeContract) {
    const normalized = contractSymbol(symbol);
    const state = marketEngine?.getState?.() || {};
    const context = funding.getMarketContext(normalized);
    const sameSymbol = String(state.symbol || '').toUpperCase() === spotSymbol(normalized);
    const bids = sameSymbol ? (Array.isArray(state.book?.bids) ? state.book.bids : []) : [];
    const asks = sameSymbol ? (Array.isArray(state.book?.asks) ? state.book.asks : []) : [];
    return {
      symbol: normalized,
      lastPrice: positive(context.lastPrice || state.ticker?.price),
      indexPrice: positive(context.indexPrice || state.ticker?.price),
      markPrice: positive(context.markPrice || state.ticker?.price),
      fundingRate: finite(context.fundingRate),
      nextFundingAt: finite(context.nextFundingAt),
      freshness: context.freshness || 'offline',
      source: context.source || 'derived',
      updatedAt: finite(context.updatedAt || state.lastReceivedAt, Date.now()),
      bids,
      asks,
    };
  }

  function accountSnapshot(state, market) {
    const positions = state.positions.map(position => {
      const context = position.symbol === market.symbol ? market : funding.getMarketContext(position.symbol);
      return risk.calculatePosition({
        ...position,
        markPrice: positive(context.markPrice, position.markPrice || position.entryPrice),
      });
    });
    return risk.calculateAccount({ account: state.account, positions });
  }

  function getSnapshot() {
    const state = ledger.getState();
    const market = marketFor(activeContract);
    const account = accountSnapshot(state, market);
    return {
      activeContract,
      market,
      account,
      positions: account.positions,
      orders: clone(state.orders),
      fills: clone(state.fills),
      fundingEvents: clone(state.fundingEvents),
      liquidationEvents: clone(state.liquidationEvents),
      auditEvents: clone(state.auditEvents),
      preferences: clone(state.preferences),
    };
  }

  async function setLeverage(symbol, requested) {
    const normalized = contractSymbol(symbol);
    const state = ledger.getState();
    const currentPosition = state.positions.find(position => position.symbol === normalized);
    const context = marketFor(normalized);
    const notional = currentPosition
      ? positive(currentPosition.quantity) * positive(context.markPrice, currentPosition.entryPrice)
      : 0;
    const validation = risk.validateLeverage(normalized, notional, requested);
    if (!validation.ok) {
      return { ok: false, errorCode: validation.errorCode, maxLeverage: validation.maxLeverage, message: `当前风险档位最高 ${validation.maxLeverage}x` };
    }
    await ledger.transact('perpetual-set-leverage', draft => {
      draft.preferences.leverageBySymbol[normalized] = validation.leverage;
      draft.positions.filter(position => position.symbol === normalized).forEach(position => {
        position.leverage = validation.leverage;
        const calculated = risk.calculatePosition({ ...position, markPrice: positive(context.markPrice, position.markPrice) });
        Object.assign(position, calculated, { updatedAt: Date.now() });
      });
      draft.auditEvents.unshift({
        id: ledger.nextId('perp-audit'), type: 'leverage', symbol: normalized,
        status: 'updated', message: `杠杆调整为 ${validation.leverage}x`, createdAt: Date.now(),
      });
    });
    return { ok: true, leverage: validation.leverage, maxLeverage: validation.maxLeverage };
  }

  async function setMarginMode(symbol, mode) {
    const normalized = contractSymbol(symbol);
    const marginMode = mode === 'cross' ? 'cross' : mode === 'isolated' ? 'isolated' : null;
    if (!marginMode) return { ok: false, errorCode: 'INVALID_MARGIN_MODE', message: '保证金模式无效' };
    const state = ledger.getState();
    if (state.positions.some(position => position.symbol === normalized) || state.orders.some(order => order.symbol === normalized)) {
      return { ok: false, errorCode: 'ACTIVE_EXPOSURE', message: '存在仓位或委托时不可切换保证金模式' };
    }
    await ledger.transact('perpetual-set-margin-mode', draft => {
      draft.preferences.marginModeBySymbol[normalized] = marginMode;
      draft.auditEvents.unshift({
        id: ledger.nextId('perp-audit'), type: 'margin_mode', symbol: normalized,
        status: 'updated', message: marginMode === 'cross' ? '切换为全仓' : '切换为逐仓', createdAt: Date.now(),
      });
    });
    return { ok: true, marginMode };
  }

  async function setPositionMode(mode) {
    const positionMode = mode === 'hedge' ? 'hedge' : mode === 'one_way' ? 'one_way' : null;
    if (!positionMode) return { ok: false, errorCode: 'INVALID_POSITION_MODE' };
    const state = ledger.getState();
    if (state.positions.length || state.orders.length) return { ok: false, errorCode: 'ACTIVE_EXPOSURE' };
    await ledger.transact('perpetual-set-position-mode', draft => {
      draft.account.positionMode = positionMode;
      draft.auditEvents.unshift({
        id: ledger.nextId('perp-audit'), type: 'position_mode', status: 'updated',
        message: positionMode === 'hedge' ? '切换为双向持仓' : '切换为单向持仓', createdAt: Date.now(),
      });
    });
    return { ok: true, positionMode };
  }

  async function submitOrder(input = {}) {
    const symbol = contractSymbol(input.symbol || activeContract);
    activeContract = symbol;
    const state = ledger.getState();
    const leverage = positive(input.leverage, state.preferences.leverageBySymbol[symbol] || 10);
    const marginMode = input.marginMode || state.preferences.marginModeBySymbol[symbol] || 'cross';
    const market = marketFor(symbol);
    return orders.submitOrder({ ...input, symbol, leverage, marginMode }, market);
  }

  async function closePosition(input = {}) {
    const symbol = contractSymbol(input.symbol || activeContract);
    return orders.closePosition({ ...input, symbol }, marketFor(symbol));
  }

  async function setPositionProtection(positionId, protection = {}) {
    let result = { ok: false, errorCode: 'POSITION_NOT_FOUND' };
    await ledger.transact('perpetual-set-protection', draft => {
      const position = draft.positions.find(item => item.id === positionId);
      if (!position) return;
      const takeProfit = positive(protection.takeProfit) || null;
      const stopLoss = positive(protection.stopLoss) || null;
      const trailingPercent = positive(protection.trailingPercent) || null;
      if (position.side === 'long' && takeProfit && takeProfit <= position.entryPrice) {
        result = { ok: false, errorCode: 'INVALID_TAKE_PROFIT' }; return;
      }
      if (position.side === 'long' && stopLoss && stopLoss >= position.entryPrice) {
        result = { ok: false, errorCode: 'INVALID_STOP_LOSS' }; return;
      }
      if (position.side === 'short' && takeProfit && takeProfit >= position.entryPrice) {
        result = { ok: false, errorCode: 'INVALID_TAKE_PROFIT' }; return;
      }
      if (position.side === 'short' && stopLoss && stopLoss <= position.entryPrice) {
        result = { ok: false, errorCode: 'INVALID_STOP_LOSS' }; return;
      }
      position.takeProfit = takeProfit;
      position.stopLoss = stopLoss;
      position.trailingStop = trailingPercent ? {
        percent: trailingPercent,
        peakPrice: positive(position.markPrice, position.entryPrice),
        triggerPrice: null,
      } : null;
      position.updatedAt = Date.now();
      draft.auditEvents.unshift({
        id: ledger.nextId('perp-audit'), type: 'protection', symbol: position.symbol,
        positionId: position.id, status: 'updated', message: '仓位止盈止损已更新', createdAt: Date.now(),
      });
      result = { ok: true, positionId };
    });
    return result;
  }

  function protectionTrigger(position, markPrice) {
    if (position.side === 'long') {
      if (positive(position.takeProfit) && markPrice >= position.takeProfit) return 'take_profit';
      if (positive(position.stopLoss) && markPrice <= position.stopLoss) return 'stop_loss';
    } else {
      if (positive(position.takeProfit) && markPrice <= position.takeProfit) return 'take_profit';
      if (positive(position.stopLoss) && markPrice >= position.stopLoss) return 'stop_loss';
    }
    const trailing = position.trailingStop;
    if (!trailing || !(positive(trailing.percent) > 0)) return null;
    const percent = trailing.percent / 100;
    if (position.side === 'long') {
      trailing.peakPrice = Math.max(positive(trailing.peakPrice, markPrice), markPrice);
      trailing.triggerPrice = trailing.peakPrice * (1 - percent);
      if (markPrice <= trailing.triggerPrice) return 'trailing_stop';
    } else {
      trailing.peakPrice = Math.min(positive(trailing.peakPrice, markPrice), markPrice);
      trailing.triggerPrice = trailing.peakPrice * (1 + percent);
      if (markPrice >= trailing.triggerPrice) return 'trailing_stop';
    }
    return null;
  }

  async function liquidate(position, market, reason = 'margin') {
    const markPrice = positive(market.markPrice, position.markPrice || position.entryPrice);
    const quantity = positive(position.quantity);
    if (!(markPrice > 0) || !(quantity > 0)) return { ok: false, errorCode: 'INVALID_LIQUIDATION_CONTEXT' };
    let event = null;
    await ledger.transact('perpetual-liquidation', draft => {
      const current = draft.positions.find(item => item.id === position.id);
      if (!current) return;
      const realizedPnl = risk.realizedPnl({ side: current.side, quantity, entryPrice: current.entryPrice, exitPrice: markPrice });
      const liquidationFee = quantity * markPrice * LIQUIDATION_FEE_RATE;
      draft.account.realizedPnl = finite(draft.account.realizedPnl) + realizedPnl;
      draft.account.feesPaid = positive(draft.account.feesPaid) + liquidationFee;
      draft.positions = draft.positions.filter(item => item.id !== current.id);
      draft.orders = draft.orders.filter(order => !(order.symbol === current.symbol && order.positionSide === current.side));
      const fill = {
        id: ledger.nextId('perp-fill'), orderId: null, symbol: current.symbol,
        side: current.side === 'long' ? 'sell' : 'buy', positionSide: current.side,
        quantity, price: markPrice, referencePrice: markPrice, fee: liquidationFee,
        liquidity: 'taker', source: 'liquidation', realizedPnl, slippageBps: 0, createdAt: Date.now(),
      };
      draft.fills.unshift(fill);
      event = {
        id: ledger.nextId('liquidation'), positionId: current.id, symbol: current.symbol,
        side: current.side, marginMode: current.marginMode, quantity, entryPrice: current.entryPrice,
        liquidationPrice: current.liquidationPrice, markPrice, realizedPnl, liquidationFee,
        reason, createdAt: Date.now(),
      };
      draft.liquidationEvents.unshift(event);
      draft.auditEvents.unshift({
        id: ledger.nextId('perp-audit'), type: 'liquidation', symbol: current.symbol,
        positionId: current.id, status: 'completed', message: `模拟强平 @ ${markPrice}`, createdAt: Date.now(),
      });
      draft.fills = draft.fills.slice(0, 500);
      draft.liquidationEvents = draft.liquidationEvents.slice(0, 120);
      draft.auditEvents = draft.auditEvents.slice(0, 500);
    });
    return event ? { ok: true, event } : { ok: false, errorCode: 'POSITION_NOT_FOUND' };
  }

  async function evaluateNow(options = {}) {
    const state = ledger.getState();
    const triggers = [];

    for (const storedPosition of state.positions) {
      const market = marketFor(storedPosition.symbol);
      const calculated = risk.calculatePosition({
        ...storedPosition,
        markPrice: positive(market.markPrice, storedPosition.markPrice || storedPosition.entryPrice),
      });
      const markPrice = calculated.markPrice;
      const isolatedLiquidation = calculated.marginMode === 'isolated'
        && Number.isFinite(calculated.liquidationPrice)
        && (calculated.side === 'long' ? markPrice <= calculated.liquidationPrice : markPrice >= calculated.liquidationPrice);
      if (isolatedLiquidation) {
        await liquidate(calculated, market, options.reason || 'isolated_margin');
        continue;
      }

      const trigger = protectionTrigger(calculated, markPrice);
      if (trigger) {
        const closeResult = await orders.closePosition({
          symbol: calculated.symbol,
          positionSide: calculated.side,
          quantity: calculated.quantity,
          type: 'market',
        }, market);
        if (closeResult.ok) {
          await ledger.transact(`perpetual-${trigger}`, draft => {
            draft.auditEvents.unshift({
              id: ledger.nextId('perp-audit'), type: trigger, symbol: calculated.symbol,
              positionId: calculated.id, status: 'completed',
              message: `${trigger === 'take_profit' ? '止盈' : trigger === 'stop_loss' ? '止损' : '追踪止损'}已执行`,
              createdAt: Date.now(),
            });
          });
          triggers.push({ type: trigger, positionId: calculated.id });
        }
        continue;
      }

      await ledger.transact('perpetual-mark-position', draft => {
        const current = draft.positions.find(item => item.id === calculated.id);
        if (current) Object.assign(current, calculated, { updatedAt: Date.now() });
      });
    }

    const refreshed = ledger.getState();
    const crossPositions = refreshed.positions
      .filter(position => position.marginMode === 'cross')
      .map(position => ({ ...position, markPrice: marketFor(position.symbol).markPrice }));
    if (crossPositions.length) {
      const account = risk.calculateAccount({ account: refreshed.account, positions: crossPositions });
      if (account.equity <= account.maintenanceMargin + EPSILON) {
        for (const position of crossPositions.sort((a, b) => b.maintenanceMargin - a.maintenanceMargin)) {
          await liquidate(position, marketFor(position.symbol), options.reason || 'cross_margin');
        }
      }
    }

    await orders.evaluateMarket(marketFor(activeContract));
    await funding.settleDue(Date.now());
    return { ok: true, triggers, snapshot: getSnapshot() };
  }

  function scheduleEvaluation(reason = 'market') {
    const execute = () => evaluateNow({ reason });
    pendingEvaluation = pendingEvaluation.then(execute, execute);
    return pendingEvaluation;
  }

  function flush() {
    return pendingEvaluation;
  }

  function setActiveContract(symbol) {
    activeContract = contractSymbol(symbol);
    return getSnapshot();
  }

  if (marketEngine?.subscribe) {
    unsubscribeMarket = marketEngine.subscribe(() => scheduleEvaluation('market_update'));
  }

  window.AtlasPerpetual = Object.freeze({
    getSnapshot,
    setActiveContract,
    setLeverage,
    setMarginMode,
    setPositionMode,
    setPositionProtection,
    submitOrder,
    closePosition,
    evaluateNow,
    flush,
    destroy: () => { unsubscribeMarket?.(); unsubscribeMarket = null; },
  });

  document.documentElement.dataset.perpetualController = 'ready';
})();
