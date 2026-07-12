import { describe, expect, it } from 'vitest';
import type { OrderDraft } from '@atlas-x/contracts';
import {
  IndexedDbPaperTradingEventStore,
  PaperTradingLedger,
  type PaperTradingEvent,
} from '@atlas-x/paper-trading';
import { createFakeIndexedDbFactory } from './helpers/fake-indexeddb.js';

const start = '2026-07-12T00:00:00.000Z';

function ids(): () => string {
  let value = 0;
  return () => `persist-${++value}`;
}

function clock(): () => string {
  let value = Date.parse(start);
  return () => new Date(value++).toISOString();
}

const draft: OrderDraft = {
  schemaVersion: 'atlas.unified.v1',
  clientOrderId: 'persist-buy',
  symbol: 'BTC-USD',
  side: 'buy',
  type: 'limit',
  quantity: '1',
  price: '100',
  createdAt: start,
};

describe('IndexedDB paper event persistence', () => {
  it('persists events in sequence order and deduplicates identical event ids', async () => {
    const store = new IndexedDbPaperTradingEventStore({ factory: createFakeIndexedDbFactory() });
    const later: PaperTradingEvent = {
      type: 'accountInitialized', eventId: 'event-2', commandId: 'command-2', sequence: 2,
      occurredAt: start, accountId: 'paper', baseCurrency: 'USD', initialCash: '200',
    };
    const earlier: PaperTradingEvent = {
      type: 'accountInitialized', eventId: 'event-1', commandId: 'command-1', sequence: 1,
      occurredAt: start, accountId: 'paper', baseCurrency: 'USD', initialCash: '100',
    };
    await store.append([later, earlier, earlier]);
    expect((await store.readAll()).map((event) => event.eventId)).toEqual(['event-1', 'event-2']);
    await store.destroy();
  });

  it('reconstructs an identical account after a new ledger opens the same database', async () => {
    const factory = createFakeIndexedDbFactory();
    const firstStore = new IndexedDbPaperTradingEventStore({ factory, databaseName: 'reload' });
    const first = new PaperTradingLedger({
      store: firstStore, accountId: 'paper-main', baseCurrency: 'USD', initialCash: '1000', feeRate: '0.001',
      now: clock(), id: ids(),
    });
    await first.initialize('init');
    await first.execute({ type: 'submitOrder', commandId: 'submit', draft, referencePrice: '100' });
    const orderId = (await first.snapshot()).orders[0]!.orderId;
    await first.execute({ type: 'recordFill', commandId: 'fill', orderId, price: '99', quantity: '0.4' });
    const before = await first.snapshot();
    await firstStore.close();

    const secondStore = new IndexedDbPaperTradingEventStore({ factory, databaseName: 'reload' });
    const second = new PaperTradingLedger({
      store: secondStore, accountId: 'paper-main', baseCurrency: 'USD', initialCash: '999999', feeRate: '0.001',
      now: clock(), id: ids(),
    });
    await second.initialize('ignored-on-reload');
    const after = await second.snapshot();
    expect(after.account).toEqual(before.account);
    expect(after.orders).toEqual(before.orders);
    expect(after.fills).toEqual(before.fills);
    await secondStore.destroy();
  });

  it('clears and replaces the event stream atomically for confirmed resets', async () => {
    const store = new IndexedDbPaperTradingEventStore({ factory: createFakeIndexedDbFactory() });
    const initial: PaperTradingEvent = {
      type: 'accountInitialized', eventId: 'initial', commandId: 'init', sequence: 1,
      occurredAt: start, accountId: 'paper', baseCurrency: 'USD', initialCash: '100',
    };
    const reset: PaperTradingEvent = {
      type: 'accountReset', eventId: 'reset', commandId: 'reset-command', sequence: 1,
      occurredAt: start, accountId: 'paper', baseCurrency: 'USD', initialCash: '500',
    };
    await store.append([initial]);
    await store.replaceAll([reset]);
    expect(await store.readAll()).toEqual([reset]);
    await store.destroy();
  });
});
