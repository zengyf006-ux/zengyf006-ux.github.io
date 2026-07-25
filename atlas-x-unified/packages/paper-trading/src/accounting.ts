import type { DomainError, EventMetadata, Order, OrderDraft, Reservation } from '@atlas-x/contracts';
import { decimalString, parseDecimal, SCHEMA_VERSION } from '@atlas-x/domain';
import { PaperTradingLedgerError } from './errors.js';
import type { PaperPositionRecord, PaperTradingLedgerState } from './types.js';

export const PAPER_LEDGER_PROVIDER = 'atlas-paper-ledger';
type DomainErrorCode = DomainError['code'];
type ParsedDecimal = ReturnType<typeof parseDecimal>;

export function parsePaperDecimal(value: string, label: string, allowZero = true): ParsedDecimal {
  try {
    const parsed = parseDecimal(value);
    if (parsed.isNegative() || (!allowZero && parsed.isZero())) throw new Error('out of range');
    return parsed;
  } catch {
    throw new PaperTradingLedgerError('ORDER_INVALID', `Invalid ${label}`);
  }
}

export function paperDomainError(code: DomainErrorCode, message: string, field?: string): DomainError {
  return {
    schemaVersion: SCHEMA_VERSION,
    code,
    message,
    ...(field === undefined ? {} : { field }),
    retryable: code === 'STORAGE_FAILURE',
  };
}

export function paperSource() {
  return { truthfulness: 'simulated' as const, provider: PAPER_LEDGER_PROVIDER, scenario: 'paper-trading' };
}

export function paperMetadata(id: string, sequence: number, time: string): EventMetadata {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    source: paperSource(),
    sequence,
    serverTime: time,
    receivedAt: time,
  };
}

export function baseAsset(symbol: string): string {
  const [base] = symbol.split('-');
  if (base === undefined || base.length === 0) {
    throw new PaperTradingLedgerError('ORDER_INVALID', 'Invalid market symbol');
  }
  return base;
}

export function isFinalOrder(status: Order['status']): boolean {
  return ['filled', 'canceled', 'expired', 'rejected', 'failed'].includes(status);
}

export function reservePriceForDraft(draft: OrderDraft, referencePrice: string): string {
  if (draft.type === 'limit' || draft.type === 'stopLimit') return draft.price;
  return referencePrice;
}

export function sumReservation(
  state: PaperTradingLedgerState,
  predicate: (reservation: Reservation) => boolean,
): ParsedDecimal {
  return Object.values(state.reservations)
    .filter(predicate)
    .reduce((total, reservation) => total.plus(parseDecimal(reservation.amount)), parseDecimal('0'));
}

export function availableCash(state: PaperTradingLedgerState): ParsedDecimal {
  const baseCurrency = state.baseCurrency ?? '';
  const locked = sumReservation(state, (reservation) => reservation.asset === baseCurrency);
  return parseDecimal(state.cash).minus(locked);
}

export function availableBase(state: PaperTradingLedgerState, symbol: string): ParsedDecimal {
  const asset = baseAsset(symbol);
  const quantity = parseDecimal(state.positions[symbol]?.quantity ?? '0');
  const locked = sumReservation(state, (reservation) => reservation.asset === asset);
  return quantity.minus(locked);
}

export function orderAverageFill(order: Order, price: string, quantity: string): string {
  const oldQuantity = parseDecimal(order.filledQuantity);
  const addedQuantity = parseDecimal(quantity);
  const totalQuantity = oldQuantity.plus(addedQuantity);
  const oldGross = order.averageFillPrice === null || order.averageFillPrice === undefined
    ? parseDecimal('0')
    : parseDecimal(order.averageFillPrice).times(oldQuantity);
  return decimalString(oldGross.plus(parseDecimal(price).times(addedQuantity)).dividedBy(totalQuantity));
}

export function positionAfterBuy(
  previous: PaperPositionRecord | undefined,
  symbol: string,
  quantity: string,
  gross: ParsedDecimal,
  fee: ParsedDecimal,
  price: string,
  time: string,
): PaperPositionRecord {
  const oldQuantity = parseDecimal(previous?.quantity ?? '0');
  const added = parseDecimal(quantity);
  const nextQuantity = oldQuantity.plus(added);
  const oldCost = previous?.averageEntryPrice === null || previous?.averageEntryPrice === undefined
    ? parseDecimal('0')
    : parseDecimal(previous.averageEntryPrice).times(oldQuantity);
  const average = oldCost.plus(gross).plus(fee).dividedBy(nextQuantity);
  return {
    symbol,
    quantity: decimalString(nextQuantity),
    averageEntryPrice: decimalString(average),
    realizedPnl: previous?.realizedPnl ?? '0',
    marketPrice: price,
    updatedAt: time,
  };
}

export function positionAfterSell(
  previous: PaperPositionRecord,
  symbol: string,
  quantity: string,
  gross: ParsedDecimal,
  fee: ParsedDecimal,
  price: string,
  time: string,
): PaperPositionRecord {
  const sold = parseDecimal(quantity);
  const nextQuantity = parseDecimal(previous.quantity).minus(sold);
  const averageEntry = previous.averageEntryPrice === null ? parseDecimal('0') : parseDecimal(previous.averageEntryPrice);
  const realized = parseDecimal(previous.realizedPnl).plus(gross).minus(fee).minus(averageEntry.times(sold));
  return {
    symbol,
    quantity: decimalString(nextQuantity),
    averageEntryPrice: nextQuantity.isZero() ? null : previous.averageEntryPrice,
    realizedPnl: decimalString(realized),
    marketPrice: price,
    updatedAt: time,
  };
}
