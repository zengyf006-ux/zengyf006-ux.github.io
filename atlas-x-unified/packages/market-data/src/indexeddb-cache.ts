import type { MarketCachePort, MarketDataSnapshot } from './types.js';

const DEFAULT_DATABASE = 'atlas-x-unified-market';
const DEFAULT_STORE = 'snapshots';
const CACHE_KEY = 'latest-real';

interface StoredMarketSnapshot {
  readonly cacheKey: typeof CACHE_KEY;
  readonly snapshot: MarketDataSnapshot;
}

export interface IndexedDbMarketCacheOptions {
  readonly factory: IDBFactory;
  readonly databaseName?: string;
  readonly storeName?: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB market-cache request failed'));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    const fail = () => reject(transaction.error ?? new Error('IndexedDB market-cache transaction failed'));
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

export class IndexedDbMarketCache implements MarketCachePort {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private readonly storeName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbMarketCacheOptions) {
    this.factory = options.factory;
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE;
    this.storeName = options.storeName ?? DEFAULT_STORE;
  }

  async read(): Promise<MarketDataSnapshot | null> {
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readonly');
    const completion = transactionCompletion(transaction);
    const records = await requestResult(transaction.objectStore(this.storeName).getAll()) as StoredMarketSnapshot[];
    await completion;
    const record = records.find((entry) => entry.cacheKey === CACHE_KEY) ?? records[0];
    return record === undefined ? null : structuredClone(record.snapshot);
  }

  async write(snapshot: MarketDataSnapshot): Promise<void> {
    if (snapshot.truthfulness !== 'real' || snapshot.connection.source.truthfulness !== 'real') {
      throw new Error('Market cache accepts only real public snapshots');
    }
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readwrite');
    const completion = transactionCompletion(transaction);
    transaction.objectStore(this.storeName).put({
      cacheKey: CACHE_KEY,
      snapshot: structuredClone(snapshot),
    } satisfies StoredMarketSnapshot);
    await completion;
  }

  async clear(): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readwrite');
    const completion = transactionCompletion(transaction);
    transaction.objectStore(this.storeName).clear();
    await completion;
  }

  async close(): Promise<void> {
    if (this.databasePromise === null) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }

  async destroy(): Promise<void> {
    await this.close();
    await new Promise<void>((resolve, reject) => {
      const request = this.factory.deleteDatabase(this.databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Unable to delete market cache database'));
      request.onblocked = () => reject(new Error('Market cache database deletion is blocked'));
    });
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
      request.onerror = () => reject(request.error ?? new Error('Unable to open market cache database'));
      request.onblocked = () => reject(new Error('Market cache database upgrade is blocked'));
    });
    return this.databasePromise;
  }
}
