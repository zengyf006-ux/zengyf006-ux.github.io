import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { DataSource, OrderBookSnapshot, Trade } from '@atlas-x/contracts';
import {
  CoinbasePublicFeedAdapter,
  IndexedDbMarketCache,
  type MarketCachePort,
  type MarketDataSnapshot,
  type SchedulerLike,
  type WebSocketFactory,
  type WebSocketLike,
} from '@atlas-x/market-data';
import {
  createFixtureMarketSnapshot,
  presentMarketSnapshot,
  tickerDisplayMetrics,
  type MarketPresentation,
} from './market.js';

interface MarketDataContextValue {
  readonly snapshot: MarketDataSnapshot;
  readonly presentation: MarketPresentation;
  readonly orderBook: OrderBookSnapshot | null;
  readonly trades: readonly Trade[];
  readonly fallbackReason: string | null;
}

const MarketDataContext = createContext<MarketDataContextValue | null>(null);

class MemoryMarketCache implements MarketCachePort {
  private current: MarketDataSnapshot | null = null;

  async read(): Promise<MarketDataSnapshot | null> {
    return this.current === null ? null : structuredClone(this.current);
  }

  async write(snapshot: MarketDataSnapshot): Promise<void> {
    if (snapshot.truthfulness !== 'real') throw new Error('Memory market cache accepts only real data');
    this.current = structuredClone(snapshot);
  }

  async clear(): Promise<void> {
    this.current = null;
  }
}

function browserWebSocketFactory(): WebSocketFactory {
  return (url: string): WebSocketLike => {
    const socket = new WebSocket(url);
    return {
      send: (value) => socket.send(value),
      close: () => socket.close(),
      addEventListener: (type, listener) => socket.addEventListener(type, listener as EventListener),
      removeEventListener: (type, listener) => socket.removeEventListener(type, listener as EventListener),
    };
  };
}

const browserScheduler: SchedulerLike = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

function createCache(): { readonly cache: MarketCachePort; readonly close: () => Promise<void> } {
  if (globalThis.indexedDB === undefined) {
    return { cache: new MemoryMarketCache(), close: async () => {} };
  }
  const cache = new IndexedDbMarketCache({
    factory: globalThis.indexedDB,
    databaseName: 'atlas-x-unified-market-v1',
    storeName: 'snapshots',
  });
  return { cache, close: () => cache.close() };
}

function withSource(book: OrderBookSnapshot, source: DataSource): OrderBookSnapshot {
  return { ...book, metadata: { ...book.metadata, source } };
}

function tradeWithSource(trade: Trade, source: DataSource): Trade {
  return { ...trade, metadata: { ...trade.metadata, source } };
}

function MarketRuntimeBanner({ value }: { readonly value: MarketDataContextValue }) {
  const ticker = value.presentation.ticker;
  const metrics = ticker === null ? null : tickerDisplayMetrics(ticker);
  return (
    <section className={`market-runtime-banner tone-${value.presentation.tone}`} aria-live="polite" aria-label="公共行情状态">
      <div className="market-runtime-primary">
        <span className="market-runtime-label">{value.presentation.label}</span>
        <b>{ticker?.symbol ?? '公共行情'}</b>
        <strong>{metrics?.price ?? '—'}</strong>
        {metrics === null ? null : <span className={`market-runtime-change ${metrics.direction}`}>{metrics.changeAmount} · {metrics.changePercent}</span>}
      </div>
      <div className="market-runtime-detail">
        <span>{value.presentation.connectionLabel}</span>
        <span>{value.presentation.detail}</span>
        {value.fallbackReason === null ? null : <span className="market-runtime-error">{value.fallbackReason}</span>}
      </div>
    </section>
  );
}

export function MarketDataProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<MarketDataSnapshot>(() => createFixtureMarketSnapshot());
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [trades, setTrades] = useState<readonly Trade[]>([]);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  useEffect(() => {
    if (!('WebSocket' in globalThis)) {
      setFallbackReason('当前环境不支持 WebSocket，继续显示明确标识的 fixture。');
      return;
    }

    let active = true;
    const controller = new AbortController();
    const storage = createCache();
    const adapter = new CoinbasePublicFeedAdapter({
      products: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'LINK-USD'],
      tickSizes: {
        'BTC-USD': '0.01',
        'ETH-USD': '0.01',
        'SOL-USD': '0.01',
        'LINK-USD': '0.001',
      },
      websocketFactory: browserWebSocketFactory(),
      now: () => new Date().toISOString(),
      scheduler: browserScheduler,
      cache: storage.cache,
      delayedAfterMs: 5_000,
      staleAfterMs: 15_000,
    });

    async function publishSnapshot() {
      try {
        const next = await adapter.snapshot();
        if (!active) return;
        setSnapshot(next);
        if (next.truthfulness === 'cachedReal' && next.connection.source.truthfulness === 'cachedReal') {
          const source = next.connection.source;
          setOrderBook((current) => current === null ? null : withSource(current, source));
          setTrades((current) => current.map((trade) => tradeWithSource(trade, source)));
        } else if (next.truthfulness === 'unknown' && next.connection.state === 'offline') {
          setOrderBook(null);
          setTrades([]);
        }
        setFallbackReason(null);
      } catch (error) {
        if (!active) return;
        setFallbackReason(error instanceof Error ? error.message : '无法读取市场状态');
      }
    }

    async function consume() {
      try {
        for await (const event of adapter.subscribe({
          symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'LINK-USD'],
          signal: controller.signal,
        })) {
          if (event.eventType === 'orderBook' && 'bids' in event.payload && 'asks' in event.payload) {
            setOrderBook(event.payload as OrderBookSnapshot);
          }
          if (event.eventType === 'trade' && 'tradeId' in event.payload) {
            const trade = event.payload as Trade;
            setTrades((current) => [trade, ...current.filter((item) => item.tradeId !== trade.tradeId)].slice(0, 30));
          }
          await publishSnapshot();
        }
      } catch (error) {
        if (active) setFallbackReason(error instanceof Error ? error.message : '公共行情订阅中断');
      }
    }

    const online = () => {
      adapter.setOnline(true);
      void publishSnapshot();
    };
    const offline = () => {
      adapter.setOnline(false);
      void publishSnapshot();
    };
    globalThis.addEventListener('online', online);
    globalThis.addEventListener('offline', offline);
    if (globalThis.navigator.onLine === false) adapter.setOnline(false);

    const poll = globalThis.setInterval(() => void publishSnapshot(), 1_000);
    void publishSnapshot();
    void consume();

    return () => {
      active = false;
      controller.abort();
      globalThis.clearInterval(poll);
      globalThis.removeEventListener('online', online);
      globalThis.removeEventListener('offline', offline);
      void adapter.close().finally(storage.close);
    };
  }, []);

  const presentation = useMemo(() => presentMarketSnapshot(snapshot), [snapshot]);
  const value = useMemo<MarketDataContextValue>(() => ({
    snapshot,
    presentation,
    orderBook,
    trades,
    fallbackReason,
  }), [snapshot, presentation, orderBook, trades, fallbackReason]);
  return (
    <MarketDataContext.Provider value={value}>
      <MarketRuntimeBanner value={value} />
      {children}
    </MarketDataContext.Provider>
  );
}

export function useMarketData(): MarketDataContextValue {
  const context = useContext(MarketDataContext);
  if (context === null) throw new Error('useMarketData must be used within MarketDataProvider');
  return context;
}
