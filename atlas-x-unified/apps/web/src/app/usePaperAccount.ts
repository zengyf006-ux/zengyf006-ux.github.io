import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSnapshot, OrderDraft } from '@atlas-x/contracts';
import { MemoryPaperTradingEventStore, PaperTradingLedger } from '@atlas-x/paper-trading';

function ids() {
  let value = 0;
  return () => `web-${Date.now()}-${++value}`;
}

export function usePaperAccount() {
  const ledgerRef = useRef<PaperTradingLedger | null>(null);
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [message, setMessage] = useState('模拟账户正在初始化');

  const refresh = useCallback(async () => {
    const ledger = ledgerRef.current;
    if (ledger !== null) setSnapshot(await ledger.snapshot());
  }, []);

  useEffect(() => {
    let active = true;
    const ledger = new PaperTradingLedger({
      store: new MemoryPaperTradingEventStore(),
      accountId: 'paper-web',
      baseCurrency: 'USD',
      initialCash: '100000',
      feeRate: '0.001',
      now: () => new Date().toISOString(),
      id: ids(),
    });
    ledgerRef.current = ledger;
    void ledger.initialize('web-initialize').then(async () => {
      if (!active) return;
      setSnapshot(await ledger.snapshot());
      setMessage('模拟账户已就绪');
    });
    return () => { active = false; };
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
      await ledger.execute({
        type: 'recordFill', commandId: `fill-${draft.clientOrderId}`,
        orderId: result.order.orderId, price: referencePrice, quantity: draft.quantity,
      });
    }
    await refresh();
    setMessage(draft.type === 'market' ? '模拟成交已记入账本' : '模拟限价委托已提交');
    return true;
  }, [refresh]);

  const cancel = useCallback(async (orderId: string) => {
    const ledger = ledgerRef.current;
    if (ledger === null) return;
    const result = await ledger.execute({ type: 'cancelOrder', commandId: `cancel-${orderId}`, orderId });
    setMessage(result.ok ? '委托已撤销，冻结资金已释放' : `${result.error.code}：${result.error.message}`);
    await refresh();
  }, [refresh]);

  return { snapshot, message, submit, cancel };
}
