import type { OrderDraft } from '@atlas-x/contracts';
import { estimateOrder, type OrderEstimate } from '@atlas-x/domain';

export const PRODUCT_PAGES = [
  ['terminal', '交易'], ['markets', '市场'], ['watchlist', '自选'], ['assets', '资产'],
  ['orders', '委托'], ['fills', '成交'], ['alerts', '提醒'], ['settings', '设置'],
  ['health', '数据健康'], ['help', '说明'],
] as const;

export type ProductPage = (typeof PRODUCT_PAGES)[number][0];
export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type TicketState = Readonly<{
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: string;
  limitPrice: string;
}>;

export const marketFixture = {
  symbol: 'BTC-USD',
  last: '118420.35',
  change: '+2.18%',
  source: { truthfulness: 'fixture' as const, fixtureId: 'atlas-web-v1', provider: 'golden-vector' },
  bids: [
    { price: '118410', quantity: '0.82' },
    { price: '118400', quantity: '1.25' },
    { price: '118390', quantity: '2.10' },
  ],
  asks: [
    { price: '118430', quantity: '0.64' },
    { price: '118440', quantity: '1.48' },
    { price: '118450', quantity: '2.32' },
  ],
} as const;

export function estimateTicket(ticket: TicketState): OrderEstimate {
  return estimateOrder({
    side: ticket.side,
    orderType: ticket.type,
    quantity: ticket.quantity,
    ...(ticket.type === 'limit' ? { limitPrice: ticket.limitPrice } : {}),
    feeRate: '0.001',
    availableBase: '1.25',
    availableQuote: '100000',
    orderBook: { bids: marketFixture.bids, asks: marketFixture.asks },
  });
}

export function createDraft(ticket: TicketState, id: string, now: string): OrderDraft {
  const base = {
    schemaVersion: 'atlas.unified.v1' as const,
    clientOrderId: id,
    symbol: marketFixture.symbol,
    side: ticket.side,
    quantity: ticket.quantity,
    createdAt: now,
  };
  return ticket.type === 'market'
    ? { ...base, type: 'market' }
    : { ...base, type: 'limit', price: ticket.limitPrice };
}
