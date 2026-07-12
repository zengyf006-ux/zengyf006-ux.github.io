import type { PaperTradingEvent, PaperTradingEventStore } from './types.js';

const DEFAULT_DATABASE = 'atlas-x-unified-paper';
const DEFAULT_STORE = 'events';

export interface IndexedDbPaperTradingEventStoreOptions {
  readonly factory?: IDBFactory;
  /** @deprecated Use factory. */
  readonly indexedDB?: IDBFactory;
  readonly databaseName?: string;
  readonly storeName?: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    const fail = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

function sameEvent(left: PaperTradingEvent, right: PaperTradingEvent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class IndexedDbPaperTradingEventStore implements PaperTradingEventStore {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private readonly storeName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbPaperTradingEventStoreOptions) {
    const factory = options.factory ?? options.indexedDB;
    if (factory === undefined) throw new Error('IndexedDB factory is required');
    this.factory = factory;
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE;
    this.storeName = options.storeName ?? DEFAULT_STORE;
  }

  async append(events: readonly PaperTradingEvent[]): Promise<void> {
    if (events.length === 0) return;
    const existing = new Map((await this.readAll()).map((event) => [event.eventId, event]));
    const unique = new Map<string, PaperTradingEvent>();
    for (const event of events) {
      const stored = existing.get(event.eventId) ?? unique.get(event.eventId);
      if (stored !== undefined) {
        if (!sameEvent(stored, event)) throw new Error(`Conflicting paper event id: ${event.eventId}`);
        continue;
      }
      unique.set(event.eventId, structuredClone(event));
    }
    if (unique.size === 0) return;

    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readwrite');
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore(this.storeName);
    for (const event of unique.values()) store.put(event);
    await completion;
  }

  async readAll(): Promise<readonly PaperTradingEvent[]> {
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readonly');
    const completion = transactionCompletion(transaction);
    const events = await requestResult(transaction.objectStore(this.storeName).getAll()) as PaperTradingEvent[];
    await completion;
    return structuredClone(events).sort((left, right) => left.sequence - right.sequence);
  }

  async clear(): Promise<void> {
    await this.replaceAll([]);
  }

  async replaceAll(events: readonly PaperTradingEvent[]): Promise<void> {
    const unique = new Map<string, PaperTradingEvent>();
    for (const event of events) {
      const existing = unique.get(event.eventId);
      if (existing !== undefined && !sameEvent(existing, event)) {
        throw new Error(`Conflicting paper event id: ${event.eventId}`);
      }
      unique.set(event.eventId, structuredClone(event));
    }

    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readwrite');
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore(this.storeName);
    store.clear();
    for (const event of unique.values()) store.put(event);
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
      request.onerror = () => reject(request.error ?? new Error('Unable to delete paper trading IndexedDB'));
      request.onblocked = () => reject(new Error('Paper trading IndexedDB deletion is blocked'));
    });
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: 'eventId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open paper trading IndexedDB'));
      request.onblocked = () => reject(new Error('Paper trading IndexedDB upgrade is blocked'));
    });
    return this.databasePromise;
  }
}
