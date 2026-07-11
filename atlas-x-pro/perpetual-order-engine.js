(() => {
  'use strict';

  if (window.__ATLAS_PERPETUAL_ORDERS__) return;
  window.__ATLAS_PERPETUAL_ORDERS__ = true;

  const ledger = window.AtlasPerpetualLedger;
  const risk = window.AtlasPerpetualRisk;
  if (!ledger || !risk) throw new Error('Perpetual order engine requires ledger and risk engine');

  const MAKER_FEE_RATE = 0.0002;
  const TAKER_FEE_RATE = 0.0005;
  const EPSILON = 1e-9;

  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
  const now = () => Date.now();
  const symbolOf = value => String(value || 'BTC-USDT-SWAP').toUpperCase();
  const sideOf = value => value === 'sell' ? 'sell' : 'buy';
  const positionSideOf = (value, side) => value === 'short' ? 'short' : value === 'long' ? 'long' : side === 'sell' ? 'short' : 'long';
  const marginModeOf = value => value === 'cross' ? 'cross' : 'isolated';
  const timeInForceOf = value => ['GTC', 'IOC', 'FOK', 'POST_ONLY'].includes(value) ? value : 'GTC';
  const typeOf = value => ['market', 'limit', 'stop_market', 'stop_limit', 'trigger_market', 'trigger_limit'].includes(value) ? value : 'market';

  const levelPrice = level => positive(level?.price ?? level?.[0]);
  const levelQuantity = level => positive(level?.quantity ?? level?.qty ?? level?.size ?? level?.[1]);

  const bookForSide = (market, side) => side === 'buy'
    ? (Array.isArray(market?.asks) ? market.asks : [])
    : (Array.isArray(market?.bids) ? market.bids : []);

  const isMarketable = (order, market) => {
    if (order.type === 'market') return true;
    const levels = bookForSide(market, order.side);
    const best = levelPrice(levels[0]);
    if (!(best > 0) || !(order.price > 0)) return false;
    return order.side === 'buy' ? order.price >= best : order.price <= best;
  };

  const eligibleLevels = (order, market) => bookForSide(market, order.side).filter(level => {
    const price = levelPrice(level);
    if (!(price > 0)) return false;
    if (order.type === 'market') return true;
    return order.side === 'buy' ? price <= order.price : price >= order.price;
  });

  const executionQuote = (order, market, requestedQuantity = order.quantity) => {
    const requested = positive(requestedQuantity);
    const levels = eligibleLevels(order, market);
    let remaining = requested;
    let filledQuantity = 0;
    let quoteValue = 0;

    for (const level of levels) {
      if (remaining <= EPSILON) break;
      const price = levelPrice(level);
      const available = levelQuantity(level);
      if (!(price > 0) || !(available > 0)) continue;
      const fill = Math.min(remaining, available);
      filledQuantity += fill;
      quoteValue += fill * price;
      remaining -= fill;
    }

    if (filledQuantity <= EPSILON && order.type === 'market') {
      const reference = positive(market?.lastPrice || market?.markPrice || market?.indexPrice);
      if (reference > 0) {
        filledQuantity = requested;
        const simulatedSlip = Math.min(0.0015, Math.max(0.00005, requested * 0.00001));
        const price = order.side === 'buy' ? reference * (1 + simulatedSlip) : reference * (1 - simulatedSlip);
        quoteValue = filledQuantity * price;
        return {
          filledQuantity,
          averagePrice: price,
          remainingQuantity: 0,
          source: 'simulated_depth',
        };
      }
    }

    return {
      filledQuantity,
      averagePrice: filledQuantity > EPSILON ? quoteValue / filledQuantity : 0,
      remainingQuantity: Math.max(0, requested - filledQuantity),
      source: levels.length ? 'orderbook' : 'none',
    };
  };

  const openingDirection = order => (order.positionSide === 'long' && order.side === 'buy')
    || (order.positionSide === 'short' && order.side === 'sell');

  const matchingPosition = (draft, order) => draft.positions.find(position =>
    position.symbol === order.symbol && position.side === order.positionSide);

  const addAudit = (draft, event) => {
    draft.auditEvents.unshift({
      id: ledger.nextId('perp-audit'),
      type: event.type || 'order',
      symbol: event.symbol || '',
      orderId: event.orderId || null,
      positionId: event.positionId || null,
      status: event.status || null,
      message: event.message || '',
      createdAt: now(),
    });
    draft.auditEvents = draft.auditEvents.slice(0, 500);
  };

  const updatePositionAfterFill = (draft, order, quantity, price, fee) => {
    const position = matchingPosition(draft, order);
    const isOpening = openingDirection(order);

    if (isOpening) {
      if (position) {
        const previousQuantity = positive(position.quantity);
        const nextQuantity = previousQuantity + quantity;
        position.entryPrice = risk.weightedEntry(previousQuantity, position.entryPrice, quantity, price);
        position.quantity = nextQuantity;
        position.leverage = order.leverage;
        position.marginMode = order.marginMode;
        position.initialMargin = nextQuantity * price / order.leverage;
        if (position.marginMode === 'isolated') {
          position.isolatedMargin = positive(position.isolatedMargin) + quantity * price / order.leverage;
        }
        position.markPrice = positive(order.marketMarkPrice, price);
        position.updatedAt = now();
        return { position, realizedPnl: 0 };
      }

      const initialMargin = quantity * price / order.leverage;
      const created = {
        id: ledger.nextId('perp-position'),
        symbol: order.symbol,
        side: order.positionSide,
        positionMode: draft.account.positionMode,
        marginMode: order.marginMode,
        leverage: order.leverage,
        quantity,
        entryPrice: price,
        markPrice: positive(order.marketMarkPrice, price),
        isolatedMargin: order.marginMode === 'isolated' ? initialMargin : 0,
        initialMargin,
        maintenanceMargin: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        fees: fee,
        liquidationPrice: null,
        bankruptcyPrice: null,
        takeProfit: null,
        stopLoss: null,
        trailingStop: null,
        createdAt: now(),
        updatedAt: now(),
      };
      const calculated = risk.calculatePosition(created);
      Object.assign(created, calculated);
      draft.positions.unshift(created);
      return { position: created, realizedPnl: 0 };
    }

    if (!position) return { errorCode: 'POSITION_NOT_FOUND' };
    if (quantity > positive(position.quantity) + EPSILON) return { errorCode: 'REDUCE_ONLY_EXCEEDS_POSITION' };

    const realized = risk.realizedPnl({
      side: position.side,
      quantity,
      entryPrice: position.entryPrice,
      exitPrice: price,
    });
    position.quantity = Math.max(0, positive(position.quantity) - quantity);
    position.realizedPnl = finite(position.realizedPnl) + realized;
    position.initialMargin = position.quantity * positive(position.entryPrice) / Math.max(1, positive(position.leverage, 1));
    if (position.marginMode === 'isolated') {
      const release = quantity * positive(position.entryPrice) / Math.max(1, positive(position.leverage, 1));
      position.isolatedMargin = Math.max(0, positive(position.isolatedMargin) - release);
    }
    position.markPrice = positive(order.marketMarkPrice, price);
    position.updatedAt = now();
    draft.account.realizedPnl = finite(draft.account.realizedPnl) + realized;

    if (position.quantity <= EPSILON) {
      draft.positions = draft.positions.filter(item => item.id !== position.id);
    } else {
      Object.assign(position, risk.calculatePosition(position));
    }
    return { position, realizedPnl: realized };
  };

  const applyFill = (draft, order, quantity, price, liquidity, source) => {
    const feeRate = liquidity === 'maker' ? MAKER_FEE_RATE : TAKER_FEE_RATE;
    const fee = quantity * price * feeRate;
    const positionResult = updatePositionAfterFill(draft, order, quantity, price, fee);
    if (positionResult.errorCode) return positionResult;

    draft.account.feesPaid = positive(draft.account.feesPaid) + fee;
    const referencePrice = positive(order.referencePrice, positive(order.marketMarkPrice, price));
    const adverse = order.side === 'buy' ? price - referencePrice : referencePrice - price;
    const slippageBps = referencePrice > 0 ? adverse / referencePrice * 10000 : null;
    const fill = {
      id: ledger.nextId('perp-fill'),
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      positionSide: order.positionSide,
      quantity,
      price,
      referencePrice: referencePrice || null,
      fee,
      liquidity,
      source,
      realizedPnl: finite(positionResult.realizedPnl),
      slippageBps,
      createdAt: now(),
    };
    draft.fills.unshift(fill);
    draft.fills = draft.fills.slice(0, 500);
    addAudit(draft, {
      type: 'fill',
      symbol: order.symbol,
      orderId: order.id,
      positionId: positionResult.position?.id,
      status: 'filled',
      message: `${order.side === 'buy' ? '买入' : '卖出'} ${quantity} @ ${price}`,
    });
    return { fill, position: positionResult.position, realizedPnl: positionResult.realizedPnl };
  };

  const availableMargin = (draft, market) => {
    const positions = draft.positions.map(position => ({
      ...position,
      markPrice: position.symbol === symbolOf(market?.symbol)
        ? positive(market?.markPrice || market?.lastPrice, position.markPrice)
        : position.markPrice,
    }));
    const account = risk.calculateAccount({ account: draft.account, positions });
    const reserved = draft.orders
      .filter(order => ['open', 'trigger_wait'].includes(order.status))
      .reduce((sum, order) => sum + positive(order.reservedMargin), 0);
    return account.availableMargin - reserved;
  };

  const validateOrder = (input, market, draft) => {
    const side = sideOf(input?.side);
    const positionSide = positionSideOf(input?.positionSide, side);
    const type = typeOf(input?.type);
    const quantity = positive(input?.quantity);
    const symbol = symbolOf(input?.symbol || market?.symbol);
    const marginMode = marginModeOf(input?.marginMode);
    const timeInForce = timeInForceOf(input?.timeInForce);
    const price = positive(input?.price);
    const triggerPrice = positive(input?.triggerPrice);
    const leverage = Math.max(1, positive(input?.leverage, draft.preferences.leverageBySymbol[symbol] || 10));
    const referencePrice = positive(market?.markPrice || market?.lastPrice || market?.indexPrice || price);

    if (!(quantity > 0)) return { ok: false, errorCode: 'INVALID_QUANTITY', message: '请输入有效数量' };
    if (!symbol.endsWith('-USDT-SWAP')) return { ok: false, errorCode: 'UNSUPPORTED_CONTRACT', message: '当前仅支持 USDT 永续合约' };
    if (type !== 'market' && type !== 'stop_market' && type !== 'trigger_market' && !(price > 0)) {
      return { ok: false, errorCode: 'INVALID_PRICE', message: '请输入有效委托价格' };
    }
    if (['stop_market', 'stop_limit', 'trigger_market', 'trigger_limit'].includes(type) && !(triggerPrice > 0)) {
      return { ok: false, errorCode: 'INVALID_TRIGGER_PRICE', message: '请输入有效触发价格' };
    }

    const order = {
      id: ledger.nextId('perp-order'),
      clientOrderId: String(input?.clientOrderId || ledger.nextId('client')),
      symbol,
      side,
      positionSide,
      type,
      timeInForce,
      quantity,
      price,
      triggerPrice,
      triggerDirection: input?.triggerDirection === 'below' ? 'below' : 'above',
      reduceOnly: Boolean(input?.reduceOnly),
      marginMode,
      leverage,
      status: 'created',
      filledQuantity: 0,
      averagePrice: 0,
      reservedMargin: 0,
      estimatedFee: 0,
      referencePrice,
      marketMarkPrice: referencePrice,
      createdAt: now(),
      updatedAt: now(),
    };

    const isOpening = openingDirection(order);
    const position = matchingPosition(draft, order);
    if (order.reduceOnly) {
      if (isOpening) return { ok: false, errorCode: 'REDUCE_ONLY_WOULD_INCREASE', message: '只减仓订单不能增加仓位' };
      if (!position) return { ok: false, errorCode: 'POSITION_NOT_FOUND', message: '没有可减仓位' };
      if (quantity > positive(position.quantity) + EPSILON) {
        return { ok: false, errorCode: 'REDUCE_ONLY_EXCEEDS_POSITION', message: '只减仓数量超过当前仓位' };
      }
    } else if (!isOpening && !position) {
      return { ok: false, errorCode: 'POSITION_NOT_FOUND', message: '当前方向没有可平仓位' };
    }

    if (isOpening && !order.reduceOnly) {
      const notionalPrice = type === 'market' ? referencePrice : price;
      const notional = quantity * notionalPrice;
      const openCheck = risk.canOpen({
        symbol,
        notional,
        leverage,
        freshness: market?.freshness || 'offline',
        availableMargin: availableMargin(draft, market),
      });
      if (!openCheck.ok) return { ...openCheck, message: openCheck.message || '无法开仓' };
      order.leverage = openCheck.leverage;
      order.reservedMargin = openCheck.requiredMargin;
      order.estimatedFee = notional * (timeInForce === 'POST_ONLY' ? MAKER_FEE_RATE : TAKER_FEE_RATE);
    }

    if (timeInForce === 'POST_ONLY' && isMarketable(order, market)) {
      return { ok: false, errorCode: 'POST_ONLY_WOULD_TAKE', message: 'Post Only 订单会立即吃单，已拒绝' };
    }

    return { ok: true, order };
  };

  const processOrderInsideTransaction = (draft, order, market) => {
    const triggerOrder = ['stop_market', 'stop_limit', 'trigger_market', 'trigger_limit'].includes(order.type);
    if (triggerOrder) {
      order.status = 'trigger_wait';
      draft.orders.unshift(order);
      addAudit(draft, { type: 'order', symbol: order.symbol, orderId: order.id, status: order.status, message: '条件单已进入监听' });
      return { ok: true, orderId: order.id, fillIds: [], status: order.status };
    }

    const marketable = isMarketable(order, market);
    if (order.type === 'limit' && !marketable) {
      order.status = 'open';
      draft.orders.unshift(order);
      addAudit(draft, { type: 'order', symbol: order.symbol, orderId: order.id, status: 'open', message: '限价单已挂单' });
      return { ok: true, orderId: order.id, fillIds: [], status: 'open' };
    }

    const quote = executionQuote(order, market);
    if (order.timeInForce === 'FOK' && quote.filledQuantity + EPSILON < order.quantity) {
      addAudit(draft, { type: 'order', symbol: order.symbol, orderId: order.id, status: 'rejected', message: 'FOK 无法全部成交' });
      return { ok: false, errorCode: 'FOK_NOT_FILLABLE', message: 'FOK 订单无法立即全部成交' };
    }

    let executableQuantity = quote.filledQuantity;
    if (order.type === 'market' && executableQuantity <= EPSILON) executableQuantity = order.quantity;
    if (executableQuantity <= EPSILON) {
      if (order.timeInForce === 'IOC') {
        addAudit(draft, { type: 'order', symbol: order.symbol, orderId: order.id, status: 'canceled', message: 'IOC 无可成交数量' });
        return { ok: true, orderId: order.id, fillIds: [], filledQuantity: 0, canceledQuantity: order.quantity, status: 'canceled' };
      }
      order.status = 'open';
      draft.orders.unshift(order);
      return { ok: true, orderId: order.id, fillIds: [], status: 'open' };
    }

    const fillResult = applyFill(draft, order, executableQuantity, quote.averagePrice, order.timeInForce === 'POST_ONLY' ? 'maker' : 'taker', quote.source);
    if (fillResult.errorCode) return { ok: false, errorCode: fillResult.errorCode };
    order.filledQuantity = executableQuantity;
    order.averagePrice = quote.averagePrice;
    const remaining = Math.max(0, order.quantity - executableQuantity);

    if (remaining > EPSILON && order.timeInForce === 'GTC') {
      order.quantity = remaining;
      order.status = 'open';
      order.reservedMargin = remaining * (order.price || quote.averagePrice) / order.leverage;
      draft.orders.unshift(order);
    } else {
      order.status = remaining > EPSILON ? 'partially_filled_canceled' : 'filled';
      order.reservedMargin = 0;
    }

    return {
      ok: true,
      orderId: order.id,
      fillIds: [fillResult.fill.id],
      filledQuantity: executableQuantity,
      canceledQuantity: order.timeInForce === 'IOC' ? remaining : 0,
      remainingQuantity: order.timeInForce === 'GTC' ? remaining : 0,
      averagePrice: quote.averagePrice,
      status: order.status,
    };
  };

  const submitOrder = async (input, market = {}) => {
    let outcome = { ok: false, errorCode: 'UNKNOWN' };
    await ledger.transact('perpetual-submit-order', draft => {
      const validation = validateOrder(input, market, draft);
      if (!validation.ok) {
        outcome = validation;
        addAudit(draft, {
          type: 'order_rejected',
          symbol: symbolOf(input?.symbol || market?.symbol),
          status: 'rejected',
          message: validation.message || validation.errorCode,
        });
        return;
      }
      outcome = processOrderInsideTransaction(draft, validation.order, market);
    });
    return outcome;
  };

  const cancelOrder = async id => {
    let outcome = { ok: false, errorCode: 'ORDER_NOT_FOUND' };
    await ledger.transact('perpetual-cancel-order', draft => {
      const index = draft.orders.findIndex(order => order.id === id);
      if (index < 0) return;
      const [order] = draft.orders.splice(index, 1);
      addAudit(draft, { type: 'order', symbol: order.symbol, orderId: order.id, status: 'canceled', message: '委托已取消' });
      outcome = { ok: true, orderId: id, status: 'canceled' };
    });
    return outcome;
  };

  const triggerReached = (order, market) => {
    const mark = positive(market?.markPrice || market?.lastPrice || market?.indexPrice);
    if (!(mark > 0) || !(order.triggerPrice > 0)) return false;
    return order.triggerDirection === 'below' ? mark <= order.triggerPrice : mark >= order.triggerPrice;
  };

  const evaluateMarket = async market => {
    const state = ledger.getState();
    const candidates = state.orders.filter(order => order.symbol === symbolOf(market?.symbol));
    const outcomes = [];
    for (const stored of candidates) {
      if (stored.status === 'trigger_wait' && triggerReached(stored, market)) {
        await cancelOrder(stored.id);
        const childType = stored.type.endsWith('_limit') ? 'limit' : 'market';
        outcomes.push(await submitOrder({
          ...stored,
          id: undefined,
          clientOrderId: undefined,
          type: childType,
          timeInForce: stored.timeInForce || 'GTC',
        }, market));
      } else if (stored.status === 'open' && isMarketable(stored, market)) {
        await cancelOrder(stored.id);
        outcomes.push(await submitOrder({
          ...stored,
          id: undefined,
          clientOrderId: undefined,
          quantity: stored.quantity,
          type: 'limit',
          timeInForce: 'GTC',
        }, market));
      }
    }
    return outcomes;
  };

  const closePosition = async (input, market) => {
    const state = ledger.getState();
    const symbol = symbolOf(input?.symbol || market?.symbol);
    const positionSide = input?.positionSide === 'short' ? 'short' : 'long';
    const position = state.positions.find(item => item.symbol === symbol && item.side === positionSide);
    if (!position) return { ok: false, errorCode: 'POSITION_NOT_FOUND' };
    const quantity = Math.min(positive(input?.quantity, position.quantity), positive(position.quantity));
    return submitOrder({
      symbol,
      side: positionSide === 'long' ? 'sell' : 'buy',
      positionSide,
      type: input?.type || 'market',
      price: input?.price,
      quantity,
      leverage: position.leverage,
      marginMode: position.marginMode,
      reduceOnly: true,
      timeInForce: input?.timeInForce || 'GTC',
    }, market);
  };

  window.AtlasPerpetualOrders = Object.freeze({
    MAKER_FEE_RATE,
    TAKER_FEE_RATE,
    submitOrder,
    cancelOrder,
    evaluateMarket,
    closePosition,
    quote: executionQuote,
  });

  document.documentElement.dataset.perpetualOrders = 'ready';
})();
