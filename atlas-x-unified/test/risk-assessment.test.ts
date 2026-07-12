import { describe, expect, it } from 'vitest';
import { assessSpotLongRisk, RiskCalculationError } from '../src/risk-position.js';
import { parseDecimal } from '../src/decimal.js';

const base = {
  equity: '1000',
  availableCash: '800',
  entryPrice: '100',
  stopPrice: '90',
  riskRate: '0.01',
  entryFeeRate: '0.001',
  exitFeeRate: '0.002',
} as const;

describe('spot long risk assessment', () => {
  it('uses equity for risk and cash for capital cap', () => {
    const result = assessSpotLongRisk(base);
    expect(result.schemaVersion).toBe('atlas.unified.v1');
    expect(result.riskBudget).toBe('10');
    expect(result.unitRisk).toBe('10.28');
    expect(result.quantityByRisk).toBe('0.972762645914396887159533073929961');
    expect(result.quantityByBalance).toBe('7.992007992007992007992007992007992');
    expect(result.bindingConstraint).toBe('risk');
    expect(parseDecimal(result.totalCapital).lessThanOrEqualTo(parseDecimal('800'))).toBe(true);
    expect(parseDecimal(result.riskAmount).lessThanOrEqualTo(parseDecimal('10'))).toBe(true);
  });

  it('includes independent entry and stop-exit fees in unit risk', () => {
    const result = assessSpotLongRisk(base);
    expect(result.stopDistance).toBe('10');
    expect(result.entryFee).toBe('0.0972762645914396887159533073929961');
    expect(result.exitFeeAtStop).toBe('0.175097276264591439688715953307393');
    expect(result.riskAmount).toBe('9.999999999999999999999999999999999');
  });

  it('calculates fee-aware reward and ratio', () => {
    const result = assessSpotLongRisk({ ...base, targetPrice: '130' });
    expect(result.targetPrice).toBe('130');
    expect(result.rewardAmount).toBe('28.83268482490272373540856031128404');
    expect(result.rewardRiskRatio).toBe('2.883268482490272373540856031128405');
  });

  it('leaves reward outputs null when target is omitted', () => {
    const result = assessSpotLongRisk(base);
    expect(result.targetPrice).toBeNull();
    expect(result.rewardAmount).toBeNull();
    expect(result.rewardRiskRatio).toBeNull();
  });

  it('conservatively binds by available cash including entry fee', () => {
    const result = assessSpotLongRisk({ ...base, availableCash: '10', riskRate: '1' });
    expect(result.bindingConstraint).toBe('balance');
    expect(parseDecimal(result.totalCapital).lessThanOrEqualTo(10)).toBe(true);
  });

  it('returns zero for zero equity and cash', () => {
    const result = assessSpotLongRisk({ ...base, equity: '0', availableCash: '0' });
    expect(result.riskBudget).toBe('0');
    expect(result.suggestedQuantity).toBe('0');
    expect(result.totalCapital).toBe('0');
    expect(result.riskAmount).toBe('0');
    expect(result.bindingConstraint).toBe('balance');
  });

  it('preserves precision for extreme small prices', () => {
    const result = assessSpotLongRisk({
      equity: '1',
      availableCash: '1',
      entryPrice: '0.00000001',
      stopPrice: '0.000000009',
      riskRate: '0.01',
      entryFeeRate: '0',
      exitFeeRate: '0',
    });
    expect(result.stopDistance).toBe('0.000000001');
    expect(result.suggestedQuantity).toBe('10000000');
    expect(result.notional).toBe('0.1');
  });

  it.each([
    [{ ...base, stopPrice: '100' }, 'RISK_INVALID_STOP'],
    [{ ...base, stopPrice: '101' }, 'RISK_INVALID_STOP'],
    [{ ...base, targetPrice: '100' }, 'RISK_INVALID_TARGET'],
    [{ ...base, targetPrice: '99' }, 'RISK_INVALID_TARGET'],
    [{ ...base, equity: '10', availableCash: '11' }, 'RISK_INSUFFICIENT_EQUITY'],
  ])('throws stable code %#', (input, code) => {
    try {
      assessSpotLongRisk(input as never);
      throw new Error('not thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskCalculationError);
      expect((error as RiskCalculationError).code).toBe(code);
    }
  });

  it.each([
    { ...base, equity: '-1' },
    { ...base, availableCash: '-1' },
    { ...base, entryPrice: '0' },
    { ...base, riskRate: '0' },
    { ...base, riskRate: '1.1' },
    { ...base, entryFeeRate: '-0.1' },
    { ...base, exitFeeRate: '1.1' },
  ])('rejects invalid numeric risk input %j', (input) => {
    expect(() => assessSpotLongRisk(input)).toThrow(/invalid/i);
  });

  it('never overstates available capital or risk budget', () => {
    const result = assessSpotLongRisk({
      equity: '20',
      availableCash: '12.34',
      entryPrice: '3.21',
      stopPrice: '2.98',
      targetPrice: '4',
      riskRate: '0.5',
      entryFeeRate: '0.003',
      exitFeeRate: '0.004',
    });
    expect(parseDecimal(result.totalCapital).lessThanOrEqualTo(parseDecimal('12.34'))).toBe(true);
    expect(parseDecimal(result.riskAmount).lessThanOrEqualTo(parseDecimal(result.riskBudget))).toBe(true);
  });
});
