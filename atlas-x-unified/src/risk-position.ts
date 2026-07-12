import { Decimal } from 'decimal.js';
import { decimalString, parseDecimal, type DecimalString } from './decimal.js';

export interface SpotLongRiskInput {
  readonly availableQuote: string;
  readonly entryPrice: string;
  readonly stopPrice: string;
  readonly riskRate: string;
  readonly feeRate: string;
}

export interface SpotLongRiskResult {
  readonly riskBudget: DecimalString;
  readonly stopDistance: DecimalString;
  readonly unitRisk: DecimalString;
  readonly quantityByRisk: DecimalString;
  readonly quantityByBalance: DecimalString;
  readonly suggestedQuantity: DecimalString;
  readonly notional: DecimalString;
  readonly entryFee: DecimalString;
  readonly totalCapital: DecimalString;
  readonly bindingConstraint: 'risk' | 'balance';
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

function boundedRate(value: string, label: string, allowZero: boolean): Decimal {
  const parsed = allowZero ? nonNegative(value, label) : positive(value, label);
  if (parsed.greaterThan(1)) throw new Error(`Invalid ${label}`);
  return parsed;
}

export function calculateSpotLongPosition(input: SpotLongRiskInput): SpotLongRiskResult {
  const available = nonNegative(input.availableQuote, 'available quote balance');
  const entry = positive(input.entryPrice, 'entry price');
  const stop = positive(input.stopPrice, 'stop price');
  if (!stop.lessThan(entry)) throw new Error('Invalid stop price');
  const riskRate = boundedRate(input.riskRate, 'risk rate', false);
  const feeRate = boundedRate(input.feeRate, 'fee rate', true);

  const riskBudget = available.times(riskRate);
  const stopDistance = entry.minus(stop);
  const unitRisk = stopDistance
    .plus(entry.times(feeRate))
    .plus(stop.times(feeRate));
  const quantityByRisk = riskBudget.dividedBy(unitRisk);
  const balanceUnitCost = entry.times(new Decimal(1).plus(feeRate));
  const quantityByBalance = available.dividedBy(balanceUnitCost);
  const balanceBinds = quantityByBalance.lessThanOrEqualTo(quantityByRisk);
  const suggestedQuantity = balanceBinds ? quantityByBalance : quantityByRisk;
  const notional = suggestedQuantity.times(entry);
  const entryFee = notional.times(feeRate);
  const totalCapital = notional.plus(entryFee);

  if (totalCapital.greaterThan(available)) {
    throw new Error('Calculated position exceeds available balance');
  }

  return {
    riskBudget: decimalString(riskBudget),
    stopDistance: decimalString(stopDistance),
    unitRisk: decimalString(unitRisk),
    quantityByRisk: decimalString(quantityByRisk),
    quantityByBalance: decimalString(quantityByBalance),
    suggestedQuantity: decimalString(suggestedQuantity),
    notional: decimalString(notional),
    entryFee: decimalString(entryFee),
    totalCapital: decimalString(totalCapital),
    bindingConstraint: balanceBinds ? 'balance' : 'risk',
  };
}
