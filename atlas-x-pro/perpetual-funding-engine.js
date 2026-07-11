(() => {
  'use strict';

  if (window.__ATLAS_PERPETUAL_FUNDING__) return;
  window.__ATLAS_PERPETUAL_FUNDING__ = true;

  const ledger = window.AtlasPerpetualLedger;
  if (!ledger) throw new Error('Perpetual funding engine requires perpetual ledger');

  const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
  const MAX_ABS_FUNDING_RATE = 0.003;
  const nextFundingOverrides = new Map();
  const contextCache = new Map();

  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const normalizeContractSymbol = value => {
    const raw = String(value || 'BTC-USDT-SWAP').toUpperCase();
    if (raw.endsWith('-USDT-SWAP')) return raw;
    const compact = raw.replace(/[^A-Z0-9]/g, '');
    const base = compact.endsWith('USDT') ? compact.slice(0, -4) : compact || 'BTC';
    return `${base}-USDT-SWAP`;
  };
  const spotSymbol = contract => normalizeContractSymbol(contract).replace('-USDT-SWAP', 'USDT');
  const nextBoundary = timestamp => Math.floor(timestamp / FUNDING_INTERVAL_MS) * FUNDING_INTERVAL_MS + FUNDING_INTERVAL_MS;

  const freshnessFromState = state => {
    if (state?.connectionState === 'live') return 'live';
    if (state?.connectionState === 'stale' || state?.connectionState === 'reconnecting' || state?.connectionState === 'booting') return 'stale';
    return 'offline';
  };

  const normalizeContext = (input, symbol) => {
    const normalizedSymbol = normalizeContractSymbol(symbol || input?.symbol);
    const lastPrice = positive(input?.lastPrice || input?.price);
    const indexPrice = positive(input?.indexPrice, lastPrice);
    const markPrice = positive(input?.markPrice, indexPrice || lastPrice);
    const fundingRate = clamp(finite(input?.fundingRate), -MAX_ABS_FUNDING_RATE, MAX_ABS_FUNDING_RATE);
    const source = ['public', 'derived', 'cache'].includes(input?.source) ? input.source : 'derived';
    const freshness = ['live', 'stale', 'offline'].includes(input?.freshness) ? input.freshness : 'offline';
    const updatedAt = finite(input?.updatedAt, Date.now());
    const providerNext = finite(input?.nextFundingAt, nextBoundary(updatedAt));
    const override = finite(nextFundingOverrides.get(normalizedSymbol));
    const nextFundingAt = Math.max(providerNext, override);
    return {
      symbol: normalizedSymbol,
      lastPrice,
      indexPrice,
      markPrice,
      fundingRate,
      nextFundingAt,
      source,
      freshness,
      updatedAt,
    };
  };

  const deriveContext = symbol => {
    const normalizedSymbol = normalizeContractSymbol(symbol);
    const state = window.AtlasMarketDataEngine?.getState?.() || {};
    const currentSpot = String(state.symbol || '').toUpperCase();
    const matches = currentSpot === spotSymbol(normalizedSymbol);
    const lastPrice = matches ? positive(state.ticker?.price) : 0;
    const indexPrice = lastPrice;
    const basis = 0;
    const markPrice = indexPrice > 0 ? indexPrice * (1 + basis) : 0;
    const fundingRate = indexPrice > 0 ? clamp(basis / 3, -MAX_ABS_FUNDING_RATE, MAX_ABS_FUNDING_RATE) : 0;
    return normalizeContext({
      symbol: normalizedSymbol,
      lastPrice,
      indexPrice,
      markPrice,
      fundingRate,
      nextFundingAt: nextBoundary(Date.now()),
      source: 'derived',
      freshness: matches ? freshnessFromState(state) : 'offline',
      updatedAt: finite(state.lastReceivedAt, Date.now()),
    }, normalizedSymbol);
  };

  const getMarketContext = symbol => {
    const normalizedSymbol = normalizeContractSymbol(symbol);
    let provided = null;
    try {
      if (typeof window.__ATLAS_PERPETUAL_MARKET_CONTEXT__ === 'function') {
        provided = window.__ATLAS_PERPETUAL_MARKET_CONTEXT__(normalizedSymbol);
      }
    } catch {}
    const context = provided && typeof provided === 'object'
      ? normalizeContext(provided, normalizedSymbol)
      : deriveContext(normalizedSymbol);
    contextCache.set(normalizedSymbol, context);
    return { ...context };
  };

  const eventKey = (positionId, windowAt) => `${String(positionId)}:${Number(windowAt)}`;

  const settleDue = async (timestamp = Date.now()) => {
    const at = finite(timestamp, Date.now());
    let settled = 0;
    const details = [];

    await ledger.transact('perpetual-funding-settlement', draft => {
      const existingKeys = new Set((draft.fundingEvents || []).map(event => eventKey(event.positionId, event.windowAt)));
      for (const position of draft.positions || []) {
        const context = getMarketContext(position.symbol);
        const dueAt = finite(context.nextFundingAt);
        if (!(dueAt > 0) || at < dueAt) continue;
        const key = eventKey(position.id, dueAt);
        if (existingKeys.has(key)) continue;

        const markPrice = positive(context.markPrice, positive(position.markPrice, position.entryPrice));
        const notional = positive(position.quantity) * markPrice;
        const rawAmount = notional * finite(context.fundingRate);
        const payment = position.side === 'short' ? -rawAmount : rawAmount;
        const offlineCatchUp = at - dueAt >= FUNDING_INTERVAL_MS;
        const nextAt = nextBoundary(at);
        const normalizedSymbol = normalizeContractSymbol(position.symbol);
        nextFundingOverrides.set(normalizedSymbol, nextAt);
        contextCache.set(normalizedSymbol, { ...context, nextFundingAt: nextAt });

        draft.account.fundingPaid = finite(draft.account.fundingPaid) + payment;
        position.realizedPnl = finite(position.realizedPnl) - payment;
        position.markPrice = markPrice;
        position.updatedAt = at;

        const fundingEvent = {
          id: ledger.nextId('funding'),
          positionId: position.id,
          symbol: normalizedSymbol,
          side: position.side === 'short' ? 'short' : 'long',
          quantity: positive(position.quantity),
          markPrice,
          notional,
          fundingRate: finite(context.fundingRate),
          amount: payment,
          source: context.source,
          freshness: context.freshness,
          windowAt: dueAt,
          settledAt: at,
          nextFundingAt: nextAt,
          offlineCatchUp,
        };
        draft.fundingEvents.unshift(fundingEvent);
        draft.auditEvents.unshift({
          id: ledger.nextId('perp-audit'),
          type: 'funding',
          symbol: fundingEvent.symbol,
          positionId: fundingEvent.positionId,
          status: 'settled',
          message: `${fundingEvent.side === 'long' ? '多头' : '空头'}资金费 ${payment >= 0 ? '支付' : '收取'} ${Math.abs(payment).toFixed(8)} USDT`,
          createdAt: at,
        });
        existingKeys.add(key);
        settled += 1;
        details.push({ ...fundingEvent });
      }
      draft.fundingEvents = (draft.fundingEvents || []).slice(0, 240);
      draft.auditEvents = (draft.auditEvents || []).slice(0, 500);
    });

    return { settled, events: details };
  };

  const getCountdown = (timestamp = Date.now(), symbol) => {
    const at = finite(timestamp, Date.now());
    if (symbol) {
      const normalizedSymbol = normalizeContractSymbol(symbol);
      const override = finite(nextFundingOverrides.get(normalizedSymbol));
      if (override > at) return override - at;
      const context = getMarketContext(normalizedSymbol);
      const nextAt = finite(context.nextFundingAt);
      return Math.max(0, (nextAt > at ? nextAt : nextBoundary(at)) - at);
    }

    const futureOverrides = [...nextFundingOverrides.values()]
      .map(value => finite(value))
      .filter(value => value > at);
    if (futureOverrides.length) return Math.min(...futureOverrides) - at;

    const cached = [...contextCache.values()]
      .map(context => finite(context.nextFundingAt))
      .filter(value => value > at);
    if (cached.length) return Math.min(...cached) - at;

    const context = getMarketContext('BTC-USDT-SWAP');
    const nextAt = finite(context.nextFundingAt);
    return Math.max(0, (nextAt > at ? nextAt : nextBoundary(at)) - at);
  };

  window.addEventListener('atlas:perpetual-ledger', event => {
    if (event?.detail?.label !== 'reset') return;
    nextFundingOverrides.clear();
    contextCache.clear();
  });

  window.AtlasPerpetualFunding = Object.freeze({
    FUNDING_INTERVAL_MS,
    getMarketContext,
    settleDue,
    getCountdown,
  });

  document.documentElement.dataset.perpetualFunding = 'ready';
})();