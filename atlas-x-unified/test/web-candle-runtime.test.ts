import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type Candle } from '@atlas-x/contracts';
import type { CandleCacheEntry } from '@atlas-x/market-data';
import {
  cacheCandles,
  cachedCandleState,
  liveCandleDetail,
} from '../apps/web/src/app/useCandles.js';

function realCandle(): Candle {
  return {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      id: 'coinbase-candle-BTC-USD-1m-60',
      source: { truthfulness: 'real', provider: 'coinbase' },
      sequence: 60,
      serverTime: '1970-01-01T00:02:00.000Z',
      receivedAt: '1970-01-01T00:02:00.050Z',
    },
    symbol: 'BTC-USD',
    interval: '1m',
    openTime: '1970-01-01T00:01:00.000Z',
    closeTime: '1970-01-01T00:02:00.000Z',
    open: '99',
    high: '101',
    low: '98',
    close: '100',
    volume: '1.25',
    quoteVolume: '125',
    closed: true,
  };
}

function cacheEntry(): CandleCacheEntry {
  return {
    symbol: 'BTC-USD',
    interval: '1m',
    cacheTime: '2026-07-12T16:00:00.000Z',
    candles: [realCandle()],
  };
}

describe('truthful Web candle runtime presentation', () => {
  it('relabels retained public candles as cachedReal with the exact cache time', () => {
    const candles = cacheCandles(cacheEntry());
    expect(candles[0]?.metadata.source).toEqual({
      truthfulness: 'cachedReal',
      provider: 'coinbase',
      cacheTime: '2026-07-12T16:00:00.000Z',
    });
  });

  it('keeps offline cache visibly separate from live public candles', () => {
    expect(cachedCandleState(cacheEntry(), false, '浏览器已离线')).toMatchObject({
      truthfulness: 'cachedReal',
      label: '真实 K线缓存',
      loading: false,
      error: '浏览器已离线',
      detail: 'Coinbase · 缓存时间 2026-07-12T16:00:00.000Z',
    });
  });

  it('shows the public provider, interval, count and rounded request latency', () => {
    expect(liveCandleDetail('15m', 300, 42.6)).toBe('Coinbase · 15m · 300 根 · 43 ms');
    expect(liveCandleDetail('1m', 1, -5)).toBe('Coinbase · 1m · 1 根 · 0 ms');
  });
});
