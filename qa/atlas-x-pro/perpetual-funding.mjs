import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { approx, createContext, loadPerpetualCore, loadRuntime } from './perpetual-test-harness.mjs';

const now = Date.now();
let marketState = {
  symbol: 'BTCUSDT',
  connectionState: 'live',
  provider: 'fixture',
  lastReceivedAt: now,
  ticker: { price: 100 },
};
const context = createContext();
context.AtlasMarketDataEngine = {
  getState: () => structuredClone(marketState),
  subscribe: () => () => {},
};
context.__ATLAS_PERPETUAL_MARKET_CONTEXT__ = symbol => ({
  symbol,
  lastPrice: 100,
  indexPrice: 99.9,
  markPrice: 100,
  fundingRate: 0.001,
  nextFundingAt: now - 1,
  source: 'public',
  freshness: 'live',
  updatedAt: now,
});

await loadPerpetualCore(context, ['ledger', 'risk']);
await loadRuntime(context, 'atlas-x-pro/perpetual-funding-engine.js');
const ledger = context.AtlasPerpetualLedger;
const funding = context.AtlasPerpetualFunding;
assert.ok(funding, 'AtlasPerpetualFunding must be exposed');

let market = funding.getMarketContext('BTC-USDT-SWAP');
approx(market.markPrice, 100, 1e-9, 'mark price');
approx(market.indexPrice, 99.9, 1e-9, 'index price');
approx(market.fundingRate, 0.001, 1e-12, 'funding rate');
assert.equal(market.source, 'public');
assert.equal(market.freshness, 'live');

await ledger.transact('seed-long', draft => {
  draft.positions.push({
    id: 'long-1', symbol: 'BTC-USDT-SWAP', side: 'long', marginMode: 'cross', leverage: 10,
    quantity: 1, entryPrice: 100, markPrice: 100, initialMargin: 10, realizedPnl: 0,
  });
});
let result = await funding.settleDue(now);
assert.equal(result.settled, 1);
let state = ledger.getState();
approx(state.account.fundingPaid, 0.1, 1e-9, 'long pays positive funding');
assert.equal(state.fundingEvents.length, 1);
assert.equal(state.fundingEvents[0].side, 'long');

result = await funding.settleDue(now + 10);
assert.equal(result.settled, 0, 'same funding window must not settle twice');
assert.equal(ledger.getState().fundingEvents.length, 1);

await ledger.reset();
context.__ATLAS_PERPETUAL_MARKET_CONTEXT__ = symbol => ({
  symbol,
  lastPrice: 100,
  indexPrice: 100,
  markPrice: 100,
  fundingRate: 0.001,
  nextFundingAt: now - 24 * 60 * 60 * 1000,
  source: 'public',
  freshness: 'live',
  updatedAt: now,
});
await ledger.transact('seed-short', draft => {
  draft.positions.push({
    id: 'short-1', symbol: 'BTC-USDT-SWAP', side: 'short', marginMode: 'isolated', leverage: 10,
    quantity: 1, entryPrice: 100, markPrice: 100, isolatedMargin: 10, initialMargin: 10, realizedPnl: 0,
  });
});
result = await funding.settleDue(now);
assert.equal(result.settled, 1, 'offline catch-up settles at most one window');
state = ledger.getState();
approx(state.account.fundingPaid, -0.1, 1e-9, 'short receives positive funding');
assert.equal(state.fundingEvents.length, 1);
assert.equal(state.fundingEvents[0].offlineCatchUp, true);
assert.ok(funding.getCountdown(now) > 0, 'next funding window must be scheduled in the future');

context.__ATLAS_PERPETUAL_MARKET_CONTEXT__ = null;
marketState = { ...marketState, connectionState: 'stale', lastReceivedAt: now - 30_000 };
market = funding.getMarketContext('BTC-USDT-SWAP');
assert.equal(market.source, 'derived');
assert.equal(market.freshness, 'stale');
assert.ok(market.markPrice > 0 && market.indexPrice > 0);

await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/perpetual-funding-report.json', JSON.stringify({ passed: true, state, market }, null, 2));
console.log('ATLAS X perpetual funding checks passed');
