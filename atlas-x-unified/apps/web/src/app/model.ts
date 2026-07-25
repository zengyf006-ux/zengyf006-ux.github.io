import type { OrderDraft } from '@atlas-x/contracts';
import {
  decimalString,
  divideDecimal,
  estimateOrder,
  multiplyDecimal,
  parseDecimal,
  type OrderEstimate,
} from '@atlas-x/domain';

export const PRODUCT_PAGES = [
  ['terminal', '交易'], ['markets', '市场'], ['watchlist', '自选'], ['assets', '资产'],
  ['orders', '委托'], ['fills', '成交'], ['alerts', '提醒'], ['settings', '设置'],
  ['health', '数据健康'], ['help', '说明'],
] as const;

export type ProductPage = (typeof PRODUCT_PAGES)[number][0];
export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type TicketOrderType = 'market' | 'limit' | 'stopMarket' | 'stopLimit';
export type TicketInputMode = 'quantity' | 'amount' | 'percentage';
export type MobileTerminalPane = 'chart' | 'book' | 'order' | 'trades';

export type TicketState = Readonly<{
  side: 'buy' | 'sell';
  type: TicketOrderType;
  inputMode: TicketInputMode;
  inputValue: string;
  limitPrice: string;
  stopPrice: string;
}>;

export const PAPER_AVAILABLE_QUOTE = '100000';
export const PAPER_AVAILABLE_BASE = '1.25';

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

function positive(value: string, label: string): string {
  const parsed = parseDecimal(value);
  if (!parsed.greaterThan(0)) throw new Error(`${label} must be positive`);
  return decimalString(parsed);
}

function executionReference(ticket: TicketState): string {
  return ticket.type === 'limit' || ticket.type === 'stopLimit'
    ? positive(ticket.limitPrice, 'limit price')
    : marketFixture.last;
}

export function resolveTicketQuantity(ticket: TicketState): string {
  const input = positive(ticket.inputValue, 'order input');
  if (ticket.inputMode === 'quantity') return input;
  const reference = executionReference(ticket);
  if (ticket.inputMode === 'amount') return divideDecimal(input, reference);

  const percentage = parseDecimal(input);
  if (percentage.greaterThan(100)) throw new Error('percentage must not exceed 100');
  const ratio = divideDecimal(input, '100');
  if (ticket.side === 'sell') return multiplyDecimal(PAPER_AVAILABLE_BASE, ratio);
  return divideDecimal(multiplyDecimal(PAPER_AVAILABLE_QUOTE, ratio), reference);
}

export function estimateTicket(ticket: TicketState): OrderEstimate {
  const orderType = ticket.type === 'limit' || ticket.type === 'stopLimit' ? 'limit' : 'market';
  return estimateOrder({
    side: ticket.side,
    orderType,
    quantity: resolveTicketQuantity(ticket),
    ...(orderType === 'limit' ? { limitPrice: positive(ticket.limitPrice, 'limit price') } : {}),
    feeRate: '0.001',
    availableBase: PAPER_AVAILABLE_BASE,
    availableQuote: PAPER_AVAILABLE_QUOTE,
    orderBook: { bids: marketFixture.bids, asks: marketFixture.asks },
  });
}

export function createDraft(ticket: TicketState, id: string, now: string): OrderDraft {
  const base = {
    schemaVersion: 'atlas.unified.v1' as const,
    clientOrderId: id,
    symbol: marketFixture.symbol,
    side: ticket.side,
    quantity: resolveTicketQuantity(ticket),
    createdAt: now,
  };

  switch (ticket.type) {
    case 'market': return { ...base, type: 'market' };
    case 'limit': return { ...base, type: 'limit', price: positive(ticket.limitPrice, 'limit price') };
    case 'stopMarket': return { ...base, type: 'stopMarket', stopPrice: positive(ticket.stopPrice, 'stop price') };
    case 'stopLimit': return {
      ...base,
      type: 'stopLimit',
      price: positive(ticket.limitPrice, 'limit price'),
      stopPrice: positive(ticket.stopPrice, 'stop price'),
    };
  }
}
