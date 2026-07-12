import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../apps/web/src/app/App.js';
import { PRODUCT_PAGES, createDraft, estimateTicket } from '../apps/web/src/app/model.js';

describe('ATLAS X Web product shell', () => {
  it('renders the professional Chinese trading surface with explicit fixture truthfulness', () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('ATLAS X');
    expect(markup).toContain('交易');
    expect(markup).toContain('订单簿');
    expect(markup).toContain('模拟下单');
    expect(markup).toContain('测试数据 · fixture');
    expect(markup).toContain('数据状态');
  });

  it('exposes the required product navigation without placeholder routes', () => {
    expect(PRODUCT_PAGES.map(([, label]) => label)).toEqual([
      '交易', '市场', '自选', '资产', '委托', '成交', '提醒', '设置', '数据健康', '说明',
    ]);
  });

  it('uses the shared decimal-safe domain estimator for order review', () => {
    const estimate = estimateTicket({ side: 'buy', type: 'market', quantity: '0.1', limitPrice: '118400' });
    expect(estimate.requestedQuantity).toBe('0.1');
    expect(estimate.filledQuantity).toBe('0.1');
    expect(estimate.fee).toBe('11.843');
    expect(estimate.depthInsufficient).toBe(false);
  });

  it('creates contract-valid market and limit drafts as distinct types', () => {
    const market = createDraft({ side: 'buy', type: 'market', quantity: '0.1', limitPrice: '0' }, 'one', '2026-07-12T00:00:00.000Z');
    const limit = createDraft({ side: 'sell', type: 'limit', quantity: '0.2', limitPrice: '120000' }, 'two', '2026-07-12T00:00:00.000Z');
    expect(market).toMatchObject({ schemaVersion: 'atlas.unified.v1', type: 'market' });
    expect(limit).toMatchObject({ schemaVersion: 'atlas.unified.v1', type: 'limit', price: '120000' });
  });
});
