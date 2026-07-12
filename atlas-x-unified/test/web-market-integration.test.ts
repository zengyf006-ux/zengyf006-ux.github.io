import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type Ticker } from '@atlas-x/contracts';
import {
  IndexedDbMarketCache,
  type MarketDataSnapshot,
} from '@atlas-x/market-data';
import {
  createFixtureMarketSnapshot,
  presentMarketSnapshot,
  tickerDisplayMetrics,
} from '../apps/web/src/app/market.js';
import { createFakeIndexedDbFactory } from './helpers/fake-indexeddb.js';

function realTicker(): Ticker {
  const source = { truthfulness: 'real' as const, provider: 'coinbase' };
  return {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      id: 'ticker-btc-usd-42',
      source,
      sequence: 42,
      serverTime: '2026-07-12T15:00:00.000Z',
      receivedAt: '2026-07-12T15:00:00.050Z',
    },
    symbol: 'BTC-USD',
    bid: '118419.9',
    ask: '118420.1',
    last: '118420',
    open24h: '116000',
    high24h: '119000',
    low24h: '115500',
    baseVolume24h: '1234.5',
    quoteVolume24h: '144000000',
  };
}

function realSnapshot(): MarketDataSnapshot {
  const source = { truthfulness: 'real' as const, provider: 'coinbase' };
  return {
    capturedAt: '2026-07-12T15:00:00.050Z',
    truthfulness: 'real',
    connection: {
      schemaVersion: SCHEMA_VERSION,
      state: 'live',
      source,
      updatedAt: '2026-07-12T15:00:00.050Z',
      latencyMs: 50,
      retryAt: null,
      error: null,
    },
    tickers: [realTicker()],
  };
}

describe('truthful Web market integration', () => {
  it('persists only real public snapshots and reloads them across cache instances', async () => {
    const factory = createFakeIndexedDbFactory();
    const first = new IndexedDbMarketCache({ factory, databaseName: 'market-test' });
    await first.write(realSnapshot());
    await first.close();

    const second = new IndexedDbMarketCache({ factory, databaseName: 'market-test' });
    await expect(second.read()).resolves.toEqual(realSnapshot());
    await expect(second.write(createFixtureMarketSnapshot())).rejects.toThrow(/real/i);
    await second.close();
  });

  it('derives exact, display-ready ticker movement without native floating point', () => {
    expect(tickerDisplayMetrics(realTicker())).toEqual({
      price: '118,420',
      changeAmount: '+2,420',
      changePercent: '+2.09%',
      direction: 'positive',
    });
  });

  it('presents real, cached and fixture states without ambiguous labels', () => {
    const real = presentMarketSnapshot(realSnapshot());
    expect(real).toMatchObject({ label: '实时真实', tone: 'positive', connectionLabel: '实时' });
    expect(real.detail).toContain('Coinbase');
    expect(real.detail).toContain('50 ms');

    const { latencyMs: _latency, ...connectionWithoutLatency } = realSnapshot().connection;
    const cached = presentMarketSnapshot({
      ...realSnapshot(),
      truthfulness: 'cachedReal',
      connection: {
        ...connectionWithoutLatency,
        state: 'offline',
        source: {
          truthfulness: 'cachedReal',
          provider: 'coinbase',
          cacheTime: '2026-07-12T14:59:00.000Z',
        },
      },
      tickers: realSnapshot().tickers.map((ticker) => ({
        ...ticker,
        metadata: {
          ...ticker.metadata,
          source: {
            truthfulness: 'cachedReal' as const,
            provider: 'coinbase',
            cacheTime: '2026-07-12T14:59:00.000Z',
          },
        },
      })),
    });
    expect(cached).toMatchObject({ label: '真实缓存', tone: 'warning', connectionLabel: '离线' });
    expect(cached.detail).toContain('缓存时间');

    const fixture = presentMarketSnapshot(createFixtureMarketSnapshot());
    expect(fixture).toMatchObject({ label: '测试数据', tone: 'warning' });
    expect(fixture.detail).toContain('不代表实时市场');
  });
});
