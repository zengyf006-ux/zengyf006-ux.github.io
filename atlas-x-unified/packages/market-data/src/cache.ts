import type { DataSource, EventMetadata, Ticker } from '@atlas-x/contracts';
import { SCHEMA_VERSION } from '@atlas-x/contracts';
import type { MarketDataPort, MarketDataSnapshot } from './types.js';

function providerOf(source: DataSource): string {
  if ('provider' in source && source.provider !== undefined) return source.provider;
  return 'unknown-provider';
}

function cachedSource(source: DataSource, cacheTime: string): DataSource {
  if (source.truthfulness !== 'real') {
    throw new Error('Only a real snapshot can be converted to cached real data');
  }
  return {
    truthfulness: 'cachedReal',
    provider: providerOf(source),
    cacheTime,
  };
}

function cachedMetadata(metadata: EventMetadata, cacheTime: string): EventMetadata {
  return { ...metadata, source: cachedSource(metadata.source, cacheTime) };
}

export function toCachedRealSnapshot(snapshot: MarketDataSnapshot, cacheTime: string): MarketDataSnapshot {
  if (snapshot.truthfulness !== 'real' || snapshot.connection.source.truthfulness !== 'real') {
    throw new Error('Only a real snapshot can be converted to cached real data');
  }
  return {
    capturedAt: cacheTime,
    truthfulness: 'cachedReal',
    connection: {
      schemaVersion: SCHEMA_VERSION,
      state: 'cached',
      source: cachedSource(snapshot.connection.source, cacheTime),
      updatedAt: cacheTime,
      retryAt: null,
      error: null,
    },
    tickers: snapshot.tickers.map((ticker) => ({
      ...ticker,
      metadata: cachedMetadata(ticker.metadata, cacheTime),
    })),
  };
}

export interface FixtureMarketDataOptions {
  readonly fixtureId: string;
  readonly capturedAt: string;
  readonly tickers: readonly Ticker[];
  readonly events?: readonly import('@atlas-x/contracts').MarketEventEnvelope[];
}

export function createFixtureMarketData(options: FixtureMarketDataOptions): MarketDataPort {
  const source = { truthfulness: 'fixture' as const, fixtureId: options.fixtureId };
  const tickers = options.tickers.map((ticker) => ({
    ...ticker,
    metadata: { ...ticker.metadata, source },
  }));
  const events = (options.events ?? []).map((event) => ({
    ...event,
    metadata: { ...event.metadata, source },
    payload: 'metadata' in event.payload
      ? { ...event.payload, metadata: { ...event.payload.metadata, source } }
      : event.payload,
  }));

  return {
    async snapshot(): Promise<MarketDataSnapshot> {
      return {
        capturedAt: options.capturedAt,
        truthfulness: 'fixture',
        connection: {
          schemaVersion: SCHEMA_VERSION,
          state: 'live',
          source,
          updatedAt: options.capturedAt,
          latencyMs: 0,
          retryAt: null,
          error: null,
        },
        tickers,
      };
    },
    subscribe(): AsyncIterable<import('@atlas-x/contracts').MarketEventEnvelope> {
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield event;
        },
      };
    },
    async close(): Promise<void> {},
  };
}
