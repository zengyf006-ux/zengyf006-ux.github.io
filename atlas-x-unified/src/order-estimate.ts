import { Decimal } from 'decimal.js';
import { decimalString, parseDecimal, type DecimalString } from './decimal.js';
import type { OrderBookLevelInput } from './orderbook.js';

export interface OrderEstimateInput {
  readonly side: 'buy' | 'sell';
  readonly orderType: 'market' | 'limit';
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly feeRate: string;
  readonly availableBase: string;
  readonly availableQuote: string;
  readonly orderBook: {
    readonly bids: readonly OrderBookLevelInput[];
    readonly asks: readonly OrderBookLevelInput[];
  };
}

export interface OrderEstimate {
  readonly requestedQuantity: DecimalString;
  readonly filledQuantity: DecimalString;
  readonly unfilledQuantity: DecimalString;
  readonly grossAmount: DecimalString;
  readonly vwap: DecimalString | null;
  readonly referencePrice: DecimalString | null;
  readonly slippageRate: DecimalString | null;
  readonly fee: DecimalString;
  readonly coverageRate: DecimalString;
  readonly requiredBalance: DecimalString;
  readonly availableBalance: DecimalString;
  readonly insufficientBalance: boolean;
  readonly depthInsufficient: boolean;
}

function positive(value: string, label: string): Decimal {
  try {
    const parsed = parseDecimal(value);
    if (!parsed.greaterThan(0)) throw new Error('not positive');
    return parsed;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function nonNegative(value: string, label: string): Decimal {
  try {
    const parsed = parseDecimal(value);
    if (parsed.isNegative()) throw new Error('negative');
    return parsed;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function rate(value: string, label: string): Decimal {
  const parsed = nonNegative(value, label);
  if (parsed.greaterThan(1)) throw new Error(`Invalid ${label}`);
  return parsed;
}

interface ParsedLevel {
  readonly price: Decimal;
  readonly quantity: Decimal;
}

function parseLevels(levels: readonly OrderBookLevelInput[], side: 'buy' | 'sell'): ParsedLevel[] {
  const parsed = levels.map((level) => ({
    price: positive(level.price, 'order book level'),
    quantity: positive(level.quantity, 'order book level'),
  }));
  return parsed.sort((left, right) => {
    const comparison = left.price.comparedTo(right.price);
    return side === 'buy' ? comparison : -comparison;
  });
}

export function estimateOrder(input: OrderEstimateInput): OrderEstimate {
  const requested = positive(input.quantity, 'quantity');
  const feeRate = rate(input.feeRate, 'fee rate');
  const availableBase = nonNegative(input.availableBase, 'base balance');
  const availableQuote = nonNegative(input.availableQuote, 'quote balance');
  const limitPrice = input.orderType === 'limit'
    ? positive(input.limitPrice ?? '', 'limit price')
    : null;

  const levels = parseLevels(input.side === 'buy' ? input.orderBook.asks : input.orderBook.bids, input.side)
    .filter((level) => {
      if (limitPrice === null) return true;
      return input.side === 'buy'
        ? level.price.lessThanOrEqualTo(limitPrice)
        : level.price.greaterThanOrEqualTo(limitPrice);
    });

  let remaining = requested;
  let filled = new Decimal(0);
  let gross = new Decimal(0);

  for (const level of levels) {
    if (remaining.isZero()) break;
    const fillQuantity = Decimal.min(remaining, level.quantity);
    filled = filled.plus(fillQuantity);
    gross = gross.plus(fillQuantity.times(level.price));
    remaining = remaining.minus(fillQuantity);
  }

  const reference = levels[0]?.price ?? null;
  const vwap = filled.isZero() ? null : gross.dividedBy(filled);
  const slippage = vwap === null || reference === null
    ? null
    : input.side === 'buy'
      ? vwap.minus(reference).dividedBy(reference)
      : reference.minus(vwap).dividedBy(reference);
  const fee = gross.times(feeRate);
  const coverage = filled.dividedBy(requested);

  let requiredBalance: Decimal;
  let availableBalance: Decimal;
  if (input.side === 'buy') {
    requiredBalance = input.orderType === 'limit' && limitPrice !== null
      ? requested.times(limitPrice).times(new Decimal(1).plus(feeRate))
      : gross.plus(fee);
    availableBalance = availableQuote;
  } else {
    requiredBalance = requested;
    availableBalance = availableBase;
  }

  return {
    requestedQuantity: decimalString(requested),
    filledQuantity: decimalString(filled),
    unfilledQuantity: decimalString(remaining),
    grossAmount: decimalString(gross),
    vwap: vwap === null ? null : decimalString(vwap),
    referencePrice: reference === null ? null : decimalString(reference),
    slippageRate: slippage === null ? null : decimalString(slippage),
    fee: decimalString(fee),
    coverageRate: decimalString(coverage),
    requiredBalance: decimalString(requiredBalance),
    availableBalance: decimalString(availableBalance),
    insufficientBalance: requiredBalance.greaterThan(availableBalance),
    depthInsufficient: filled.lessThan(requested),
  };
}
