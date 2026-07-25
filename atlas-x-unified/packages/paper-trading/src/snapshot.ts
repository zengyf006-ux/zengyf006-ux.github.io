import type { AccountAsset, AccountSnapshot, AppSnapshot, Position } from '@atlas-x/contracts';
import { decimalString, parseDecimal, SCHEMA_VERSION } from '@atlas-x/domain';
import { availableCash, baseAsset, paperMetadata, paperSource, sumReservation } from './accounting.js';
import type { PaperTradingLedgerOptions, PaperTradingLedgerState } from './types.js';

export function createPaperAccountSnapshot(
  state: PaperTradingLedgerState,
  options: Pick<PaperTradingLedgerOptions, 'accountId' | 'baseCurrency' | 'now'>,
): AccountSnapshot {
  const time = state.lastOccurredAt ?? options.now();
  const sequence = state.lastSequence;
  const accountMetadata = paperMetadata(`account-${options.accountId}-${sequence}`, sequence, time);
  const reservations = Object.values(state.reservations);
  const positions: Position[] = Object.values(state.positions).map((position) => {
    const quantity = parseDecimal(position.quantity);
    const marketPrice = position.marketPrice === null ? null : parseDecimal(position.marketPrice);
    const average = position.averageEntryPrice === null ? null : parseDecimal(position.averageEntryPrice);
    const marketValue = marketPrice === null ? parseDecimal('0') : quantity.times(marketPrice);
    const unrealized = marketPrice === null || average === null ? null : marketPrice.minus(average).times(quantity);
    return {
      schemaVersion: SCHEMA_VERSION,
      positionId: `position-${position.symbol}`,
      symbol: position.symbol,
      side: 'long',
      quantity: decimalString(quantity),
      averageEntryPrice: position.averageEntryPrice,
      marketPrice: position.marketPrice,
      marketValue: decimalString(marketValue),
      realizedPnl: decimalString(parseDecimal(position.realizedPnl)),
      unrealizedPnl: unrealized === null ? null : decimalString(unrealized),
      updatedAt: position.updatedAt,
    };
  });

  const quoteLocked = sumReservation(state, (reservation) => reservation.asset === options.baseCurrency);
  const assets: AccountAsset[] = [{
    metadata: accountMetadata,
    accountId: options.accountId,
    asset: options.baseCurrency,
    available: decimalString(parseDecimal(state.cash).minus(quoteLocked)),
    locked: decimalString(quoteLocked),
    total: decimalString(parseDecimal(state.cash)),
  }];

  for (const position of positions) {
    if (parseDecimal(position.quantity).isZero()) continue;
    const asset = baseAsset(position.symbol);
    const locked = sumReservation(state, (reservation) => reservation.asset === asset);
    assets.push({
      metadata: accountMetadata,
      accountId: options.accountId,
      asset,
      available: decimalString(parseDecimal(position.quantity).minus(locked)),
      locked: decimalString(locked),
      total: position.quantity,
    });
  }

  const equity = positions.reduce(
    (total, position) => total.plus(parseDecimal(position.marketValue)),
    parseDecimal(state.cash),
  );
  return {
    metadata: accountMetadata,
    accountId: options.accountId,
    baseCurrency: options.baseCurrency,
    equity: decimalString(equity),
    availableCash: decimalString(availableCash(state)),
    assets,
    positions,
    reservations,
  };
}

export function createPaperAppSnapshot(
  state: PaperTradingLedgerState,
  options: Pick<PaperTradingLedgerOptions, 'accountId' | 'baseCurrency' | 'now'>,
): AppSnapshot {
  const time = state.lastOccurredAt ?? options.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: time,
    marketConnection: {
      schemaVersion: SCHEMA_VERSION,
      state: 'offline',
      source: paperSource(),
      updatedAt: time,
    },
    markets: [],
    account: createPaperAccountSnapshot(state, options),
    orders: Object.values(state.orders).map((record) => record.order),
    fills: [...state.fills],
    strategies: [],
    alerts: [],
  };
}
