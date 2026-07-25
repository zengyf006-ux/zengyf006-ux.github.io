import { Decimal } from 'decimal.js';

export type DecimalString = string & { readonly __decimalString: unique symbol };

export const SCHEMA_VERSION = 'atlas.unified.v1' as const;
export const ATLAS_DECIMAL_FORMAT = 'atlas-decimal-34' as const;
export const DECIMAL_PRECISION = 34;
export const DECIMAL_INTERNAL_PRECISION = 80;
export const DECIMAL_ROUNDING = Decimal.ROUND_HALF_UP;

Decimal.set({ precision: DECIMAL_INTERNAL_PRECISION, rounding: DECIMAL_ROUNDING });

const DECIMAL_INPUT = /^-?\d+(?:\.\d+)?$/;
const CANONICAL_DECIMAL = /^(?:0|-?(?:0\.\d*[1-9]|[1-9]\d*(?:\.\d*[1-9])?))$/;

export class DecimalInputError extends Error {
  readonly code = 'DECIMAL_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'DecimalInputError';
  }
}

export function countSignificantDigits(value: string): number {
  const unsigned = value.replace(/^-/, '');
  const [integer = '', fraction = ''] = unsigned.split('.');
  const combined = (integer + fraction).replace(/^0+/, '');
  return combined.length === 0 ? 1 : combined.length;
}

export function isCanonicalDecimalString(value: unknown): value is DecimalString {
  return typeof value === 'string'
    && CANONICAL_DECIMAL.test(value)
    && countSignificantDigits(value) <= DECIMAL_PRECISION;
}

export function parseDecimal(value: unknown): Decimal {
  if (typeof value !== 'string' || !DECIMAL_INPUT.test(value)) {
    throw new DecimalInputError('Invalid decimal string');
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new DecimalInputError('Decimal string must be finite');
  if (parsed.sd() > DECIMAL_PRECISION) {
    throw new DecimalInputError(`Decimal string exceeds ${DECIMAL_PRECISION} significant digits`);
  }
  return parsed;
}

export function quantizeDecimal(
  value: Decimal,
  rounding: Decimal.Rounding = DECIMAL_ROUNDING,
): Decimal {
  if (!value.isFinite()) throw new DecimalInputError('Decimal value must be finite');
  return value.toSignificantDigits(DECIMAL_PRECISION, rounding);
}

function formatDecimal(value: Decimal): DecimalString {
  if (value.isZero()) return '0' as DecimalString;
  const normalized = value.toFixed().replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');
  if (!isCanonicalDecimalString(normalized)) {
    throw new DecimalInputError('Unable to create canonical decimal string');
  }
  return normalized;
}

export function decimalString(value: Decimal): DecimalString {
  return formatDecimal(quantizeDecimal(value));
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
  if (divisor.isZero()) throw new DecimalInputError('Division by zero');
  return decimalString(parseDecimal(left).dividedBy(divisor));
}
