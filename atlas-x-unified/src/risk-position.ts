import { Decimal } from 'decimal.js';
import {
  decimalString,
  parseDecimal,
  quantizeDecimal,
  SCHEMA_VERSION,
  type DecimalString,
} from './decimal.js';

export type RiskErrorCode =
  | 'RISK_INVALID_INPUT'
  | 'RISK_INVALID_STOP'
  | 'RISK_INVALID_TARGET'
  | 'RISK_INSUFFICIENT_EQUITY';

export class RiskCalculationError extends Error {
  constructor(readonly code: RiskErrorCode, message: string) {
    super(message);
    this.name = 'RiskCalculationError';
  }
}

/** @deprecated Retained so milestone-01 Golden Vectors remain executable. */
export interface LegacySpotLongRiskInput {
  readonly availableQuote: string;
  readonly entryPrice: string;
  readonly stopPrice: string;
  readonly riskRate: string;
  readonly feeRate: string;
}

/** @deprecated Retained so milestone-01 Golden Vectors remain executable. */
export interface LegacySpotLongRiskResult {
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

export interface SpotLongRiskInput {
  readonly equity: string;
  readonly availableCash: string;
  readonly entryPrice: string;
  readonly stopPrice: string;
  readonly targetPrice?: string;
  readonly riskRate: string;
  readonly entryFeeRate: string;
  readonly exitFeeRate: string;
}

export interface SpotLongRiskResult {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly equity: DecimalString;
  readonly availableCash: DecimalString;
  readonly riskBudget: DecimalString;
  readonly stopDistance: DecimalString;
  readonly unitRisk: DecimalString;
  readonly quantityByRisk: DecimalString;
  readonly quantityByBalance: DecimalString;
  readonly suggestedQuantity: DecimalString;
  readonly notional: DecimalString;
  readonly entryFee: DecimalString;
  readonly exitFeeAtStop: DecimalString;
  readonly totalCapital: DecimalString;
  readonly riskAmount: DecimalString;
  readonly targetPrice: DecimalString | null;
  readonly rewardAmount: DecimalString | null;
  readonly rewardRiskRatio: DecimalString | null;
  readonly bindingConstraint: 'risk' | 'balance';
}

function invalid(label: string): never {
  throw new RiskCalculationError('RISK_INVALID_INPUT', `Invalid ${label}`);
}

function nonNegative(value: string, label: string): Decimal {
  try {
    const parsed = parseDecimal(value);
    if (parsed.isNegative()) invalid(label);
    return parsed;
  } catch (error) {
    if (error instanceof RiskCalculationError) throw error;
    return invalid(label);
  }
}

function positive(value: string, label: string): Decimal {
  const parsed = nonNegative(value, label);
  if (!parsed.greaterThan(0)) invalid(label);
  return parsed;
}

function rate(value: string, label: string, allowZero: boolean): Decimal {
  const parsed = allowZero ? nonNegative(value, label) : positive(value, label);
  if (parsed.greaterThan(1)) invalid(label);
  return parsed;
}

function calculateLegacy(input: LegacySpotLongRiskInput): LegacySpotLongRiskResult {
  const available = nonNegative(input.availableQuote, 'available quote balance');
  const entry = positive(input.entryPrice, 'entry price');
  const stop = positive(input.stopPrice, 'stop price');
  if (!stop.lessThan(entry)) {
    throw new RiskCalculationError('RISK_INVALID_STOP', 'Invalid stop price');
  }
  const riskRate = rate(input.riskRate, 'risk rate', false);
  const feeRate = rate(input.feeRate, 'fee rate', true);

  const riskBudget = available.times(riskRate);
  const stopDistance = entry.minus(stop);
  const unitRisk = stopDistance.plus(entry.times(feeRate)).plus(stop.times(feeRate));
  const quantityByRisk = quantizeDecimal(riskBudget.dividedBy(unitRisk), Decimal.ROUND_DOWN);
  const balanceUnitCost = entry.times(new Decimal(1).plus(feeRate));
  const quantityByBalance = quantizeDecimal(available.dividedBy(balanceUnitCost), Decimal.ROUND_DOWN);
  const balanceBinds = quantityByBalance.lessThanOrEqualTo(quantityByRisk);
  const suggestedQuantity = balanceBinds ? quantityByBalance : quantityByRisk;
  const notional = suggestedQuantity.times(entry);
  const entryFee = notional.times(feeRate);
  const totalCapital = notional.plus(entryFee);

  if (totalCapital.greaterThan(available)) {
    throw new RiskCalculationError(
      'RISK_INSUFFICIENT_EQUITY',
      'Calculated position exceeds available balance',
    );
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

export function assessSpotLongRisk(input: SpotLongRiskInput): SpotLongRiskResult {
  const equity = nonNegative(input.equity, 'equity');
  const cash = nonNegative(input.availableCash, 'available cash');
  if (cash.greaterThan(equity)) {
    throw new RiskCalculationError('RISK_INSUFFICIENT_EQUITY', 'Available cash exceeds equity');
  }

  const entry = positive(input.entryPrice, 'entry price');
  const stop = positive(input.stopPrice, 'stop price');
  if (!stop.lessThan(entry)) {
    throw new RiskCalculationError('RISK_INVALID_STOP', 'Stop price must be below entry price');
  }
  const target = input.targetPrice === undefined ? null : positive(input.targetPrice, 'target price');
  if (target !== null && !target.greaterThan(entry)) {
    throw new RiskCalculationError('RISK_INVALID_TARGET', 'Target price must be above entry price');
  }

  const riskRate = rate(input.riskRate, 'risk rate', false);
  const entryFeeRate = rate(input.entryFeeRate, 'entry fee rate', true);
  const exitFeeRate = rate(input.exitFeeRate, 'exit fee rate', true);

  const riskBudget = equity.times(riskRate);
  const stopDistance = entry.minus(stop);
  const entryFeePerUnit = entry.times(entryFeeRate);
  const exitFeeAtStopPerUnit = stop.times(exitFeeRate);
  const unitRisk = stopDistance.plus(entryFeePerUnit).plus(exitFeeAtStopPerUnit);
  const quantityByRisk = quantizeDecimal(riskBudget.dividedBy(unitRisk), Decimal.ROUND_DOWN);
  const balanceUnitCost = entry.plus(entryFeePerUnit);
  const quantityByBalance = quantizeDecimal(cash.dividedBy(balanceUnitCost), Decimal.ROUND_DOWN);
  const balanceBinds = quantityByBalance.lessThanOrEqualTo(quantityByRisk);
  const quantity = balanceBinds ? quantityByBalance : quantityByRisk;
  const notional = quantity.times(entry);
  const entryFee = quantity.times(entryFeePerUnit);
  const exitFeeAtStop = quantity.times(exitFeeAtStopPerUnit);
  const totalCapital = notional.plus(entryFee);
  const riskAmount = quantity.times(unitRisk);

  if (totalCapital.greaterThan(cash) || riskAmount.greaterThan(riskBudget)) {
    throw new RiskCalculationError(
      'RISK_INSUFFICIENT_EQUITY',
      'Calculated position exceeds conservative limits',
    );
  }

  let rewardAmount: Decimal | null = null;
  let rewardRiskRatio: Decimal | null = null;
  if (target !== null) {
    const exitFeeAtTarget = quantity.times(target).times(exitFeeRate);
    rewardAmount = quantity.times(target.minus(entry)).minus(entryFee).minus(exitFeeAtTarget);
    if (rewardAmount.isNegative()) rewardAmount = new Decimal(0);
    rewardRiskRatio = riskAmount.isZero() ? new Decimal(0) : rewardAmount.dividedBy(riskAmount);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    equity: decimalString(equity),
    availableCash: decimalString(cash),
    riskBudget: decimalString(riskBudget),
    stopDistance: decimalString(stopDistance),
    unitRisk: decimalString(unitRisk),
    quantityByRisk: decimalString(quantityByRisk),
    quantityByBalance: decimalString(quantityByBalance),
    suggestedQuantity: decimalString(quantity),
    notional: decimalString(notional),
    entryFee: decimalString(entryFee),
    exitFeeAtStop: decimalString(exitFeeAtStop),
    totalCapital: decimalString(totalCapital),
    riskAmount: decimalString(riskAmount),
    targetPrice: target === null ? null : decimalString(target),
    rewardAmount: rewardAmount === null ? null : decimalString(rewardAmount),
    rewardRiskRatio: rewardRiskRatio === null ? null : decimalString(rewardRiskRatio),
    bindingConstraint: balanceBinds ? 'balance' : 'risk',
  };
}

export function calculateSpotLongPosition(input: LegacySpotLongRiskInput): LegacySpotLongRiskResult;
export function calculateSpotLongPosition(input: SpotLongRiskInput): SpotLongRiskResult;
export function calculateSpotLongPosition(
  input: LegacySpotLongRiskInput | SpotLongRiskInput,
): LegacySpotLongRiskResult | SpotLongRiskResult {
  return 'equity' in input ? assessSpotLongRisk(input) : calculateLegacy(input);
}
