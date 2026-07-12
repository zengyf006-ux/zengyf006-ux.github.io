import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../apps/web/src/app/App.js';
import {
  PRODUCT_PAGES,
  createDraft,
  estimateTicket,
  resolveTicketQuantity,
  type TicketState,
} from '../apps/web/src/app/model.js';

const marketTicket: TicketState = {
  side: 'buy',
  type: 'market',
  inputMode: 'quantity',
  inputValue: '0.1',
  limitPrice: '118400',
  stopPrice: '119000',
};

describe('ATLAS X Web product shell', () => {
  it('renders the Chinese trading surface with explicit fixture and paper boundaries', () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('ATLAS X');
    expect(markup).toContain('订单簿');
    expect(markup).toContain('模拟下单');
    expect(markup).toContain('测试数据 · fixture');
    expect(markup).toContain('数据状态');
    expect(markup).toContain('市价');
    expect(markup).toContain('限价');
    expect(markup).toContain('止损市价');
    expect(markup).toContain('止损限价');
    expect(markup).toContain('图表');
    expect(markup).toContain('盘口');
    expect(markup).toContain('下单');
    expect(markup).toContain('成交');
  });

  it('exposes every required product page without duplicate routes', () => {
    expect(PRODUCT_PAGES.map(([, label]) => label)).toEqual([
      '交易', '市场', '自选', '资产', '委托', '成交', '提醒', '设置', '数据健康', '说明',
    ]);
    expect(new Set(PRODUCT_PAGES.map(([id]) => id)).size).toBe(PRODUCT_PAGES.length);
  });

  it('uses the shared decimal-safe domain estimator for order review', () => {
    const estimate = estimateTicket(marketTicket);
    expect(estimate.requestedQuantity).toBe('0.1');
    expect(estimate.filledQuantity).toBe('0.1');
    expect(estimate.fee).toBe('11.843');
    expect(estimate.depthInsufficient).toBe(false);
  });

  it('resolves quantity, amount and percentage inputs without native floating point', () => {
    expect(resolveTicketQuantity(marketTicket)).toBe('0.1');
    expect(resolveTicketQuantity({ ...marketTicket, inputMode: 'amount', inputValue: '11842.035' })).toBe('0.1');
    const buyPercentage = resolveTicketQuantity({ ...marketTicket, inputMode: 'percentage', inputValue: '10' });
    expect(buyPercentage.startsWith('0.084')).toBe(true);
    expect(resolveTicketQuantity({ ...marketTicket, side: 'sell', inputMode: 'percentage', inputValue: '50' })).toBe('0.625');
  });

  it('creates all four contract-valid order draft variants', () => {
    const now = '2026-07-12T00:00:00.000Z';
    const market = createDraft(marketTicket, 'one', now);
    const limit = createDraft({ ...marketTicket, side: 'sell', type: 'limit', limitPrice: '120000' }, 'two', now);
    const stopMarket = createDraft({ ...marketTicket, type: 'stopMarket', stopPrice: '119000' }, 'three', now);
    const stopLimit = createDraft({ ...marketTicket, type: 'stopLimit', stopPrice: '119000', limitPrice: '119100' }, 'four', now);

    expect(market).toMatchObject({ schemaVersion: 'atlas.unified.v1', type: 'market' });
    expect(limit).toMatchObject({ type: 'limit', price: '120000' });
    expect(stopMarket).toMatchObject({ type: 'stopMarket', stopPrice: '119000' });
    expect(stopLimit).toMatchObject({ type: 'stopLimit', stopPrice: '119000', price: '119100' });
  });
});
