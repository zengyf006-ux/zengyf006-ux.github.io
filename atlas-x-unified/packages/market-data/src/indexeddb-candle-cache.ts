import type { Candle } from '@atlas-x/contracts';
import type { PublicCandleInterval } from './coinbase-candles.js';

const DEFAULT_DATABASE = 'atlas-x-unified-candles';
const DEFAULT_STORE = 'candles';

export interface CandleCacheEntry {
  readonly symbol: string;
  readonly interval: PublicCandleInterval;
  readonly cacheTime: string;
  readonly candles: readonly Candle[];
}

interface StoredCandleCacheEntry extends CandleCacheEntry {
  readonly cacheKey: string;
}

export interface IndexedDbCandleCacheOptions {
  readonly factory: IDBFactory;
  readonly databaseName?: string;
  readonly storeName?: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB candle-cache request failed'));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    const fail = () => reject(transaction.error ?? new Error('IndexedDB candle-cache transaction failed'));
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

function key(symbol: string, interval: PublicCandleInterval): string {
  return `${symbol}:${interval}`;
}

export class IndexedDbCandleCache {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private readonly storeName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbCandleCacheOptions) {
    this.factory = options.factory;
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE;
    this.storeName = options.storeName ?? DEFAULT_STORE;
  }

  async read(symbol: string, interval: PublicCandleInterval): Promise<CandleCacheEntry | null> {
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readonly');
    const completion = transactionCompletion(transaction);
    const records = await requestResult(transaction.objectStore(this.storeName).getAll()) as StoredCandleCacheEntry[];
    await completion;
    const record = records.find((entry) => entry.cacheKey === key(symbol, interval));
    if (record === undefined) return null;
    return {
      symbol: record.symbol,
      interval: record.interval,
      cacheTime: record.cacheTime,
      candles: structuredClone(record.candles),
    };
  }

  async write(
    symbol: string,
    interval: PublicCandleInterval,
    candles: readonly Candle[],
    cacheTime: string,
  ): Promise<void> {
    if (candles.some((candle) => candle.symbol !== symbol
      || candle.interval !== interval
      || candle.metadata.source.truthfulness !== 'real')) {
      throw new Error('Candle cache accepts only matching real public candles');
    }
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readwrite');
    const completion = transactionCompletion(transaction);
    transaction.objectStore(this.storeName).put({
      cacheKey: key(symbol, interval),
      symbol,
      interval,
      cacheTime,
      candles: structuredClone(candles),
    } satisfies StoredCandleCacheEntry);
    await completion;
  }

  async clear(symbol?: string, interval?: PublicCandleInterval): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const completion = transactionCompletion(transaction);
    if (symbol !== undefined && interval !== undefined) store.delete(key(symbol, interval));
    else store.clear();
    await completion;
  }

  async close(): Promise<void> {
    if (this.databasePromise === null) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: 'cacheKey' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open candle cache database'));
      request.onblocked = () => reject(new Error('Candle cache database upgrade is blocked'));
    });
    return this.databasePromise;
  }
}
