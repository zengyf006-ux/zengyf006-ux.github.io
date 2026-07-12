import { describe, expect, it } from 'vitest';
import type { MarketDataSnapshot, WebSocketLike } from '@atlas-x/market-data';
import {
  COINBASE_PUBLIC_FEED_URL,
  CoinbaseMarketParser,
  CoinbasePublicFeedAdapter,
  SequenceTracker,
  createCoinbaseSubscription,
  createFixtureMarketData,
  initialMarketConnection,
  reconnectDelay,
  reduceMarketConnection,
  toCachedRealSnapshot,
} from '@atlas-x/market-data';

const now = '2026-07-12T00:00:00.000Z';

class FakeSocket implements WebSocketLike {
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
  send(value: string): void { this.sent.push(value); }
  close(): void { this.emit('close', {}); }
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeScheduler {
  readonly tasks: Array<{ id: number; delay: number; callback: () => void; cleared: boolean }> = [];
  private nextId = 1;
  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextId++;
    this.tasks.push({ id, callback, delay, cleared: false });
    return id;
  }
  clearTimeout(handle: unknown): void {
    const task = this.tasks.find((candidate) => candidate.id === handle);
    if (task !== undefined) task.cleared = true;
  }
  runNext(): void {
    let task = this.tasks.shift();
    while (task?.cleared === true) task = this.tasks.shift();
    task?.callback();
  }
  runDelay(delay: number): void {
    const index = this.tasks.findIndex((task) => !task.cleared && task.delay === delay);
    if (index < 0) throw new Error(`No scheduled task with delay ${delay}`);
    const [task] = this.tasks.splice(index, 1);
    task?.callback();
  }
}

describe('market connection state machine', () => {
  it('moves through cache, live, delayed, degraded, stale and reconnecting states', () => {
    let connection = initialMarketConnection(now);
    expect(connection.state).toBe('initializing');
    connection = reduceMarketConnection(connection, { type: 'cacheLoaded', provider: 'coinbase-exchange', cacheTime: now }, now);
    expect(connection).toMatchObject({ state: 'cached', source: { truthfulness: 'cachedReal', cacheTime: now } });
    connection = reduceMarketConnection(connection, { type: 'subscribed', provider: 'coinbase-exchange' }, now);
    expect(connection).toMatchObject({ state: 'live', source: { truthfulness: 'real' } });
    connection = reduceMarketConnection(connection, { type: 'message', provider: 'coinbase-exchange', latencyMs: 6001, delayedAfterMs: 5000 }, now);
    expect(connection.state).toBe('delayed');
    connection = reduceMarketConnection(connection, { type: 'sequenceGap', provider: 'coinbase-exchange', expected: 2, actual: 4 }, now);
    expect(connection).toMatchObject({ state: 'degraded', error: { code: 'MARKET_DEGRADED' } });
    connection = reduceMarketConnection(connection, { type: 'stale', provider: 'coinbase-exchange', ageMs: 31000 }, now);
    expect(connection).toMatchObject({ state: 'stale', error: { code: 'MARKET_STALE' } });
    connection = reduceMarketConnection(connection, { type: 'socketClosed', provider: 'coinbase-exchange', retryAt: '2026-07-12T00:00:01.000Z' }, now);
    expect(connection).toMatchObject({ state: 'reconnecting', retryAt: '2026-07-12T00:00:01.000Z' });
  });

  it('makes offline and fatal errors explicit and recovers to live', () => {
    let connection = reduceMarketConnection(initialMarketConnection(now), { type: 'offline' }, now);
    expect(connection).toMatchObject({ state: 'offline', source: { truthfulness: 'unknown' } });
    connection = reduceMarketConnection(connection, { type: 'subscribed', provider: 'coinbase-exchange' }, now);
    expect(connection.state).toBe('live');
    connection = reduceMarketConnection(connection, { type: 'fatal', code: 'DATA_SOURCE_INVALID', message: 'bad payload', provider: 'coinbase-exchange' }, now);
    expect(connection).toMatchObject({ state: 'error', error: { code: 'DATA_SOURCE_INVALID', retryable: false } });
  });
});

describe('sequence and reconnect policy', () => {
  it('detects contiguous gaps and monotonic regressions without false gaps', () => {
    const tracker = new SequenceTracker();
    expect(tracker.observe('BTC-USD', 10, 'contiguous')).toEqual({ status: 'first' });
    expect(tracker.observe('BTC-USD', 11, 'contiguous')).toEqual({ status: 'ok' });
    expect(tracker.observe('BTC-USD', 13, 'contiguous')).toEqual({ status: 'gap', expected: 12, actual: 13 });
    expect(tracker.observe('ETH-USD', 100, 'monotonic')).toEqual({ status: 'first' });
    expect(tracker.observe('ETH-USD', 110, 'monotonic')).toEqual({ status: 'ok' });
    expect(tracker.observe('ETH-USD', 109, 'monotonic')).toEqual({ status: 'outOfOrder', previous: 110, actual: 109 });
  });

  it('uses bounded deterministic exponential reconnect delays', () => {
    expect([0, 1, 2, 3, 20].map((attempt) => reconnectDelay(attempt))).toEqual([500, 1000, 2000, 4000, 30000]);
    expect(() => reconnectDelay(-1)).toThrow(/attempt/i);
  });
});

describe('Coinbase public feed normalization', () => {
  it('subscribes only to public market channels', () => {
    expect(COINBASE_PUBLIC_FEED_URL).toBe('wss://ws-feed.exchange.coinbase.com');
    expect(createCoinbaseSubscription(['BTC-USD'])).toEqual({
      type: 'subscribe',
      product_ids: ['BTC-USD'],
      channels: ['heartbeat', 'ticker', 'matches', 'level2'],
    });
  });

  it('normalizes ticker and trade messages with real source and decimal strings', () => {
    const parser = new CoinbaseMarketParser({ tickSizes: { 'BTC-USD': '0.01' } });
    const ticker = parser.parse({
      type: 'ticker', sequence: 10, product_id: 'BTC-USD', price: '60000.00', open_24h: '59000',
      volume_24h: '12.5', low_24h: '58000', high_24h: '61000', best_bid: '59999.9',
      best_ask: '60000.1', time: now, trade_id: 7,
    }, now);
    expect(ticker.events[0]).toMatchObject({
      eventType: 'ticker',
      metadata: { source: { truthfulness: 'real', provider: 'coinbase-exchange' }, sequence: 10 },
      payload: { symbol: 'BTC-USD', last: '60000', baseVolume24h: '12.5', quoteVolume24h: '750000' },
    });
    const trade = parser.parse({
      type: 'match', sequence: 11, product_id: 'BTC-USD', trade_id: 8, side: 'buy',
      price: '60001', size: '0.01', time: now,
    }, now);
    expect(trade.events[0]).toMatchObject({
      eventType: 'trade', payload: { tradeId: '8', side: 'buy', quoteAmount: '600.01' },
    });
  });

  it('maintains a sorted level2 book and removes zero-size levels', () => {
    const parser = new CoinbaseMarketParser({ tickSizes: { 'BTC-USD': '0.01' } });
    const snapshot = parser.parse({
      type: 'snapshot', product_id: 'BTC-USD', bids: [['100', '2'], ['99', '3']], asks: [['102', '4'], ['101', '1']],
    }, now);
    expect(snapshot.events[0]).toMatchObject({
      eventType: 'orderBook',
      payload: { bids: [{ price: '100', quantity: '2' }, { price: '99', quantity: '3' }], asks: [{ price: '101', quantity: '1' }, { price: '102', quantity: '4' }] },
    });
    const update = parser.parse({
      type: 'l2update', product_id: 'BTC-USD', time: now,
      changes: [['buy', '100', '0'], ['buy', '98', '5'], ['sell', '101', '2']],
    }, now);
    expect(update.events[0]).toMatchObject({
      payload: { bids: [{ price: '99', quantity: '3' }, { price: '98', quantity: '5' }], asks: [{ price: '101', quantity: '2' }, { price: '102', quantity: '4' }] },
    });
  });

  it('rejects malformed financial payloads with a stable parse code', () => {
    const parser = new CoinbaseMarketParser({ tickSizes: { 'BTC-USD': '0.01' } });
    expect(() => parser.parse({ type: 'ticker', product_id: 'BTC-USD', sequence: 1, price: 10 }, now))
      .toThrowError(expect.objectContaining({ code: 'DATA_SOURCE_INVALID' }));
  });
});

describe('cache and fixture truthfulness', () => {
  const realSnapshot: MarketDataSnapshot = {
    capturedAt: now,
    truthfulness: 'real',
    connection: {
      schemaVersion: 'atlas.unified.v1', state: 'live', updatedAt: now,
      source: { truthfulness: 'real', provider: 'coinbase-exchange' },
    },
    tickers: [{
      metadata: {
        schemaVersion: 'atlas.unified.v1', id: 'ticker-1', sequence: 1, serverTime: now, receivedAt: now,
        source: { truthfulness: 'real', provider: 'coinbase-exchange' },
      },
      symbol: 'BTC-USD', bid: '99', ask: '101', last: '100', open24h: '90', high24h: '110', low24h: '80',
      baseVolume24h: '10', quoteVolume24h: '1000',
    }],
  };

  it('rewrites every real source to cachedReal and never labels cache as live real', () => {
    const cached = toCachedRealSnapshot(realSnapshot, '2026-07-12T00:00:01.000Z');
    expect(cached).toMatchObject({ truthfulness: 'cachedReal', connection: { state: 'cached', source: { truthfulness: 'cachedReal' } } });
    expect(cached.tickers[0]?.metadata.source).toMatchObject({ truthfulness: 'cachedReal', cacheTime: '2026-07-12T00:00:01.000Z' });
  });

  it('rejects fixture or simulated data being relabeled as cached real', () => {
    expect(() => toCachedRealSnapshot({ ...realSnapshot, truthfulness: 'fixture' }, now)).toThrow(/real snapshot/i);
  });

  it('provides deterministic fixture snapshots and events with visible fixture source', async () => {
    const fixture = createFixtureMarketData({ fixtureId: 'market-basic', capturedAt: now, tickers: realSnapshot.tickers });
    const snapshot = await fixture.snapshot();
    expect(snapshot).toMatchObject({ truthfulness: 'fixture', connection: { source: { truthfulness: 'fixture', fixtureId: 'market-basic' } } });
    expect(snapshot.tickers[0]?.metadata.source).toMatchObject({ truthfulness: 'fixture', fixtureId: 'market-basic' });
  });
});

describe('Coinbase adapter lifecycle', () => {
  it('connects, emits normalized events, caches snapshots and schedules bounded reconnect', async () => {
    const sockets: FakeSocket[] = [];
    const scheduler = new FakeScheduler();
    let clock = Date.parse(now);
    let cached: MarketDataSnapshot | null = null;
    const adapter = new CoinbasePublicFeedAdapter({
      products: ['BTC-USD'],
      tickSizes: { 'BTC-USD': '0.01' },
      websocketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      now: () => new Date(clock).toISOString(),
      scheduler,
      cache: {
        read: async () => cached,
        write: async (snapshot) => { cached = snapshot; },
        clear: async () => { cached = null; },
      },
    });
    const stream = adapter.subscribe({ symbols: ['BTC-USD'] })[Symbol.asyncIterator]();
    sockets[0]?.emit('open', {});
    expect(JSON.parse(sockets[0]?.sent[0] ?? '{}')).toEqual(createCoinbaseSubscription(['BTC-USD']));
    sockets[0]?.emit('message', { data: JSON.stringify({ type: 'subscriptions', channels: [] }) });
    expect(adapter.connection().state).toBe('live');
    sockets[0]?.emit('message', { data: JSON.stringify({
      type: 'ticker', sequence: 1, product_id: 'BTC-USD', price: '100', open_24h: '90', volume_24h: '10',
      low_24h: '80', high_24h: '110', best_bid: '99', best_ask: '101', time: now, trade_id: 1,
    }) });
    expect((await stream.next()).value).toMatchObject({ eventType: 'ticker', payload: { last: '100' } });
    expect((await adapter.snapshot()).truthfulness).toBe('real');
    expect((cached as MarketDataSnapshot | null)?.truthfulness).toBe('real');
    sockets[0]?.emit('close', {});
    expect(adapter.connection().state).toBe('reconnecting');
    expect(scheduler.tasks[0]?.delay).toBe(500);
    clock += 500;
    scheduler.runNext();
    expect(sockets).toHaveLength(2);
    await adapter.close();
  });
});

describe('Coinbase adapter resilience', () => {
  function createAdapter(options: {
    readonly cached?: MarketDataSnapshot | null;
    readonly staleAfterMs?: number;
    readonly failCacheWrite?: boolean;
  } = {}) {
    const sockets: FakeSocket[] = [];
    const scheduler = new FakeScheduler();
    let clock = Date.parse(now);
    let cached = options.cached ?? null;
    const adapter = new CoinbasePublicFeedAdapter({
      products: ['BTC-USD'],
      tickSizes: { 'BTC-USD': '0.01' },
      websocketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      now: () => new Date(clock).toISOString(),
      scheduler,
      ...(options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs }),
      cache: {
        read: async () => cached,
        write: async (snapshot) => {
          if (options.failCacheWrite === true) throw new Error('cache unavailable');
          cached = snapshot;
        },
        clear: async () => { cached = null; },
      },
    });
    return {
      adapter,
      sockets,
      scheduler,
      advance(milliseconds: number) { clock += milliseconds; },
      cached: () => cached,
    };
  }

  it('loads a real cached snapshot as visibly cachedReal before live data arrives', async () => {
    const cached: MarketDataSnapshot = {
      capturedAt: now,
      truthfulness: 'real',
      connection: {
        schemaVersion: 'atlas.unified.v1', state: 'live', updatedAt: now,
        source: { truthfulness: 'real', provider: 'coinbase-exchange' },
      },
      tickers: [{
        metadata: {
          schemaVersion: 'atlas.unified.v1', id: 'ticker-cache', sequence: 1,
          source: { truthfulness: 'real', provider: 'coinbase-exchange' }, serverTime: now, receivedAt: now,
        },
        symbol: 'BTC-USD', bid: '99', ask: '101', last: '100', open24h: '90', high24h: '110', low24h: '80',
        baseVolume24h: '10', quoteVolume24h: '1000',
      }],
    };
    const { adapter } = createAdapter({ cached });
    const snapshot = await adapter.snapshot();
    expect(snapshot).toMatchObject({
      truthfulness: 'cachedReal',
      connection: { state: 'cached', source: { truthfulness: 'cachedReal', provider: 'coinbase-exchange' } },
    });
    expect(snapshot.tickers[0]?.metadata.source.truthfulness).toBe('cachedReal');
    await adapter.close();
  });

  it('moves offline without reconnecting and reconnects only after network recovery', async () => {
    const { adapter, sockets } = createAdapter();
    expect(sockets).toHaveLength(1);
    adapter.setOnline(false);
    expect(adapter.connection().state).toBe('offline');
    expect(sockets).toHaveLength(1);
    adapter.setOnline(true);
    expect(sockets).toHaveLength(2);
    await adapter.close();
  });

  it('marks a quiet live stream stale and resets the timer after a valid message', async () => {
    const { adapter, sockets, scheduler, advance } = createAdapter({ staleAfterMs: 1_000 });
    sockets[0]?.emit('open', {});
    sockets[0]?.emit('message', { data: JSON.stringify({ type: 'subscriptions', channels: [] }) });
    advance(1_000);
    scheduler.runDelay(1_000);
    expect(adapter.connection()).toMatchObject({ state: 'stale', error: { code: 'MARKET_STALE' } });
    sockets[0]?.emit('message', { data: JSON.stringify({
      type: 'ticker', sequence: 1, product_id: 'BTC-USD', price: '100', open_24h: '90', volume_24h: '10',
      low_24h: '80', high_24h: '110', best_bid: '99', best_ask: '101', time: new Date(Date.parse(now) + 1_000).toISOString(), trade_id: 1,
    }) });
    expect(adapter.connection().state).toBe('live');
    await adapter.close();
  });

  it('degrades on a forward sequence gap reported by the public feed', async () => {
    const { adapter, sockets } = createAdapter();
    sockets[0]?.emit('message', { data: JSON.stringify({ type: 'subscriptions', channels: [] }) });
    for (const sequence of [10, 12]) {
      sockets[0]?.emit('message', { data: JSON.stringify({
        type: 'heartbeat', sequence, product_id: 'BTC-USD', time: now, last_trade_id: sequence,
      }) });
    }
    expect(adapter.connection()).toMatchObject({ state: 'degraded', error: { code: 'MARKET_DEGRADED' } });
    await adapter.close();
  });

  it('degrades on out-of-order sequences without emitting a false real state', async () => {
    const { adapter, sockets } = createAdapter();
    sockets[0]?.emit('message', { data: JSON.stringify({ type: 'subscriptions', channels: [] }) });
    for (const sequence of [10, 9]) {
      sockets[0]?.emit('message', { data: JSON.stringify({
        type: 'ticker', sequence, product_id: 'BTC-USD', price: '100', open_24h: '90', volume_24h: '10',
        low_24h: '80', high_24h: '110', best_bid: '99', best_ask: '101', time: now, trade_id: sequence,
      }) });
    }
    expect(adapter.connection()).toMatchObject({ state: 'degraded', error: { code: 'MARKET_DEGRADED' } });
    await adapter.close();
  });

  it('never labels retained memory data as real while offline', async () => {
    const { adapter, sockets } = createAdapter();
    sockets[0]?.emit('message', { data: JSON.stringify({ type: 'subscriptions', channels: [] }) });
    sockets[0]?.emit('message', { data: JSON.stringify({
      type: 'ticker', sequence: 1, product_id: 'BTC-USD', price: '100', open_24h: '90', volume_24h: '10',
      low_24h: '80', high_24h: '110', best_bid: '99', best_ask: '101', time: now, trade_id: 1,
    }) });
    adapter.setOnline(false);
    const snapshot = await adapter.snapshot();
    expect(snapshot.truthfulness).toBe('cachedReal');
    expect(snapshot.connection.state).toBe('offline');
    expect(snapshot.connection.source.truthfulness).toBe('cachedReal');
    expect(snapshot.tickers[0]?.metadata.source.truthfulness).toBe('cachedReal');
    await adapter.close();
  });

  it('keeps live data usable while reporting cache write failure as degraded storage', async () => {
    const { adapter, sockets } = createAdapter({ failCacheWrite: true });
    sockets[0]?.emit('message', { data: JSON.stringify({ type: 'subscriptions', channels: [] }) });
    sockets[0]?.emit('message', { data: JSON.stringify({
      type: 'ticker', sequence: 1, product_id: 'BTC-USD', price: '100', open_24h: '90', volume_24h: '10',
      low_24h: '80', high_24h: '110', best_bid: '99', best_ask: '101', time: now, trade_id: 1,
    }) });
    await Promise.resolve();
    expect(adapter.connection()).toMatchObject({ state: 'degraded', error: { code: 'STORAGE_FAILURE', retryable: true } });
    expect((await adapter.snapshot()).tickers[0]?.last).toBe('100');
    await adapter.close();
  });
});
