import type { OrderDraft } from '@atlas-x/contracts';
import { MemoryPaperTradingEventStore, PaperTradingLedger } from '@atlas-x/paper-trading';

export const paperStart = '2026-07-12T00:00:00.000Z';

export function paperIds(): () => string {
  let value = 0;
  return () => `id-${++value}`;
}

export function paperClock(): () => string {
  let value = Date.parse(paperStart);
  return () => new Date(value++).toISOString();
}

export const buyLimitDraft: OrderDraft = {
  schemaVersion: 'atlas.unified.v1',
  clientOrderId: 'buy-1',
  symbol: 'BTC-USD',
  side: 'buy',
  type: 'limit',
  quantity: '2',
  price: '100',
  createdAt: paperStart,
};

export async function createPaperLedger(initialCash = '1000') {
  const store = new MemoryPaperTradingEventStore();
  const engine = new PaperTradingLedger({
    store,
    accountId: 'paper-main',
    baseCurrency: 'USD',
    initialCash,
    feeRate: '0.001',
    now: paperClock(),
    id: paperIds(),
  });
  await engine.initialize('initialize-1');
  return { engine, store };
}
