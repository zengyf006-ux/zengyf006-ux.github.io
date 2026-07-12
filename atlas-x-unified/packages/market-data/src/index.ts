import type { MarketConnection, MarketEventEnvelope, Ticker, Truthfulness } from '@atlas-x/contracts';

export interface MarketDataSnapshot {
  readonly connection: MarketConnection;
  readonly tickers: readonly Ticker[];
  readonly truthfulness: Truthfulness;
  readonly capturedAt: string;
}

export interface MarketDataSubscriptionOptions {
  readonly symbols: readonly string[];
  readonly signal?: AbortSignal;
}

export interface MarketDataPort {
  snapshot(): Promise<MarketDataSnapshot>;
  subscribe(options: MarketDataSubscriptionOptions): AsyncIterable<MarketEventEnvelope>;
  close(): Promise<void>;
}

export interface MarketCachePort {
  read(): Promise<MarketDataSnapshot | null>;
  write(snapshot: MarketDataSnapshot): Promise<void>;
  clear(): Promise<void>;
}
