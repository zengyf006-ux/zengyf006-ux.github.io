import type { PaperTradingEvent } from '@atlas-x/paper-trading';

type Handler = ((event: unknown) => void) | null;

class FakeRequest<T> {
  result: T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onblocked: Handler = null;
  onupgradeneeded: Handler = null;

  constructor(result: T) {
    this.result = result;
  }
}

class FakeTransaction {
  error: Error | null = null;
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  private completionQueued = false;

  constructor(private readonly data: Map<string, PaperTradingEvent>) {}

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.data, () => this.queueCompletion());
  }

  private queueCompletion(): void {
    if (this.completionQueued) return;
    this.completionQueued = true;
    queueMicrotask(() => this.oncomplete?.({}));
  }
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<string, PaperTradingEvent>,
    private readonly complete: () => void,
  ) {}

  put(value: PaperTradingEvent): FakeRequest<unknown> {
    this.data.set(value.eventId, structuredClone(value));
    const request = new FakeRequest<unknown>(undefined);
    queueMicrotask(() => request.onsuccess?.({}));
    this.complete();
    return request;
  }

  getAll(): FakeRequest<PaperTradingEvent[]> {
    const request = new FakeRequest([...this.data.values()].map((event) => structuredClone(event)));
    queueMicrotask(() => request.onsuccess?.({}));
    this.complete();
    return request;
  }

  clear(): FakeRequest<unknown> {
    this.data.clear();
    const request = new FakeRequest<unknown>(undefined);
    queueMicrotask(() => request.onsuccess?.({}));
    this.complete();
    return request;
  }
}

class FakeDatabase {
  private readonly stores = new Map<string, Map<string, PaperTradingEvent>>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };

  createObjectStore(name: string): FakeObjectStore {
    const data = new Map<string, PaperTradingEvent>();
    this.stores.set(name, data);
    return new FakeObjectStore(data, () => {});
  }

  transaction(name: string): FakeTransaction {
    const data = this.stores.get(name);
    if (data === undefined) throw new Error(`Missing object store ${name}`);
    return new FakeTransaction(data);
  }

  close(): void {}
}

class FakeFactory {
  private readonly databases = new Map<string, FakeDatabase>();

  cmp(first: unknown, second: unknown): number {
    return String(first).localeCompare(String(second));
  }

  open(name: string): FakeRequest<FakeDatabase> {
    const exists = this.databases.has(name);
    const database = this.databases.get(name) ?? new FakeDatabase();
    this.databases.set(name, database);
    const request = new FakeRequest(database);
    queueMicrotask(() => {
      if (!exists) request.onupgradeneeded?.({});
      request.onsuccess?.({});
    });
    return request;
  }

  deleteDatabase(name: string): FakeRequest<undefined> {
    this.databases.delete(name);
    const request = new FakeRequest<undefined>(undefined);
    queueMicrotask(() => request.onsuccess?.({}));
    return request;
  }
}

export function createFakeIndexedDbFactory(): IDBFactory {
  return new FakeFactory() as unknown as IDBFactory;
}
