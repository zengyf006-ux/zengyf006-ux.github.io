import { Decimal } from 'decimal.js';

export type DecimalString = string & { readonly __decimalString: unique symbol };

const DECIMAL_INPUT = /^-?\d+(?:\.\d+)?$/;
const CANONICAL_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;

export class DecimalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalInputError';
  }
}

export function parseDecimal(value: unknown): Decimal {
  if (typeof value !== 'string' || !DECIMAL_INPUT.test(value)) {
    throw new DecimalInputError('Invalid decimal string');
  }

  const parsed = new Decimal(value);
  if (!parsed.isFinite()) {
    throw new DecimalInputError('Decimal string must be finite');
  }
  return parsed;
}

export function decimalString(value: Decimal): DecimalString {
  if (!value.isFinite()) {
    throw new DecimalInputError('Decimal value must be finite');
  }

  if (value.isZero()) return '0' as DecimalString;

  const normalized = value.toFixed().replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');
  if (!CANONICAL_DECIMAL.test(normalized)) {
    throw new DecimalInputError('Unable to create canonical decimal string');
  }
  return normalized as DecimalString;
}

export function addDecimal(left: string, right: string): DecimalString {
  return decimalString(parseDecimal(left).plus(parseDecimal(right)));
}

export function subtractDecimal(left: string, right: string): DecimalString {
  return decimalString(parseDecimal(left).minus(parseDecimal(right)));
}

export function multiplyDecimal(left: string, right: string): DecimalString {
  return decimalString(parseDecimal(left).times(parseDecimal(right)));
}

export function divideDecimal(left: string, right: string): DecimalString {
  const divisor = parseDecimal(right);
  if (divisor.isZero()) {
    throw new DecimalInputError('Division by zero');
  }
  return decimalString(parseDecimal(left).dividedBy(divisor));
}
