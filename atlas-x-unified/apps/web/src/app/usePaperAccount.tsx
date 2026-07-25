import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import type { AppSnapshot, OrderDraft } from '@atlas-x/contracts';
import {
  IndexedDbPaperTradingEventStore,
  MemoryPaperTradingEventStore,
  PaperTradingLedger,
  RESET_PAPER_ACCOUNT_CONFIRMATION,
  type PaperTradingEventStore,
} from '@atlas-x/paper-trading';

export type PaperPersistenceMode = 'checking' | 'indexeddb' | 'memory';

interface PaperAccountContextValue {
  readonly snapshot: AppSnapshot | null;
  readonly message: string;
  readonly persistence: PaperPersistenceMode;
  readonly submit: (draft: OrderDraft, referencePrice: string) => Promise<boolean>;
  readonly cancel: (orderId: string) => Promise<void>;
  readonly reset: (confirmationToken: string) => Promise<boolean>;
}

const PaperAccountContext = createContext<PaperAccountContextValue | null>(null);

function ids() {
  let value = 0;
  return () => `web-${Date.now()}-${++value}`;
}

function createLedger(store: PaperTradingEventStore): PaperTradingLedger {
  return new PaperTradingLedger({
    store,
    accountId: 'paper-web',
    baseCurrency: 'USD',
    initialCash: '100000',
    feeRate: '0.001',
    now: () => new Date().toISOString(),
    id: ids(),
  });
}

function browserStore(): { readonly store: PaperTradingEventStore; readonly mode: Exclude<PaperPersistenceMode, 'checking'> } {
  const factory = globalThis.indexedDB;
  if (factory !== undefined) {
    return {
      store: new IndexedDbPaperTradingEventStore({
        factory,
        databaseName: 'atlas-x-unified-paper-v1',
        storeName: 'events',
      }),
      mode: 'indexeddb',
    };
  }
  return { store: new MemoryPaperTradingEventStore(), mode: 'memory' };
}

export function PaperAccountProvider({ children }: PropsWithChildren) {
  const ledgerRef = useRef<PaperTradingLedger | null>(null);
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [message, setMessage] = useState('模拟账户正在初始化');
  const [persistence, setPersistence] = useState<PaperPersistenceMode>('checking');

  const refresh = useCallback(async () => {
    const ledger = ledgerRef.current;
    if (ledger !== null) setSnapshot(await ledger.snapshot());
  }, []);

  useEffect(() => {
    let active = true;
    let persistentStore: IndexedDbPaperTradingEventStore | null = null;

    async function initialize() {
      const selected = browserStore();
      if (selected.store instanceof IndexedDbPaperTradingEventStore) persistentStore = selected.store;
      let ledger = createLedger(selected.store);
      try {
        await ledger.initialize('web-initialize');
        if (!active) return;
        ledgerRef.current = ledger;
        setPersistence(selected.mode);
        setSnapshot(await ledger.snapshot());
        setMessage(selected.mode === 'indexeddb' ? '模拟账户已在本机持久化' : '模拟账户已就绪；当前浏览器不支持持久化');
      } catch {
        ledger = createLedger(new MemoryPaperTradingEventStore());
        await ledger.initialize('web-memory-fallback');
        if (!active) return;
        ledgerRef.current = ledger;
        setPersistence('memory');
        setSnapshot(await ledger.snapshot());
        setMessage('本地持久化不可用，已安全切换为本次会话模拟账户');
      }
    }

    void initialize();
    return () => {
      active = false;
      void persistentStore?.close();
    };
  }, []);

  const submit = useCallback(async (draft: OrderDraft, referencePrice: string) => {
    const ledger = ledgerRef.current;
    if (ledger === null) return false;
    const result = await ledger.execute({
      type: 'submitOrder', commandId: `submit-${draft.clientOrderId}`, draft, referencePrice,
    });
    if (!result.ok) {
      setMessage(`${result.error.code}：${result.error.message}`);
      return false;
    }
    if (draft.type === 'market' && result.order !== undefined) {
      const fill = await ledger.execute({
        type: 'recordFill', commandId: `fill-${draft.clientOrderId}`,
        orderId: result.order.orderId, price: referencePrice, quantity: draft.quantity,
      });
      if (!fill.ok) {
        setMessage(`${fill.error.code}：${fill.error.message}`);
        await refresh();
        return false;
      }
    }
    await refresh();
    setMessage(draft.type === 'market' ? '模拟成交已记入账本' : '模拟委托已提交并冻结相应资金');
    return true;
  }, [refresh]);

  const cancel = useCallback(async (orderId: string) => {
    const ledger = ledgerRef.current;
    if (ledger === null) return;
    const result = await ledger.execute({ type: 'cancelOrder', commandId: `cancel-${orderId}-${Date.now()}`, orderId });
    setMessage(result.ok ? '委托已撤销，冻结资金已释放' : `${result.error.code}：${result.error.message}`);
    await refresh();
  }, [refresh]);

  const reset = useCallback(async (confirmationToken: string) => {
    const ledger = ledgerRef.current;
    if (ledger === null) return false;
    const result = await ledger.execute({
      type: 'resetAccount',
      commandId: `reset-${Date.now()}`,
      confirmationToken,
    });
    if (!result.ok) {
      setMessage(`${result.error.code}：${result.error.message}`);
      return false;
    }
    await refresh();
    setMessage('模拟账户已重置为 100,000 USD');
    return true;
  }, [refresh]);

  const value = useMemo<PaperAccountContextValue>(() => ({
    snapshot,
    message,
    persistence,
    submit,
    cancel,
    reset,
  }), [snapshot, message, persistence, submit, cancel, reset]);

  return <PaperAccountContext.Provider value={value}>{children}</PaperAccountContext.Provider>;
}

export function usePaperAccount(): PaperAccountContextValue {
  const context = useContext(PaperAccountContext);
  if (context === null) throw new Error('usePaperAccount must be used within PaperAccountProvider');
  return context;
}

export { RESET_PAPER_ACCOUNT_CONFIRMATION };
