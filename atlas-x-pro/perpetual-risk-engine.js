(() => {
  'use strict';

  if (window.__ATLAS_PERPETUAL_RISK__) return;
  window.__ATLAS_PERPETUAL_RISK__ = true;

  const EPSILON = 1e-9;
  const LIQUIDATION_FEE_RATE = 0.001;

  const CONTRACTS = Object.freeze({
    'BTC-USDT-SWAP': Object.freeze({
      symbol: 'BTC-USDT-SWAP',
      maxLeverage: 125,
      minNotional: 5,
      quantityStep: 0.001,
      priceTick: 0.1,
      tiers: Object.freeze([
        Object.freeze({ maxNotional: 50_000, maintenanceRate: 0.004, maintenanceAmount: 0, maxLeverage: 125 }),
        Object.freeze({ maxNotional: 250_000, maintenanceRate: 0.005, maintenanceAmount: 50, maxLeverage: 75 }),
        Object.freeze({ maxNotional: 1_000_000, maintenanceRate: 0.01, maintenanceAmount: 1_300, maxLeverage: 50 }),
        Object.freeze({ maxNotional: Infinity, maintenanceRate: 0.025, maintenanceAmount: 16_300, maxLeverage: 20 }),
      ]),
    }),
    'ETH-USDT-SWAP': Object.freeze({
      symbol: 'ETH-USDT-SWAP',
      maxLeverage: 100,
      minNotional: 5,
      quantityStep: 0.001,
      priceTick: 0.01,
      tiers: Object.freeze([
        Object.freeze({ maxNotional: 25_000, maintenanceRate: 0.004, maintenanceAmount: 0, maxLeverage: 100 }),
        Object.freeze({ maxNotional: 150_000, maintenanceRate: 0.005, maintenanceAmount: 25, maxLeverage: 75 }),
        Object.freeze({ maxNotional: 750_000, maintenanceRate: 0.01, maintenanceAmount: 775, maxLeverage: 50 }),
        Object.freeze({ maxNotional: Infinity, maintenanceRate: 0.025, maintenanceAmount: 12_025, maxLeverage: 20 }),
      ]),
    }),
  });

  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
  const sideOf = value => value === 'short' ? 'short' : 'long';

  const contractFor = symbol => CONTRACTS[String(symbol || '').toUpperCase()] || CONTRACTS['BTC-USDT-SWAP'];

  const getTier = (symbol, notional) => {
    const contract = contractFor(symbol);
    const value = positive(notional);
    return contract.tiers.find(tier => value <= tier.maxNotional) || contract.tiers[contract.tiers.length - 1];
  };

  const validateLeverage = (symbol, notional, leverage) => {
    const contract = contractFor(symbol);
    const tier = getTier(symbol, notional);
    const requested = Math.max(1, finite(leverage, 1));
    const maxLeverage = Math.min(contract.maxLeverage, tier.maxLeverage);
    return requested <= maxLeverage
      ? { ok: true, leverage: requested, maxLeverage, tier }
      : { ok: false, leverage: maxLeverage, requestedLeverage: requested, maxLeverage, tier, errorCode: 'LEVERAGE_EXCEEDS_TIER' };
  };

  const weightedEntry = (existingQuantity, existingEntry, addedQuantity, fillPrice) => {
    const oldQty = positive(existingQuantity);
    const addQty = positive(addedQuantity);
    const total = oldQty + addQty;
    if (total <= EPSILON) return 0;
    return ((oldQty * positive(existingEntry)) + (addQty * positive(fillPrice))) / total;
  };

  const realizedPnl = ({ side, quantity, entryPrice, exitPrice }) => {
    const qty = positive(quantity);
    const entry = positive(entryPrice);
    const exit = positive(exitPrice);
    return sideOf(side) === 'short' ? qty * (entry - exit) : qty * (exit - entry);
  };

  const liquidationPriceFor = ({ side, quantity, entryPrice, margin, tier }) => {
    const qty = positive(quantity);
    const entry = positive(entryPrice);
    const collateral = positive(margin);
    if (qty <= EPSILON || entry <= EPSILON) return null;
    const maintenanceAmount = positive(tier?.maintenanceAmount);
    const rate = positive(tier?.maintenanceRate) + LIQUIDATION_FEE_RATE;
    if (sideOf(side) === 'short') {
      const denominator = qty * (1 + rate);
      return Math.max(0, (collateral + qty * entry - maintenanceAmount) / Math.max(denominator, EPSILON));
    }
    const denominator = qty * Math.max(1 - rate, EPSILON);
    return Math.max(0, (qty * entry - collateral + maintenanceAmount) / Math.max(denominator, EPSILON));
  };

  const bankruptcyPriceFor = ({ side, quantity, entryPrice, margin }) => {
    const qty = positive(quantity);
    const entry = positive(entryPrice);
    const collateral = positive(margin);
    if (qty <= EPSILON || entry <= EPSILON) return null;
    return sideOf(side) === 'short'
      ? entry + collateral / qty
      : Math.max(0, entry - collateral / qty);
  };

  const calculatePosition = input => {
    const symbol = String(input?.symbol || 'BTC-USDT-SWAP').toUpperCase();
    const side = sideOf(input?.side);
    const quantity = positive(input?.quantity);
    const entryPrice = positive(input?.entryPrice);
    const markPrice = positive(input?.markPrice, entryPrice);
    const leverageCheck = validateLeverage(symbol, quantity * markPrice, input?.leverage);
    const leverage = leverageCheck.leverage;
    const notional = quantity * markPrice;
    const initialMargin = leverage > 0 ? notional / leverage : Infinity;
    const tier = getTier(symbol, notional);
    const maintenanceMargin = notional * tier.maintenanceRate + tier.maintenanceAmount;
    const unrealizedPnl = side === 'short'
      ? quantity * (entryPrice - markPrice)
      : quantity * (markPrice - entryPrice);
    const marginMode = input?.marginMode === 'cross' ? 'cross' : 'isolated';
    const isolatedMargin = marginMode === 'isolated'
      ? positive(input?.isolatedMargin, initialMargin)
      : 0;
    const liquidationMargin = marginMode === 'isolated'
      ? Math.max(isolatedMargin, initialMargin)
      : positive(input?.crossMarginAllocation, initialMargin);
    const liquidationPrice = liquidationPriceFor({
      side,
      quantity,
      entryPrice,
      margin: liquidationMargin,
      tier,
    });
    const bankruptcyPrice = bankruptcyPriceFor({
      side,
      quantity,
      entryPrice,
      margin: liquidationMargin,
    });
    const effectiveEquity = marginMode === 'isolated'
      ? isolatedMargin + unrealizedPnl
      : positive(input?.crossMarginAllocation, initialMargin) + unrealizedPnl;
    const marginRatio = maintenanceMargin / Math.max(effectiveEquity, EPSILON);

    return {
      ...input,
      symbol,
      side,
      quantity,
      entryPrice,
      markPrice,
      leverage,
      marginMode,
      notional,
      initialMargin,
      maintenanceMargin,
      maintenanceRate: tier.maintenanceRate,
      maintenanceAmount: tier.maintenanceAmount,
      unrealizedPnl,
      isolatedMargin,
      effectiveEquity,
      marginRatio,
      liquidationPrice,
      bankruptcyPrice,
      maxLeverage: leverageCheck.maxLeverage,
      leverageValid: leverageCheck.ok,
    };
  };

  const calculateAccount = ({ account = {}, positions = [] } = {}) => {
    const calculatedPositions = (Array.isArray(positions) ? positions : []).map(calculatePosition);
    const crossPositions = calculatedPositions.filter(position => position.marginMode === 'cross');
    const unrealizedPnl = crossPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
    const maintenanceMargin = crossPositions.reduce((sum, position) => sum + position.maintenanceMargin, 0);
    const usedInitialMargin = crossPositions.reduce((sum, position) => sum + position.initialMargin, 0);
    const walletBalance = finite(account.walletBalance);
    const realized = finite(account.realizedPnl);
    const feesPaid = positive(account.feesPaid);
    const fundingPaid = finite(account.fundingPaid);
    const equity = walletBalance + realized + unrealizedPnl - feesPaid - fundingPaid;
    const availableMargin = equity - usedInitialMargin;
    const marginRatio = maintenanceMargin / Math.max(equity, EPSILON);
    return {
      walletBalance,
      realizedPnl: realized,
      feesPaid,
      fundingPaid,
      unrealizedPnl,
      equity,
      maintenanceMargin,
      usedInitialMargin,
      availableMargin,
      marginRatio,
      positions: calculatedPositions,
    };
  };

  const canOpen = ({ symbol, notional, leverage, freshness, availableMargin }) => {
    const contract = contractFor(symbol);
    if (freshness !== 'live') return { ok: false, errorCode: 'MARK_PRICE_NOT_LIVE', message: '标记价格非实时，暂不可新开仓' };
    const value = positive(notional);
    if (value < contract.minNotional) return { ok: false, errorCode: 'MIN_NOTIONAL', message: `最小名义价值 ${contract.minNotional} USDT` };
    const leverageCheck = validateLeverage(symbol, value, leverage);
    if (!leverageCheck.ok) return { ...leverageCheck, message: `当前风险档位最高 ${leverageCheck.maxLeverage}x` };
    const requiredMargin = value / leverageCheck.leverage;
    if (positive(availableMargin) + EPSILON < requiredMargin) {
      return { ok: false, errorCode: 'INSUFFICIENT_MARGIN', requiredMargin, availableMargin: positive(availableMargin) };
    }
    return { ok: true, requiredMargin, leverage: leverageCheck.leverage, tier: leverageCheck.tier };
  };

  window.AtlasPerpetualRisk = Object.freeze({
    CONTRACTS,
    LIQUIDATION_FEE_RATE,
    getContract: symbol => contractFor(symbol),
    getTier,
    validateLeverage,
    weightedEntry,
    realizedPnl,
    calculatePosition,
    calculateAccount,
    calculateLiquidationPrice: input => calculatePosition(input).liquidationPrice,
    canOpen,
  });

  document.documentElement.dataset.perpetualRisk = 'ready';
})();
