import { describe, expect, it } from 'vitest';
import type { OrderDraft } from '@atlas-x/contracts';
import { buyLimitDraft as buyLimit, createPaperLedger as ledger, paperStart as start } from './helpers/paper-ledger.js';

describe('order reservations and lifecycle', () => {
  it('reserves buy cash including estimated fee', async () => {
    const { engine } = await ledger();
    const result = await engine.execute({
      type: 'submitOrder', commandId: 'submit-1', draft: buyLimit, referencePrice: '100',
    });
    expect(result.ok).toBe(true);
    const snapshot = await engine.snapshot();
    expect(snapshot.orders[0]).toMatchObject({ status: 'pending', remainingQuantity: '2', feePaid: '0' });
    expect(snapshot.account.availableCash).toBe('799.8');
    expect(snapshot.account.reservations[0]).toMatchObject({ asset: 'USD', amount: '200.2', reason: 'order' });
    expect(snapshot.account.assets).toContainEqual(expect.objectContaining({
      asset: 'USD', available: '799.8', locked: '200.2', total: '1000',
    }));
  });

  it('makes stop orders wait for a trigger', async () => {
    const { engine } = await ledger();
    const draft: OrderDraft = {
      schemaVersion: 'atlas.unified.v1', clientOrderId: 'stop-1', symbol: 'BTC-USD', side: 'buy',
      type: 'stopLimit', quantity: '1', price: '105', stopPrice: '104', createdAt: start,
    };
    await engine.execute({ type: 'submitOrder', commandId: 'submit-stop', draft, referencePrice: '100' });
    expect((await engine.snapshot()).orders[0]?.status).toBe('waitingTrigger');
  });

  it('applies partial and final buy fills with exact fees, cost and reservation release', async () => {
    const { engine } = await ledger();
    await engine.execute({ type: 'submitOrder', commandId: 'submit-1', draft: buyLimit, referencePrice: '100' });
    const orderId = (await engine.snapshot()).orders[0]?.orderId;
    expect(orderId).toBeDefined();
    await engine.execute({ type: 'recordFill', commandId: 'fill-1', orderId: orderId!, price: '99', quantity: '0.5' });
    let snapshot = await engine.snapshot();
    expect(snapshot.orders[0]).toMatchObject({
      status: 'partiallyFilled', filledQuantity: '0.5', remainingQuantity: '1.5',
      averageFillPrice: '99', feePaid: '0.0495',
    });
    expect(snapshot.account.availableCash).toBe('800.3005');
    expect(snapshot.account.reservations[0]?.amount).toBe('150.15');
    expect(snapshot.account.positions[0]).toMatchObject({
      quantity: '0.5', averageEntryPrice: '99.099', realizedPnl: '0',
    });

    await engine.execute({ type: 'recordFill', commandId: 'fill-2', orderId: orderId!, price: '100', quantity: '1.5' });
    snapshot = await engine.snapshot();
    expect(snapshot.orders[0]).toMatchObject({
      status: 'filled', filledQuantity: '2', remainingQuantity: '0', averageFillPrice: '99.75', feePaid: '0.1995',
    });
    expect(snapshot.account.reservations).toHaveLength(0);
    expect(snapshot.account.availableCash).toBe('800.3005');
    expect(snapshot.account.positions[0]).toMatchObject({
      quantity: '2', averageEntryPrice: '99.84975',
    });
  });

  it('cancels an open order and releases its reservation', async () => {
    const { engine } = await ledger();
    await engine.execute({ type: 'submitOrder', commandId: 'submit-1', draft: buyLimit, referencePrice: '100' });
    const orderId = (await engine.snapshot()).orders[0]!.orderId;
    await engine.execute({ type: 'cancelOrder', commandId: 'cancel-1', orderId });
    const snapshot = await engine.snapshot();
    expect(snapshot.orders[0]?.status).toBe('canceled');
    expect(snapshot.account.availableCash).toBe('1000');
    expect(snapshot.account.reservations).toHaveLength(0);
  });

  it('rejects insufficient buy balance with a stable code and no appended event', async () => {
    const { engine, store } = await ledger('10');
    const before = (await store.readAll()).length;
    const result = await engine.execute({ type: 'submitOrder', commandId: 'too-large', draft: buyLimit, referencePrice: '100' });
    expect(result).toMatchObject({ ok: false, error: { code: 'ORDER_INSUFFICIENT_BALANCE' } });
    expect(await store.readAll()).toHaveLength(before);
  });
});
