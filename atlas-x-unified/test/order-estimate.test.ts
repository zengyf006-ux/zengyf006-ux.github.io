import { describe, expect, it } from 'vitest';
import { estimateOrder } from '../src/order-estimate.js';

const book = {
  bids: [
    { price: '99', quantity: '2' },
    { price: '98', quantity: '3' },
  ],
  asks: [
    { price: '100', quantity: '1' },
    { price: '101', quantity: '2' },
    { price: '102', quantity: '3' },
  ],
};

describe('estimateOrder', () => {
  it('calculates exact market buy VWAP, slippage, fee and coverage', () => {
    expect(estimateOrder({
      side: 'buy',
      orderType: 'market',
      quantity: '2',
      feeRate: '0.001',
      availableBase: '0',
      availableQuote: '1000',
      orderBook: book,
    })).toEqual({
      requestedQuantity: '2',
      filledQuantity: '2',
      unfilledQuantity: '0',
      grossAmount: '201',
      vwap: '100.5',
      referencePrice: '100',
      slippageRate: '0.005',
      fee: '0.201',
      coverageRate: '1',
      requiredBalance: '201.201',
      availableBalance: '1000',
      insufficientBalance: false,
      depthInsufficient: false,
    });
  });

  it('distinguishes a buy limit order from market depth', () => {
    const result = estimateOrder({
      side: 'buy',
      orderType: 'limit',
      quantity: '4',
      limitPrice: '101',
      feeRate: '0.001',
      availableBase: '0',
      availableQuote: '500',
      orderBook: book,
    });

    expect(result.filledQuantity).toBe('3');
    expect(result.unfilledQuantity).toBe('1');
    expect(result.coverageRate).toBe('0.75');
    expect(result.depthInsufficient).toBe(true);
    expect(result.requiredBalance).toBe('404.404');
  });

  it('calculates sell-side VWAP and flags insufficient base balance', () => {
    const result = estimateOrder({
      side: 'sell',
      orderType: 'market',
      quantity: '4',
      feeRate: '0.002',
      availableBase: '3.5',
      availableQuote: '0',
      orderBook: book,
    });

    expect(result.grossAmount).toBe('394');
    expect(result.vwap).toBe('98.5');
    expect(result.referencePrice).toBe('99');
    expect(result.slippageRate).toBe('0.0050505050505050505051');
    expect(result.fee).toBe('0.788');
    expect(result.requiredBalance).toBe('4');
    expect(result.insufficientBalance).toBe(true);
  });

  it('returns precise partial coverage when market depth is insufficient', () => {
    const result = estimateOrder({
      side: 'buy',
      orderType: 'market',
      quantity: '10',
      feeRate: '0',
      availableBase: '0',
      availableQuote: '10000',
      orderBook: book,
    });

    expect(result.filledQuantity).toBe('6');
    expect(result.unfilledQuantity).toBe('4');
    expect(result.coverageRate).toBe('0.6');
    expect(result.depthInsufficient).toBe(true);
  });

  it('handles an empty book without invented prices', () => {
    expect(estimateOrder({
      side: 'buy',
      orderType: 'market',
      quantity: '1',
      feeRate: '0.001',
      availableBase: '0',
      availableQuote: '10',
      orderBook: { bids: [], asks: [] },
    })).toEqual({
      requestedQuantity: '1',
      filledQuantity: '0',
      unfilledQuantity: '1',
      grossAmount: '0',
      vwap: null,
      referencePrice: null,
      slippageRate: null,
      fee: '0',
      coverageRate: '0',
      requiredBalance: '0',
      availableBalance: '10',
      insufficientBalance: false,
      depthInsufficient: true,
    });
  });

  it('flags insufficient quote balance including fees', () => {
    const result = estimateOrder({
      side: 'buy',
      orderType: 'market',
      quantity: '2',
      feeRate: '0.001',
      availableBase: '0',
      availableQuote: '201.2',
      orderBook: book,
    });
    expect(result.requiredBalance).toBe('201.201');
    expect(result.insufficientBalance).toBe(true);
  });

  it.each([
    { quantity: '0', feeRate: '0' },
    { quantity: '1e2', feeRate: '0' },
    { quantity: '1', feeRate: '-0.1' },
    { quantity: '1', feeRate: '1.1' },
  ])('rejects invalid financial inputs %j', ({ quantity, feeRate }) => {
    expect(() => estimateOrder({
      side: 'buy',
      orderType: 'market',
      quantity,
      feeRate,
      availableBase: '0',
      availableQuote: '100',
      orderBook: book,
    })).toThrow(/invalid/i);
  });

  it('requires a valid limit price for limit orders', () => {
    expect(() => estimateOrder({
      side: 'buy',
      orderType: 'limit',
      quantity: '1',
      feeRate: '0',
      availableBase: '0',
      availableQuote: '100',
      orderBook: book,
    })).toThrow(/limit price/i);
  });
});
