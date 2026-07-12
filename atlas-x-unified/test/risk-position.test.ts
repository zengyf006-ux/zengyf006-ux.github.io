import { describe, expect, it } from 'vitest';
import { calculateSpotLongPosition } from '../src/risk-position.js';
import { parseDecimal } from '../src/decimal.js';

describe('calculateSpotLongPosition', () => {
  it('calculates an exact risk-budget constrained spot long position', () => {
    expect(calculateSpotLongPosition({
      availableQuote: '1000',
      entryPrice: '100',
      stopPrice: '90',
      riskRate: '0.01',
      feeRate: '0',
    })).toEqual({
      riskBudget: '10',
      stopDistance: '10',
      unitRisk: '10',
      quantityByRisk: '1',
      quantityByBalance: '10',
      suggestedQuantity: '1',
      notional: '100',
      entryFee: '0',
      totalCapital: '100',
      bindingConstraint: 'risk',
    });
  });

  it('includes entry and stop-exit fees in unit risk', () => {
    const result = calculateSpotLongPosition({
      availableQuote: '1000',
      entryPrice: '100',
      stopPrice: '90',
      riskRate: '0.01',
      feeRate: '0.001',
    });

    expect(result.riskBudget).toBe('10');
    expect(result.unitRisk).toBe('10.19');
    expect(result.suggestedQuantity).toBe('0.98135426889106967615');
    expect(result.totalCapital).toBe('98.233562315996074583');
    expect(result.bindingConstraint).toBe('risk');
  });

  it('caps the suggestion by fee-adjusted available balance', () => {
    const result = calculateSpotLongPosition({
      availableQuote: '1000',
      entryPrice: '100',
      stopPrice: '99',
      riskRate: '1',
      feeRate: '0.001',
    });

    expect(result.quantityByBalance).toBe('9.99000999000999001');
    expect(result.suggestedQuantity).toBe(result.quantityByBalance);
    expect(result.totalCapital).toBe('1000');
    expect(result.bindingConstraint).toBe('balance');
  });

  it('returns a zero position for zero available balance', () => {
    const result = calculateSpotLongPosition({
      availableQuote: '0',
      entryPrice: '100',
      stopPrice: '90',
      riskRate: '0.01',
      feeRate: '0.001',
    });

    expect(result.riskBudget).toBe('0');
    expect(result.suggestedQuantity).toBe('0');
    expect(result.totalCapital).toBe('0');
    expect(result.bindingConstraint).toBe('balance');
  });

  it('preserves precision for extreme small prices', () => {
    const result = calculateSpotLongPosition({
      availableQuote: '1',
      entryPrice: '0.00000001',
      stopPrice: '0.000000009',
      riskRate: '0.01',
      feeRate: '0',
    });

    expect(result.stopDistance).toBe('0.000000001');
    expect(result.suggestedQuantity).toBe('10000000');
    expect(result.notional).toBe('0.1');
  });

  it.each([
    { availableQuote: '-1', entryPrice: '100', stopPrice: '90', riskRate: '0.01', feeRate: '0' },
    { availableQuote: '1', entryPrice: '0', stopPrice: '0', riskRate: '0.01', feeRate: '0' },
    { availableQuote: '1', entryPrice: '100', stopPrice: '100', riskRate: '0.01', feeRate: '0' },
    { availableQuote: '1', entryPrice: '100', stopPrice: '101', riskRate: '0.01', feeRate: '0' },
    { availableQuote: '1', entryPrice: '100', stopPrice: '90', riskRate: '0', feeRate: '0' },
    { availableQuote: '1', entryPrice: '100', stopPrice: '90', riskRate: '1.1', feeRate: '0' },
    { availableQuote: '1', entryPrice: '100', stopPrice: '90', riskRate: '0.1', feeRate: '-0.1' },
  ])('rejects invalid risk input %j', (input) => {
    expect(() => calculateSpotLongPosition(input)).toThrow(/invalid/i);
  });

  it('never overstates available capital', () => {
    const result = calculateSpotLongPosition({
      availableQuote: '12.34',
      entryPrice: '3.21',
      stopPrice: '2.98',
      riskRate: '0.5',
      feeRate: '0.003',
    });
    expect(parseDecimal(result.totalCapital).lessThanOrEqualTo(parseDecimal('12.34'))).toBe(true);
  });
});
