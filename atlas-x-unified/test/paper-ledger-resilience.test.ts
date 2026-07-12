import { describe, expect, it } from 'vitest';
import {
  PaperTradingLedger,
  replayPaperTradingEvents,
  type PaperTradingEvent,
  type PaperTradingEventStore,
} from '@atlas-x/paper-trading';
import {
  buyLimitDraft as buyLimit,
  paperClock as clock,
  paperIds as ids,
  paperStart as start,
} from './helpers/paper-ledger.js';

describe('event-store durability and corruption handling', () => {
  it('returns STORAGE_FAILURE and keeps state unchanged when append fails', async () => {
    class FailingStore implements PaperTradingEventStore {
      private readonly events: PaperTradingEvent[] = [];
      fail = false;
      async append(events: readonly PaperTradingEvent[]): Promise<void> {
        if (this.fail) throw new Error('disk full');
        this.events.push(...structuredClone(events));
      }
      async readAll(): Promise<readonly PaperTradingEvent[]> { return structuredClone(this.events); }
      async clear(): Promise<void> { this.events.length = 0; }
      async replaceAll(events: readonly PaperTradingEvent[]): Promise<void> { this.events.splice(0, this.events.length, ...structuredClone(events)); }
    }
    const store = new FailingStore();
    const engine = new PaperTradingLedger({
      store, accountId: 'paper-main', baseCurrency: 'USD', initialCash: '1000', feeRate: '0.001', now: clock(), id: ids(),
    });
    await engine.initialize('init');
    const before = engine.state();
    store.fail = true;
    const result = await engine.execute({ type: 'submitOrder', commandId: 'submit-fail', draft: buyLimit, referencePrice: '100' });
    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_FAILURE', retryable: true } });
    expect(engine.state()).toEqual(before);
  });

  it('rejects a replay stream with a sequence gap', () => {
    const events: PaperTradingEvent[] = [
      { type: 'accountInitialized', eventId: 'event-1', commandId: 'init', sequence: 1, occurredAt: start, accountId: 'paper-main', baseCurrency: 'USD', initialCash: '1000' },
      { type: 'marketPriceMarked', eventId: 'event-3', commandId: 'mark', sequence: 3, occurredAt: start, symbol: 'BTC-USD', price: '100', triggeredOrders: [] },
    ];
    expect(() => replayPaperTradingEvents(events)).toThrowError(expect.objectContaining({ code: 'STORAGE_FAILURE' }));
  });




});
