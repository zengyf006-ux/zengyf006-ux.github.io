import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createOpenApiComponentValidator } from '../src/schema-validator.js';

const specPath = new URL('../openapi/atlas-x.openapi.yaml', import.meta.url);

async function loadSpec(): Promise<Record<string, unknown>> {
  return parse(await readFile(specPath, 'utf8')) as Record<string, unknown>;
}

describe('OpenAPI 3.1 cross-platform contracts', () => {
  it('declares the required schema set and exact order types', async () => {
    const spec = await loadSpec();
    expect(spec['openapi']).toBe('3.1.0');
    const components = spec['components'] as { schemas: Record<string, unknown> };
    expect(Object.keys(components.schemas)).toEqual(expect.arrayContaining([
      'DecimalString',
      'Truthfulness',
      'DataSource',
      'EventMetadata',
      'MarketSnapshot',
      'Candle',
      'OrderBookSnapshot',
      'AccountAsset',
      'OrderDraft',
      'Order',
      'Fill',
      'ErrorObject',
    ]));

    const orderType = components.schemas['OrderType'] as { enum: string[] };
    expect(orderType.enum).toEqual(['market', 'limit', 'stopMarket', 'stopLimit']);
  });

  it('validates real snapshots and rejects numeric financial boundaries', async () => {
    const spec = await loadSpec();
    const components = (spec['components'] as { schemas: Record<string, unknown> }).schemas;
    const validator = createOpenApiComponentValidator(components);
    const validSnapshot = {
      metadata: {
        schemaVersion: '1.0.0',
        id: 'evt_market_btc_usdt_100',
        source: { provider: 'binance', truthfulness: 'real' },
        sequence: 100,
        serverTime: '2026-07-12T00:00:00.000Z',
        receivedAt: '2026-07-12T00:00:00.020Z',
      },
      symbol: 'BTC-USDT',
      bid: '60000.1',
      ask: '60000.2',
      last: '60000.15',
      baseVolume: '123.45',
      quoteVolume: '7400000',
    };

    expect(validator.validate('MarketSnapshot', validSnapshot)).toEqual({ valid: true, errors: [] });
    expect(validator.validate('MarketSnapshot', { ...validSnapshot, last: 60000.15 }).valid).toBe(false);
    expect(validator.validate('DecimalString', '-0').valid).toBe(false);
    expect(validator.validate('DecimalString', '-0.1').valid).toBe(true);
  });

  it('keeps OrderDraft structurally distinct from submitted Order', async () => {
    const spec = await loadSpec();
    const components = (spec['components'] as { schemas: Record<string, unknown> }).schemas;
    const validator = createOpenApiComponentValidator(components);
    const draft = {
      schemaVersion: '1.0.0',
      clientOrderId: 'client-001',
      symbol: 'BTC-USDT',
      side: 'buy',
      type: 'limit',
      quantity: '0.01',
      price: '59000',
      createdAt: '2026-07-12T00:00:00.000Z',
    };

    expect(validator.validate('OrderDraft', draft).valid).toBe(true);
    expect(validator.validate('Order', draft).valid).toBe(false);
  });
});
