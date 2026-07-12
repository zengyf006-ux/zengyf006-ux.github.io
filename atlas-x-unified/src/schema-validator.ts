import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { ATLAS_DECIMAL_FORMAT, isCanonicalDecimalString } from './decimal.js';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ErrorObject[];
}

export interface OpenApiComponentValidator {
  validate(schemaName: string, value: unknown): ValidationResult;
}

type JsonObject = Record<string, unknown>;

function rewriteOpenApiRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteOpenApiRefs);
  if (value === null || typeof value !== 'object') return value;

  const output: JsonObject = {};
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key === '$ref' && typeof child === 'string') {
      output[key] = child.replace('#/components/schemas/', '#/$defs/');
    } else if (key === 'discriminator') {
      continue;
    } else {
      output[key] = rewriteOpenApiRefs(child);
    }
  }
  return output;
}

export function createOpenApiComponentValidator(
  components: Record<string, unknown>,
): OpenApiComponentValidator {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  addFormats(ajv);
  ajv.addFormat(ATLAS_DECIMAL_FORMAT, {
    type: 'string',
    validate: isCanonicalDecimalString,
  });

  const definitions = rewriteOpenApiRefs(components) as Record<string, unknown>;
  const compiled = new Map<string, ValidateFunction>();

  return {
    validate(schemaName: string, value: unknown): ValidationResult {
      if (!(schemaName in definitions)) {
        throw new Error(`Unknown OpenAPI component schema: ${schemaName}`);
      }

      let validator = compiled.get(schemaName);
      if (validator === undefined) {
        validator = ajv.compile({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $ref: `#/$defs/${schemaName}`,
          $defs: definitions,
        });
        compiled.set(schemaName, validator);
      }

      const valid = validator(value) as boolean;
      return { valid, errors: validator.errors == null ? [] : [...validator.errors] };
    },
  };
}
