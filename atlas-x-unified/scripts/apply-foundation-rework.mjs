import { readFile, readdir, writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';
import { schemas } from './foundation/schemas.mjs';
import { SCHEMA_VERSION, DECIMAL_FORMAT, identifier, ref } from './foundation/schema-helpers.mjs';

const response = (schema, description) => ({
  description,
  content: { 'application/json': { schema } },
});
const errorResponse = { $ref: '#/components/responses/ErrorResponse' };
const symbolParameter = [{ $ref: '#/components/parameters/Symbol' }];
const idParameter = (name) => [{ name, in: 'path', required: true, schema: identifier }];
const spec = {
  openapi: '3.1.0',
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: {
    title: 'ATLAS X Unified Contract',
    version: '1.1.0',
    description: 'Cross-platform contract for ATLAS X Web/PWA and future SwiftUI clients.',
    'x-atlas-schema-version': SCHEMA_VERSION,
    'x-atlas-decimal-context': {
      format: DECIMAL_FORMAT,
      maximumSignificantDigits: 34,
      outputRounding: 'half-up',
      internalPrecision: 80,
      conservativeQuantityRounding: 'down',
    },
  },
  servers: [{
    url: 'https://api.example.invalid',
    description: 'Contract placeholder only; no production routing is defined.',
  }],
  paths: {
    '/v1/markets/{symbol}/snapshot': { get: { operationId: 'getMarketSnapshot', parameters: symbolParameter, responses: { '200': response(ref('MarketSnapshot'), 'Current market snapshot'), default: errorResponse } } },
    '/v1/markets/{symbol}/candles': { get: { operationId: 'getCandles', parameters: symbolParameter, responses: { '200': response({ type: 'array', items: ref('Candle') }, 'Ordered candle events'), default: errorResponse } } },
    '/v1/markets/{symbol}/order-book': { get: { operationId: 'getOrderBook', parameters: symbolParameter, responses: { '200': response(ref('OrderBookSnapshot'), 'Current order-book snapshot'), default: errorResponse } } },
    '/v1/accounts/{accountId}/assets': { get: { operationId: 'getAccountAssets', parameters: idParameter('accountId'), responses: { '200': response({ type: 'array', items: ref('AccountAsset') }, 'Account assets'), default: errorResponse } } },
    '/v1/accounts/{accountId}/snapshot': { get: { operationId: 'getAccountSnapshot', parameters: idParameter('accountId'), responses: { '200': response(ref('AccountSnapshot'), 'Paper account snapshot'), default: errorResponse } } },
    '/v1/orders': { post: { operationId: 'submitOrder', requestBody: { required: true, content: { 'application/json': { schema: ref('OrderDraft') } } }, responses: { '201': response(ref('Order'), 'Submitted paper order'), default: errorResponse } } },
    '/v1/orders/{orderId}': { get: { operationId: 'getOrder', parameters: idParameter('orderId'), responses: { '200': response(ref('Order'), 'Submitted order'), default: errorResponse } } },
    '/v1/fills': { get: { operationId: 'listFills', responses: { '200': response({ type: 'array', items: ref('Fill') }, 'Fill events'), default: errorResponse } } },
  },
  components: {
    parameters: { Symbol: { name: 'symbol', in: 'path', required: true, schema: ref('Symbol') } },
    responses: { ErrorResponse: response(ref('DomainError'), 'Stable domain error') },
    schemas,
  },
};
await writeFile(new URL('../openapi/atlas-x.openapi.yaml', import.meta.url), stringify(spec, { lineWidth: 110 }));

function migrate(value) {
  if (Array.isArray(value)) return value.map(migrate);
  if (value !== null && typeof value === 'object') {
    const migrated = Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      key === 'schemaVersion' && child === '1.0.0' ? SCHEMA_VERSION : migrate(child),
    ]));
    if (migrated.truthfulness === 'fixture' && migrated.fixtureId === undefined) {
      migrated.fixtureId = typeof migrated.provider === 'string' ? migrated.provider : 'legacy-fixture';
    }
    return migrated;
  }
  return value;
}

const vectorDirectory = new URL('../vectors/v1/', import.meta.url);
for (const name of await readdir(vectorDirectory)) {
  if (!name.endsWith('.json')) continue;
  const url = new URL(name, vectorDirectory);
  await writeFile(url, `${JSON.stringify(migrate(JSON.parse(await readFile(url, 'utf8'))), null, 2)}\n`);
}

const riskUrl = new URL('risk-position.json', vectorDirectory);
const riskFile = migrate(JSON.parse(await readFile(riskUrl, 'utf8')));
const expandedRiskCases = JSON.parse(await readFile(new URL('./foundation/expanded-risk-cases.json', import.meta.url), 'utf8'));
const ids = new Set(riskFile.cases.map((item) => item.id));
riskFile.vectorVersion = '1.1.0';
riskFile.cases.push(...expandedRiskCases.filter((item) => !ids.has(item.id)));
await writeFile(riskUrl, `${JSON.stringify(riskFile, null, 2)}\n`);

const vectorSchemaUrl = new URL('../vectors/schema/vector-file.schema.json', import.meta.url);
await writeFile(vectorSchemaUrl, `${JSON.stringify(migrate(JSON.parse(await readFile(vectorSchemaUrl, 'utf8'))), null, 2)}\n`);
for (const relative of ['../test/contracts.test.ts', '../test/golden-vectors.test.ts']) {
  const url = new URL(relative, import.meta.url);
  await writeFile(url, (await readFile(url, 'utf8')).replaceAll("'1.0.0'", `'${SCHEMA_VERSION}'`));
}

const names = (await readdir(vectorDirectory)).filter((name) => name.endsWith('.json') && name !== 'manifest.json');
const files = await Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, vectorDirectory), 'utf8'))));
const manifest = files.flatMap((file) => file.cases).reduce((stats, item) => {
  stats.total += 1;
  stats.categories[item.category] += 1;
  return stats;
}, {
  total: 0,
  categories: { normal: 0, boundary: 0, error: 0 },
  domains: Object.fromEntries(files.map((file) => [file.domain, file.cases.length])),
});
await writeFile(new URL('manifest.json', vectorDirectory), `${JSON.stringify(manifest, null, 2)}\n`);
