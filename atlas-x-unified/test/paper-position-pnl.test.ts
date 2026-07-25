import { describe, expect, it } from 'vitest';
import type { OrderDraft } from '@atlas-x/contracts';
import { buyLimitDraft as buyLimit, createPaperLedger as ledger, paperStart as start } from './helpers/paper-ledger.js';

describe('sell fills, pnl and mark prices', () => {
  it('reserves base quantity, realizes pnl and retains exact fee history', async () => {
    const { engine } = await ledger();
    await engine.execute({ type: 'submitOrder', commandId: 'buy-submit', draft: buyLimit, referencePrice: '100' });
    const buyOrder = (await engine.snapshot()).orders[0]!.orderId;
    await engine.execute({ type: 'recordFill', commandId: 'buy-fill', orderId: buyOrder, price: '100', quantity: '2' });

    const sell: OrderDraft = {
      schemaVersion: 'atlas.unified.v1', clientOrderId: 'sell-1', symbol: 'BTC-USD', side: 'sell',
      type: 'limit', quantity: '1', price: '120', createdAt: start,
    };
    await engine.execute({ type: 'submitOrder', commandId: 'sell-submit', draft: sell, referencePrice: '120' });
    let snapshot = await engine.snapshot();
    expect(snapshot.account.assets).toContainEqual(expect.objectContaining({
      asset: 'BTC', available: '1', locked: '1', total: '2',
    }));
    const sellOrder = snapshot.orders.find((order) => order.draft.clientOrderId === 'sell-1')!.orderId;
    await engine.execute({ type: 'recordFill', commandId: 'sell-fill', orderId: sellOrder, price: '120', quantity: '1' });
    snapshot = await engine.snapshot();
    expect(snapshot.account.positions[0]).toMatchObject({
      quantity: '1', averageEntryPrice: '100.1', realizedPnl: '19.78',
    });
    expect(snapshot.account.availableCash).toBe('919.68');
    expect(snapshot.fills.at(-1)).toMatchObject({ quoteAmount: '120', fee: '0.12', feeAsset: 'USD' });
  });

  it('updates equity and unrealized pnl from a marked market price', async () => {
    const { engine } = await ledger();
    await engine.execute({ type: 'submitOrder', commandId: 'buy-submit', draft: buyLimit, referencePrice: '100' });
    const orderId = (await engine.snapshot()).orders[0]!.orderId;
    await engine.execute({ type: 'recordFill', commandId: 'buy-fill', orderId, price: '100', quantity: '2' });
    await engine.execute({ type: 'markPrice', commandId: 'mark-1', symbol: 'BTC-USD', price: '110' });
    const snapshot = await engine.snapshot();
    expect(snapshot.account.positions[0]).toMatchObject({
      marketPrice: '110', marketValue: '220', unrealizedPnl: '19.8',
    });
    expect(snapshot.account.equity).toBe('1019.8');
  });
});
