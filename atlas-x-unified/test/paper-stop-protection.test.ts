import { describe, expect, it } from 'vitest';
import type { OrderDraft } from '@atlas-x/contracts';
import { buyLimitDraft as buyLimit, createPaperLedger as ledger, paperStart as start } from './helpers/paper-ledger.js';

describe('stop triggers and execution protections', () => {
  it('triggers a buy stop only at or above its stop price', async () => {
    const { engine } = await ledger();
    const stop: OrderDraft = {
      schemaVersion: 'atlas.unified.v1', clientOrderId: 'stop-market', symbol: 'BTC-USD', side: 'buy',
      type: 'stopMarket', quantity: '1', stopPrice: '105', createdAt: start,
    };
    await engine.execute({ type: 'submitOrder', commandId: 'stop-submit', draft: stop, referencePrice: '100' });
    await engine.execute({ type: 'markPrice', commandId: 'mark-low', symbol: 'BTC-USD', price: '104.99' });
    expect((await engine.snapshot()).orders[0]?.status).toBe('waitingTrigger');
    await engine.execute({ type: 'markPrice', commandId: 'mark-hit', symbol: 'BTC-USD', price: '105' });
    expect((await engine.snapshot()).orders[0]?.status).toBe('pending');
  });

  it('triggers a sell stop only at or below its stop price', async () => {
    const { engine } = await ledger();
    await engine.execute({ type: 'submitOrder', commandId: 'buy', draft: buyLimit, referencePrice: '100' });
    const buyOrder = (await engine.snapshot()).orders[0]!.orderId;
    await engine.execute({ type: 'recordFill', commandId: 'fill-buy', orderId: buyOrder, price: '100', quantity: '2' });
    const stop: OrderDraft = {
      schemaVersion: 'atlas.unified.v1', clientOrderId: 'sell-stop', symbol: 'BTC-USD', side: 'sell',
      type: 'stopLimit', quantity: '1', price: '89', stopPrice: '90', createdAt: start,
    };
    await engine.execute({ type: 'submitOrder', commandId: 'stop-submit', draft: stop, referencePrice: '100' });
    await engine.execute({ type: 'markPrice', commandId: 'mark-high', symbol: 'BTC-USD', price: '90.01' });
    expect((await engine.snapshot()).orders.find((order) => order.draft.clientOrderId === 'sell-stop')?.status).toBe('waitingTrigger');
    await engine.execute({ type: 'markPrice', commandId: 'mark-hit', symbol: 'BTC-USD', price: '90' });
    expect((await engine.snapshot()).orders.find((order) => order.draft.clientOrderId === 'sell-stop')?.status).toBe('pending');
  });

  it('rejects fills outside limit price and does not mutate the event stream', async () => {
    const { engine, store } = await ledger();
    await engine.execute({ type: 'submitOrder', commandId: 'submit-limit', draft: buyLimit, referencePrice: '100' });
    const orderId = (await engine.snapshot()).orders[0]!.orderId;
    const before = (await store.readAll()).length;
    const result = await engine.execute({ type: 'recordFill', commandId: 'bad-fill', orderId, price: '100.01', quantity: '1' });
    expect(result).toMatchObject({ ok: false, error: { code: 'ORDER_INVALID' } });
    expect(await store.readAll()).toHaveLength(before);
  });

  it('rejects a market fill that would overdraw cash after fees', async () => {
    const { engine, store } = await ledger('100');
    const market: OrderDraft = {
      schemaVersion: 'atlas.unified.v1', clientOrderId: 'market-1', symbol: 'BTC-USD', side: 'buy',
      type: 'market', quantity: '1', createdAt: start,
    };
    await engine.execute({ type: 'submitOrder', commandId: 'market-submit', draft: market, referencePrice: '90' });
    const orderId = (await engine.snapshot()).orders[0]!.orderId;
    const before = (await store.readAll()).length;
    const result = await engine.execute({ type: 'recordFill', commandId: 'market-fill', orderId, price: '100', quantity: '1' });
    expect(result).toMatchObject({ ok: false, error: { code: 'ORDER_INSUFFICIENT_BALANCE' } });
    expect(await store.readAll()).toHaveLength(before);
    expect((await engine.snapshot()).account.availableCash).toBe('9.91');
  });
});
