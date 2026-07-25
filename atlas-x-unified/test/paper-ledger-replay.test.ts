import { describe, expect, it } from 'vitest';
import { replayPaperTradingEvents, type PaperTradingEvent } from '@atlas-x/paper-trading';
import { buyLimitDraft as buyLimit, createPaperLedger as ledger, paperStart as start } from './helpers/paper-ledger.js';

describe('paper trading event replay', () => {
  it('initializes deterministic simulated cash and account metadata', async () => {
    const { engine, store } = await ledger();
    const snapshot = await engine.snapshot();
    expect(snapshot.account).toMatchObject({
      accountId: 'paper-main',
      baseCurrency: 'USD',
      equity: '1000',
      availableCash: '1000',
      metadata: { source: { truthfulness: 'simulated', provider: 'atlas-paper-ledger' } },
    });
    expect(snapshot.account.assets).toContainEqual(expect.objectContaining({
      asset: 'USD', available: '1000', locked: '0', total: '1000',
    }));
    expect(await store.readAll()).toHaveLength(1);
  });

  it('replays the same event stream to an identical state', async () => {
    const { engine, store } = await ledger();
    await engine.execute({ type: 'submitOrder', commandId: 'submit-1', draft: buyLimit, referencePrice: '100' });
    const orderId = (await engine.snapshot()).orders[0]!.orderId;
    await engine.execute({
      type: 'recordFill', commandId: 'fill-1', orderId, price: '99', quantity: '0.5',
    });
    const events = await store.readAll();
    expect(replayPaperTradingEvents(events)).toEqual(engine.state());
  });

  it('ignores duplicate event ids during replay', () => {
    const event: PaperTradingEvent = {
      type: 'accountInitialized', eventId: 'event-1', commandId: 'command-1', sequence: 1,
      occurredAt: start, accountId: 'paper-main', baseCurrency: 'USD', initialCash: '1000',
    };
    const state = replayPaperTradingEvents([event, event]);
    expect(state.lastSequence).toBe(1);
    expect(state.appliedEventIds).toEqual(['event-1']);
  });
});
