import { describe, expect, it } from 'vitest';
import {
  CoinbasePublicCandleAdapter,
  IndexedDbCandleCache,
  type PublicCandleInterval,
} from '@atlas-x/market-data';
import { createFakeIndexedDbFactory } from './helpers/fake-indexeddb.js';

const response = (payload: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => payload,
});

describe('Coinbase public candle adapter', () => {
  it('normalizes newest-first upstream arrays into ascending contract candles', async () => {
    const urls: string[] = [];
    const adapter = new CoinbasePublicCandleAdapter({
      fetcher: async (url) => {
        urls.push(url);
        return response([
          [120, 99, 103, 100, 102, 2.5],
          [60, 98, 101, 99, 100, 1.25],
        ]);
      },
      now: () => '1970-01-01T00:04:00.000Z',
    });

    const candles = await adapter.load('BTC-USD', '1m');

    expect(urls[0]).toContain('/products/BTC-USD/candles?granularity=60');
    expect(candles.map((candle) => candle.openTime)).toEqual([
      '1970-01-01T00:01:00.000Z',
      '1970-01-01T00:02:00.000Z',
    ]);
    expect(candles[0]).toMatchObject({
      schemaVersion: undefined,
      symbol: 'BTC-USD',
      interval: '1m',
      open: '99',
      high: '101',
      low: '98',
      close: '100',
      volume: '1.25',
      quoteVolume: '125',
      closed: true,
    });
    expect(candles[0]?.metadata).toMatchObject({
      schemaVersion: 'atlas.unified.v1',
      source: { truthfulness: 'real', provider: 'coinbase' },
      sequence: 60,
    });
  });

  it('aggregates exact four-hour candles from hourly public buckets', async () => {
    const rows = [
      [10800, 8, 14, 13, 9, 4],
      [7200, 9, 15, 12, 13, 3],
      [3600, 10, 14, 11, 12, 2],
      [0, 9, 12, 10, 11, 1],
    ];
    const adapter = new CoinbasePublicCandleAdapter({
      fetcher: async () => response(rows),
      now: () => '1970-01-01T05:00:00.000Z',
    });

    const candles = await adapter.load('BTC-USD', '4h');

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      interval: '4h',
      open: '10',
      high: '15',
      low: '8',
      close: '9',
      volume: '10',
      quoteVolume: '121',
      openTime: '1970-01-01T00:00:00.000Z',
      closeTime: '1970-01-01T04:00:00.000Z',
      closed: true,
    });
  });

  it.each<[PublicCandleInterval, number]>([
    ['1m', 60], ['5m', 300], ['15m', 900], ['1h', 3600], ['1d', 86400],
  ])('maps %s to supported Coinbase granularity %d', async (interval, granularity) => {
    let requested = '';
    const adapter = new CoinbasePublicCandleAdapter({
      fetcher: async (url) => { requested = url; return response([]); },
      now: () => '2026-07-12T00:00:00.000Z',
    });
    await adapter.load('BTC-USD', interval);
    expect(requested).toContain(`granularity=${granularity}`);
  });

  it.each([
    null,
    {},
    [[60, 1, 2, 1, 2]],
    [[60, 0, 2, 1, 2, 1]],
    [[60, 1, 2, 1, Number.NaN, 1]],
    [['60', 1, 2, 1, 2, 1]],
  ])('rejects malformed upstream candle payload %j', async (payload) => {
    const adapter = new CoinbasePublicCandleAdapter({
      fetcher: async () => response(payload),
      now: () => '2026-07-12T00:00:00.000Z',
    });
    await expect(adapter.load('BTC-USD', '1m')).rejects.toMatchObject({ code: 'MARKET_DEGRADED' });
  });

  it('returns a stable offline error for network and HTTP failures', async () => {
    const network = new CoinbasePublicCandleAdapter({
      fetcher: async () => { throw new Error('network down'); },
      now: () => '2026-07-12T00:00:00.000Z',
    });
    await expect(network.load('BTC-USD', '1m')).rejects.toMatchObject({ code: 'MARKET_OFFLINE' });

    const http = new CoinbasePublicCandleAdapter({
      fetcher: async () => response({}, false, 429),
      now: () => '2026-07-12T00:00:00.000Z',
    });
    await expect(http.load('BTC-USD', '1m')).rejects.toMatchObject({ code: 'MARKET_OFFLINE' });
  });
});

describe('IndexedDB candle cache', () => {
  it('reloads real candles across instances and rejects fixture values', async () => {
    const factory = createFakeIndexedDbFactory();
    const adapter = new CoinbasePublicCandleAdapter({
      fetcher: async () => response([[60, 98, 101, 99, 100, 1.25]]),
      now: () => '1970-01-01T00:04:00.000Z',
    });
    const candles = await adapter.load('BTC-USD', '1m');
    const first = new IndexedDbCandleCache({ factory, databaseName: 'candle-test' });
    await first.write('BTC-USD', '1m', candles, '1970-01-01T00:04:00.000Z');
    await first.close();

    const second = new IndexedDbCandleCache({ factory, databaseName: 'candle-test' });
    await expect(second.read('BTC-USD', '1m')).resolves.toEqual({
      symbol: 'BTC-USD',
      interval: '1m',
      cacheTime: '1970-01-01T00:04:00.000Z',
      candles,
    });
    const fixture = candles.map((candle) => ({
      ...candle,
      metadata: {
        ...candle.metadata,
        source: { truthfulness: 'fixture' as const, fixtureId: 'bad' },
      },
    }));
    await expect(second.write('BTC-USD', '1m', fixture, '1970-01-01T00:05:00.000Z')).rejects.toThrow(/real/i);
    await second.close();
  });
});
