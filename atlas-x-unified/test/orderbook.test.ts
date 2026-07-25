import { describe, expect, it } from 'vitest';
import { aggregateOrderBook } from '../src/orderbook.js';

describe('aggregateOrderBook', () => {
  it('aggregates bids down and asks up to the tick with exact cumulative quantities', () => {
    const input = {
      tickSize: '0.5',
      bids: [
        { price: '100.49', quantity: '0.1' },
        { price: '100.4', quantity: '0.2' },
        { price: '99.99', quantity: '0.3' },
      ],
      asks: [
        { price: '100.01', quantity: '0.4' },
        { price: '100.49', quantity: '0.6' },
        { price: '100.51', quantity: '0.5' },
      ],
    } as const;

    expect(aggregateOrderBook(input)).toEqual({
      tickSize: '0.5',
      bids: [
        { price: '100', quantity: '0.3', cumulativeQuantity: '0.3' },
        { price: '99.5', quantity: '0.3', cumulativeQuantity: '0.6' },
      ],
      asks: [
        { price: '100.5', quantity: '1', cumulativeQuantity: '1' },
        { price: '101', quantity: '0.5', cumulativeQuantity: '1.5' },
      ],
    });
  });

  it('sorts unsorted levels deterministically and does not mutate input', () => {
    const input = {
      tickSize: '1',
      bids: [
        { price: '98', quantity: '1' },
        { price: '100', quantity: '2' },
        { price: '99', quantity: '3' },
      ],
      asks: [
        { price: '103', quantity: '1' },
        { price: '101', quantity: '2' },
        { price: '102', quantity: '3' },
      ],
    };
    const before = structuredClone(input);

    const output = aggregateOrderBook(input);

    expect(input).toEqual(before);
    expect(output.bids.map((level) => level.price)).toEqual(['100', '99', '98']);
    expect(output.asks.map((level) => level.price)).toEqual(['101', '102', '103']);
  });

  it.each(['0', '-0.1', '', '1e-3'])('rejects invalid tick size %s', (tickSize) => {
    expect(() => aggregateOrderBook({ tickSize, bids: [], asks: [] })).toThrow(/tick/i);
  });

  it.each([
    { price: '0', quantity: '1' },
    { price: '-1', quantity: '1' },
    { price: '1', quantity: '0' },
    { price: '1', quantity: '-1' },
    { price: 'NaN', quantity: '1' },
  ])('rejects invalid level %j', (level) => {
    expect(() => aggregateOrderBook({ tickSize: '1', bids: [level], asks: [] })).toThrow(/level/i);
  });
});
