import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ATLAS_DECIMAL_FORMAT,
  SCHEMA_VERSION,
  countSignificantDigits,
  isCanonicalDecimalString,
} from '../src/decimal.js';
import { createOpenApiComponentValidator } from '../src/schema-validator.js';

const specPath = new URL('../openapi/atlas-x.openapi.yaml', import.meta.url);

async function loadSpec(): Promise<{ info: Record<string, unknown>; components: { schemas: Record<string, unknown> } }> {
  return parse(await readFile(specPath, 'utf8')) as {
    info: Record<string, unknown>;
    components: { schemas: Record<string, unknown> };
  };
}

describe('foundation contract rework', () => {
  it('fixes schema version and declares the complete domain schema set', async () => {
    const spec = await loadSpec();
    const schemas = spec.components.schemas;
    expect(SCHEMA_VERSION).toBe('atlas.unified.v1');
    expect(schemas['SchemaVersion']).toMatchObject({ const: SCHEMA_VERSION });
    expect(Object.keys(schemas)).toEqual(expect.arrayContaining([
      'MarketEventEnvelope', 'Ticker', 'Trade', 'AccountSnapshot', 'Position', 'Reservation',
      'OrderIntent', 'OrderEstimate', 'OrderValidation', 'RiskAssessment', 'Strategy', 'AlertRule',
      'AuditEvent', 'AppSnapshot', 'DomainError', 'MarketConnection',
    ]));
  });

  it('uses the exact order and market connection state sets', async () => {
    const schemas = (await loadSpec()).components.schemas;
    expect((schemas['OrderStatus'] as { enum: string[] }).enum).toEqual([
      'draft', 'validating', 'reviewRequired', 'submitting', 'received', 'accepted', 'pending',
      'waitingTrigger', 'partiallyFilled', 'filled', 'canceled', 'expired', 'rejected', 'failed',
    ]);
    expect((schemas['MarketConnectionState'] as { enum: string[] }).enum).toEqual([
      'initializing', 'cached', 'live', 'delayed', 'reconnecting', 'stale', 'offline', 'degraded', 'error',
    ]);
    expect((schemas['OrderStatus'] as { enum: string[] }).enum).not.toContain('cancelled');
  });

  it('enforces the named 34-significant-digit decimal format', async () => {
    const validator = createOpenApiComponentValidator((await loadSpec()).components.schemas);
    const thirtyFour = '1234567890123456789012345678901234';
    expect(ATLAS_DECIMAL_FORMAT).toBe('atlas-decimal-34');
    expect(countSignificantDigits(thirtyFour)).toBe(34);
    expect(isCanonicalDecimalString(thirtyFour)).toBe(true);
    expect(validator.validate('DecimalString', thirtyFour).valid).toBe(true);
    for (const invalid of ['12345678901234567890123456789012345', 1, '1e3', '-0', '01', '1.0']) {
      expect(validator.validate('DecimalString', invalid).valid, String(invalid)).toBe(false);
    }
  });

  it('enforces strict, non-interchangeable data source variants', async () => {
    const validator = createOpenApiComponentValidator((await loadSpec()).components.schemas);
    expect(validator.validate('DataSource', {
      truthfulness: 'cachedReal', provider: 'coinbase', cacheTime: '2026-07-12T00:00:00Z',
    }).valid).toBe(true);
    expect(validator.validate('DataSource', { truthfulness: 'cachedReal', provider: 'coinbase' }).valid).toBe(false);
    expect(validator.validate('DataSource', { truthfulness: 'real', provider: 'coinbase' }).valid).toBe(true);
    expect(validator.validate('DataSource', {
      truthfulness: 'real', provider: 'coinbase', cacheTime: '2026-07-12T00:00:00Z',
    }).valid).toBe(false);
    expect(validator.validate('DataSource', { truthfulness: 'unknown' }).valid).toBe(true);
    expect(validator.validate('DataSource', { truthfulness: 'simulated', provider: 'paper-ledger' }).valid).toBe(true);
    expect(validator.validate('DataSource', { truthfulness: 'fixture', fixtureId: 'book-1' }).valid).toBe(true);
  });

  it('requires stable domain error codes instead of message-only errors', async () => {
    const validator = createOpenApiComponentValidator((await loadSpec()).components.schemas);
    expect(validator.validate('DomainError', {
      schemaVersion: SCHEMA_VERSION, code: 'MARKET_OFFLINE', message: 'offline', retryable: true,
    }).valid).toBe(true);
    expect(validator.validate('DomainError', { schemaVersion: SCHEMA_VERSION, message: 'offline' }).valid).toBe(false);
    expect(validator.validate('DomainError', {
      schemaVersion: SCHEMA_VERSION, code: 'RANDOM_MESSAGE', message: 'x',
    }).valid).toBe(false);
  });
});
