import { Decimal } from 'decimal.js';
import { decimalString, parseDecimal, type DecimalString } from './decimal.js';

export interface OrderBookLevelInput {
  readonly price: string;
  readonly quantity: string;
}

export interface OrderBookAggregationInput {
  readonly tickSize: string;
  readonly bids: readonly OrderBookLevelInput[];
  readonly asks: readonly OrderBookLevelInput[];
}

export interface AggregatedOrderBookLevel {
  readonly price: DecimalString;
  readonly quantity: DecimalString;
  readonly cumulativeQuantity: DecimalString;
}

export interface AggregatedOrderBook {
  readonly tickSize: DecimalString;
  readonly bids: readonly AggregatedOrderBookLevel[];
  readonly asks: readonly AggregatedOrderBookLevel[];
}

function parsePositive(value: string, context: 'tick' | 'level'): Decimal {
  try {
    const parsed = parseDecimal(value);
    if (!parsed.greaterThan(0)) throw new Error('not positive');
    return parsed;
  } catch {
    throw new Error(context === 'tick' ? 'Invalid tick size' : 'Invalid order book level');
  }
}

function aggregateSide(
  levels: readonly OrderBookLevelInput[],
  tick: Decimal,
  side: 'bid' | 'ask',
): AggregatedOrderBookLevel[] {
  const grouped = new Map<string, Decimal>();

  for (const level of levels) {
    const price = parsePositive(level.price, 'level');
    const quantity = parsePositive(level.quantity, 'level');
    const units = price.dividedBy(tick);
    const bucketUnits = side === 'bid' ? units.floor() : units.ceil();
    const bucketPrice = bucketUnits.times(tick);
    if (!bucketPrice.greaterThan(0)) throw new Error('Invalid order book level');
    const key = decimalString(bucketPrice);
    grouped.set(key, (grouped.get(key) ?? new Decimal(0)).plus(quantity));
  }

  const sorted = [...grouped.entries()].sort(([left], [right]) => {
    const comparison = parseDecimal(left).comparedTo(parseDecimal(right));
    return side === 'bid' ? -comparison : comparison;
  });

  let cumulative = new Decimal(0);
  return sorted.map(([price, quantity]) => {
    cumulative = cumulative.plus(quantity);
    return {
      price: price as DecimalString,
      quantity: decimalString(quantity),
      cumulativeQuantity: decimalString(cumulative),
    };
  });
}

export function aggregateOrderBook(input: OrderBookAggregationInput): AggregatedOrderBook {
  const tick = parsePositive(input.tickSize, 'tick');
  return {
    tickSize: decimalString(tick),
    bids: aggregateSide(input.bids, tick, 'bid'),
    asks: aggregateSide(input.asks, tick, 'ask'),
  };
}
