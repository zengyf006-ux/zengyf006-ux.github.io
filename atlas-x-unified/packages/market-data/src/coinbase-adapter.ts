import type { MarketEventEnvelope, Ticker } from '@atlas-x/contracts';
import { initialMarketConnection, reconnectDelay, reduceMarketConnection } from './connection.js';
import { SequenceTracker } from './sequence.js';
import { toCachedRealSnapshot } from './cache.js';
import {
  COINBASE_PROVIDER,
  COINBASE_PUBLIC_FEED_URL,
  CoinbaseMarketParser,
  MarketDataParseError,
  createCoinbaseSubscription,
} from './coinbase-parser.js';
import type {
  MarketCachePort,
  MarketDataPort,
  MarketDataSnapshot,
  MarketDataSubscriptionOptions,
  SchedulerLike,
  WebSocketEventLike,
  WebSocketFactory,
  WebSocketLike,
} from './types.js';

const DEFAULT_DELAYED_AFTER_MS = 5_000;
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketDataParseError('Invalid payload');
  }
  return value as UnknownRecord;
}

class AsyncEventQueue<T> implements AsyncIterableIterator<T> {
  private readonly buffered: T[] = [];
  private readonly waiting: Array<(result: IteratorResult<T>) => void> = [];
  private finished = false;

  [Symbol.asyncIterator](): AsyncIterableIterator<T> { return this; }

  next(): Promise<IteratorResult<T>> {
    const value = this.buffered.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.finished) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  push(value: T): void {
    if (this.finished) return;
    const waiter = this.waiting.shift();
    if (waiter === undefined) this.buffered.push(value);
    else waiter({ value, done: false });
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const waiter of this.waiting.splice(0)) waiter({ value: undefined, done: true });
  }

  return(): Promise<IteratorResult<T>> {
    this.finish();
    return Promise.resolve({ value: undefined, done: true });
  }
}

export interface CoinbasePublicFeedAdapterOptions {
  readonly products: readonly string[];
  readonly tickSizes: Readonly<Record<string, string>>;
  readonly websocketFactory: WebSocketFactory;
  readonly now: () => string;
  readonly scheduler: SchedulerLike;
  readonly cache: MarketCachePort;
  readonly delayedAfterMs?: number;
  readonly staleAfterMs?: number;
  readonly feedUrl?: string;
}

export class CoinbasePublicFeedAdapter implements MarketDataPort {
  private readonly parser: CoinbaseMarketParser;
  private readonly tracker = new SequenceTracker();
  private readonly queues = new Set<AsyncEventQueue<MarketEventEnvelope>>();
  private readonly tickers = new Map<string, Ticker>();
  private connectionState;
  private socket: WebSocketLike | null = null;
  private reconnectHandle: unknown;
  private staleHandle: unknown;
  private reconnectAttempt = 0;
  private closed = false;
  private offline = false;

  constructor(private readonly options: CoinbasePublicFeedAdapterOptions) {
    this.parser = new CoinbaseMarketParser({ tickSizes: options.tickSizes });
    this.connectionState = initialMarketConnection(options.now());
    this.connect();
  }

  connection(): ReturnType<typeof initialMarketConnection> {
    return this.connectionState;
  }

  async snapshot(): Promise<MarketDataSnapshot> {
    if (this.tickers.size > 0) {
      return this.connectionState.source.truthfulness === 'real'
        ? this.currentRealSnapshot()
        : this.currentCachedSnapshot();
    }
    const cached = await this.options.cache.read();
    if (cached !== null) {
      if (cached.truthfulness === 'real') return toCachedRealSnapshot(cached, this.options.now());
      return cached;
    }
    return {
      capturedAt: this.options.now(),
      truthfulness: this.connectionState.source.truthfulness,
      connection: this.connectionState,
      tickers: [],
    };
  }

  subscribe(options: MarketDataSubscriptionOptions): AsyncIterable<MarketEventEnvelope> {
    const allowed = new Set(options.symbols);
    const source = new AsyncEventQueue<MarketEventEnvelope>();
    const filtered: AsyncIterable<MarketEventEnvelope> = {
      [Symbol.asyncIterator]: () => {
        const iterator = source[Symbol.asyncIterator]();
        return {
          next: async () => {
            while (true) {
              const result = await iterator.next();
              if (result.done || allowed.size === 0
                || this.symbolOf(result.value) !== null && allowed.has(this.symbolOf(result.value) as string)) {
                return result;
              }
            }
          },
          return: async () => {
            this.queues.delete(source);
            return iterator.return?.() ?? { value: undefined, done: true };
          },
        };
      },
    };
    this.queues.add(source);
    options.signal?.addEventListener('abort', () => {
      this.queues.delete(source);
      source.finish();
    }, { once: true });
    return filtered;
  }

  setOnline(online: boolean): void {
    if (online === !this.offline) return;
    this.offline = !online;
    if (!online) {
      this.clearReconnect();
      this.clearStale();
      this.connectionState = reduceMarketConnection(this.connectionState, { type: 'offline' }, this.options.now());
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      return;
    }
    if (!this.closed) this.connect();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearReconnect();
    this.clearStale();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    for (const queue of this.queues) queue.finish();
    this.queues.clear();
  }

  private connect(): void {
    if (this.closed || this.offline || this.socket !== null) return;
    const socket = this.options.websocketFactory(this.options.feedUrl ?? COINBASE_PUBLIC_FEED_URL);
    this.socket = socket;
    socket.addEventListener('open', this.onOpen);
    socket.addEventListener('message', this.onMessage);
    socket.addEventListener('close', this.onClose);
    socket.addEventListener('error', this.onError);
  }

  private readonly onOpen = (): void => {
    this.socket?.send(JSON.stringify(createCoinbaseSubscription(this.options.products)));
  };

  private readonly onMessage = (event: WebSocketEventLike): void => {
    try {
      const now = this.options.now();
      const raw = typeof event.data === 'string' ? JSON.parse(event.data) as unknown : event.data;
      const message = record(raw);
      if (message['type'] === 'subscriptions') {
        this.reconnectAttempt = 0;
        this.connectionState = reduceMarketConnection(
          this.connectionState,
          { type: 'subscribed', provider: COINBASE_PROVIDER },
          now,
        );
        this.resetStale();
        return;
      }
      const parsed = this.parser.parse(message, now);
      const serverTime = typeof message['time'] === 'string' ? Date.parse(message['time']) : Date.parse(now);
      const latencyMs = Number.isFinite(serverTime) ? Math.max(0, Date.parse(now) - serverTime) : 0;
      this.connectionState = reduceMarketConnection(this.connectionState, {
        type: 'message',
        provider: COINBASE_PROVIDER,
        latencyMs,
        delayedAfterMs: this.options.delayedAfterMs ?? DEFAULT_DELAYED_AFTER_MS,
      }, now);
      this.resetStale();

      if (parsed.productId !== undefined && parsed.sequence !== undefined) {
        const observation = this.tracker.observe(parsed.productId, parsed.sequence, 'contiguous');
        if (observation.status === 'gap' || observation.status === 'outOfOrder') {
          this.connectionState = reduceMarketConnection(this.connectionState, {
            type: 'sequenceGap',
            provider: COINBASE_PROVIDER,
            expected: observation.status === 'gap' ? observation.expected : observation.previous + 1,
            actual: observation.actual,
          }, now);
        }
      }

      for (const marketEvent of parsed.events) {
        if (marketEvent.eventType === 'ticker' && this.isTicker(marketEvent.payload)) {
          this.tickers.set(marketEvent.payload.symbol, marketEvent.payload);
        }
        for (const queue of this.queues) queue.push(marketEvent);
      }
      if (parsed.events.length > 0) {
        void this.options.cache.write(this.currentRealSnapshot()).catch((cause: unknown) => {
          this.connectionState = reduceMarketConnection(this.connectionState, {
            type: 'degraded',
            code: 'STORAGE_FAILURE',
            message: cause instanceof Error ? cause.message : 'Market cache write failed',
            provider: COINBASE_PROVIDER,
          }, this.options.now());
        });
      }
    } catch (cause) {
      this.connectionState = reduceMarketConnection(this.connectionState, {
        type: 'fatal',
        code: cause instanceof MarketDataParseError ? cause.code : 'DATA_SOURCE_INVALID',
        message: cause instanceof Error ? cause.message : 'Invalid market payload',
        provider: COINBASE_PROVIDER,
      }, this.options.now());
    }
  };

  private readonly onClose = (): void => {
    if (this.closed || this.offline) return;
    this.socket = null;
    this.clearStale();
    const delay = reconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    const retryAt = new Date(Date.parse(this.options.now()) + delay).toISOString();
    this.connectionState = reduceMarketConnection(this.connectionState, {
      type: 'socketClosed', provider: COINBASE_PROVIDER, retryAt,
    }, this.options.now());
    this.reconnectHandle = this.options.scheduler.setTimeout(() => {
      this.reconnectHandle = undefined;
      this.connect();
    }, delay);
  };

  private readonly onError = (): void => {
    if (this.closed) return;
    this.connectionState = reduceMarketConnection(this.connectionState, {
      type: 'degraded',
      code: 'MARKET_DEGRADED',
      message: 'Market WebSocket error',
      provider: COINBASE_PROVIDER,
    }, this.options.now());
  };

  private resetStale(): void {
    this.clearStale();
    const delay = this.options.staleAfterMs ?? 0;
    if (delay <= 0 || this.closed || this.offline) return;
    this.staleHandle = this.options.scheduler.setTimeout(() => {
      this.staleHandle = undefined;
      this.connectionState = reduceMarketConnection(this.connectionState, {
        type: 'stale', provider: COINBASE_PROVIDER, ageMs: delay,
      }, this.options.now());
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectHandle === undefined) return;
    this.options.scheduler.clearTimeout(this.reconnectHandle);
    this.reconnectHandle = undefined;
  }

  private clearStale(): void {
    if (this.staleHandle === undefined) return;
    this.options.scheduler.clearTimeout(this.staleHandle);
    this.staleHandle = undefined;
  }

  private currentRealSnapshot(): MarketDataSnapshot {
    if (this.connectionState.source.truthfulness !== 'real') {
      throw new Error('Real market snapshot requires a real connection source');
    }
    return {
      capturedAt: this.options.now(),
      truthfulness: 'real',
      connection: this.connectionState,
      tickers: [...this.tickers.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)),
    };
  }

  private currentCachedSnapshot(): MarketDataSnapshot {
    const cacheTime = this.options.now();
    const liveConnection = reduceMarketConnection(
      this.connectionState,
      { type: 'subscribed', provider: COINBASE_PROVIDER },
      cacheTime,
    );
    const cached = toCachedRealSnapshot({
      capturedAt: cacheTime,
      truthfulness: 'real',
      connection: liveConnection,
      tickers: [...this.tickers.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)),
    }, cacheTime);
    return {
      ...cached,
      connection: {
        ...cached.connection,
        state: this.connectionState.state,
        updatedAt: cacheTime,
        ...(this.connectionState.retryAt === undefined ? {} : { retryAt: this.connectionState.retryAt }),
        ...(this.connectionState.error === undefined ? {} : { error: this.connectionState.error }),
      },
    };
  }

  private symbolOf(event: MarketEventEnvelope): string | null {
    return 'symbol' in event.payload && typeof event.payload.symbol === 'string'
      ? event.payload.symbol
      : null;
  }

  private isTicker(payload: MarketEventEnvelope['payload']): payload is Ticker {
    return 'open24h' in payload && 'baseVolume24h' in payload;
  }
}
