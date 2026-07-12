export const SCHEMA_VERSION = 'atlas.unified.v1';
export const DECIMAL_FORMAT = 'atlas-decimal-34';
export const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
export const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
export const object = (required, properties) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
export const timestamp = { type: 'string', format: 'date-time' };
export const identifier = { type: 'string', minLength: 1 };
export const decimal = ref('DecimalString');
export const nonNegative = ref('NonNegativeDecimalString');
export const positive = ref('PositiveDecimalString');
