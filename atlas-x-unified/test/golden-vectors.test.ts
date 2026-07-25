import { readFile, readdir } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  addDecimal,
  decimalString,
  divideDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from '../src/decimal.js';
import { aggregateOrderBook } from '../src/orderbook.js';
import { estimateOrder } from '../src/order-estimate.js';
import { calculateSpotLongPosition } from '../src/risk-position.js';
import { createOpenApiComponentValidator } from '../src/schema-validator.js';

interface GoldenCase {
  readonly id: string;
  readonly category: 'normal' | 'boundary' | 'error';
  readonly operation: string;
  readonly input: unknown;
  readonly expected?: unknown;
  readonly errorPattern?: string;
}

interface GoldenFile {
  readonly schemaVersion: 'atlas.unified.v1';
  readonly vectorVersion: string;
  readonly domain: 'decimal' | 'contract' | 'orderbook' | 'orderEstimate' | 'riskPosition';
  readonly cases: readonly GoldenCase[];
}

interface Manifest {
  total: number;
  categories: Record<'normal' | 'boundary' | 'error', number>;
  domains: Record<string, number>;
}

const vectorsDirectory = new URL('../vectors/v1/', import.meta.url);
const vectorSchemaUrl = new URL('../vectors/schema/vector-file.schema.json', import.meta.url);
const openApiUrl = new URL('../openapi/atlas-x.openapi.yaml', import.meta.url);

function executeDecimal(operation: string, input: unknown): unknown {
  const values = input as { value?: unknown; left?: string; right?: string };
  switch (operation) {
    case 'normalize': return decimalString(parseDecimal(values.value));
    case 'add': return addDecimal(values.left ?? '', values.right ?? '');
    case 'subtract': return subtractDecimal(values.left ?? '', values.right ?? '');
    case 'multiply': return multiplyDecimal(values.left ?? '', values.right ?? '');
    case 'divide': return divideDecimal(values.left ?? '', values.right ?? '');
    default: throw new Error(`Unknown decimal vector operation: ${operation}`);
  }
}

describe('versioned cross-platform Golden Vectors', () => {
  it('validates every vector file and runs the same vectors through TypeScript', async () => {
    const [schemaText, openApiText, names] = await Promise.all([
      readFile(vectorSchemaUrl, 'utf8'),
      readFile(openApiUrl, 'utf8'),
      readdir(vectorsDirectory),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateVectorFile = ajv.compile(JSON.parse(schemaText));
    const openApi = parse(openApiText) as { components: { schemas: Record<string, unknown> } };
    const contractValidator = createOpenApiComponentValidator(openApi.components.schemas);
    const vectorNames = names.filter((name) => name.endsWith('.json') && name !== 'manifest.json').sort();
    const files: GoldenFile[] = [];

    for (const name of vectorNames) {
      const vectorFile = JSON.parse(await readFile(new URL(name, vectorsDirectory), 'utf8')) as GoldenFile;
      expect(validateVectorFile(vectorFile), `${name}: ${ajv.errorsText(validateVectorFile.errors)}`).toBe(true);
      files.push(vectorFile);

      for (const vector of vectorFile.cases) {
        const execute = (): unknown => {
          switch (vectorFile.domain) {
            case 'decimal':
              return executeDecimal(vector.operation, vector.input);
            case 'contract': {
              const input = vector.input as { schemaName: string; value: unknown };
              return contractValidator.validate(input.schemaName, input.value).valid;
            }
            case 'orderbook':
              return aggregateOrderBook(vector.input as Parameters<typeof aggregateOrderBook>[0]);
            case 'orderEstimate':
              return estimateOrder(vector.input as Parameters<typeof estimateOrder>[0]);
            case 'riskPosition':
              return calculateSpotLongPosition(vector.input as Parameters<typeof calculateSpotLongPosition>[0]);
          }
        };

        if (vector.errorPattern !== undefined) {
          expect(execute, vector.id).toThrow(new RegExp(vector.errorPattern, 'i'));
        } else {
          expect(execute(), vector.id).toEqual(vector.expected);
        }
      }
    }

    const computed = files.flatMap((file) => file.cases).reduce<Manifest>((stats, vector) => {
      stats.total += 1;
      stats.categories[vector.category] += 1;
      return stats;
    }, {
      total: 0,
      categories: { normal: 0, boundary: 0, error: 0 },
      domains: Object.fromEntries(files.map((file) => [file.domain, file.cases.length])),
    });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', vectorsDirectory), 'utf8')) as Manifest;
    expect(computed).toEqual(manifest);
    console.log(`[golden-vectors] total=${computed.total} normal=${computed.categories.normal} boundary=${computed.categories.boundary} error=${computed.categories.error}`);
  });
});
