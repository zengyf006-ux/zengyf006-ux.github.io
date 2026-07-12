import { describe, expect, it } from 'vitest';
import {
  addDecimal,
  decimalString,
  divideDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from '../src/decimal.js';

describe('canonical decimal boundary', () => {
  it('adds decimal fractions without floating-point drift', () => {
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
  });

  it.each([
    ['00012.3400', '12.34'],
    ['-00012.3400', '-12.34'],
    ['0000.0000', '0'],
    ['-0', '0'],
    ['-0.000', '0'],
    ['42.000', '42'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(decimalString(parseDecimal(input))).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '.1',
    '1.',
    '+1',
    '1e3',
    'NaN',
    'Infinity',
    '--1',
    null,
    undefined,
    1,
  ])('rejects invalid decimal input %j', (input) => {
    expect(() => parseDecimal(input)).toThrow(/decimal/i);
  });

  it('supports exact subtract, multiply and divide operations', () => {
    expect(subtractDecimal('1', '0.9')).toBe('0.1');
    expect(multiplyDecimal('0.07', '0.08')).toBe('0.0056');
    expect(divideDecimal('1', '8')).toBe('0.125');
  });

  it('throws an explicit division-by-zero error', () => {
    expect(() => divideDecimal('1', '0')).toThrow(/division by zero/i);
  });
});
