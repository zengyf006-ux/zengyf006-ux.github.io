import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createContext, loadPerpetualCore, loadRuntime } from './perpetual-test-harness.mjs';

let marketState = {
  symbol: 'BTCUSDT',
  connectionState: 'live',
  provider: 'fixture',
  lastReceivedAt: Date.now(),
  ticker: { price: 100 },
  book: { bids: [[99.9, 50, 50]], asks: [[100, 50, 50]] },
  trades: [],
};
let marketListener = null;
const spotSeed = JSON.stringify({ cash: 50000, positions: [], orders: [], history: [] });
const context = createContext({ 'atlasX.pro.v1': spotSeed });
context.AtlasMarketDataEngine = {
  getState: () => structuredClone(marketState),
  subscribe: listener => { marketListener = listener; return () => { marketListener = null; }; },
};
context.__ATLAS_PERPETUAL_MARKET_CONTEXT__ = symbol => ({
  symbol,
  lastPrice: marketState.ticker.price,
  indexPrice: marketState.ticker.price,
  markPrice: marketState.ticker.price,
  fundingRate: 0,
  nextFundingAt: Date.now() + 8 * 60 * 60 * 1000,
  source: 'public',
  freshness: marketState.connectionState === 'live' ? 'live' : 'stale',
  updatedAt: marketState.lastReceivedAt,
});

await loadPerpetualCore(context, ['ledger', 'risk', 'orders']);
await loadRuntime(context, 'atlas-x-pro/perpetual-funding-engine.js');
await loadRuntime(context, 'atlas-x-pro/perpetual-controller.js');

const controller = context.AtlasPerpetual;
const ledger = context.AtlasPerpetualLedger;
assert.ok(controller, 'AtlasPerpetual controller must be exposed');
assert.equal(typeof marketListener, 'function', 'controller must subscribe once to market engine');

let result = await controller.setLeverage('BTC-USDT-SWAP', 20);
assert.equal(result.ok, true);
assert.equal(ledger.getState().preferences.leverageBySymbol['BTC-USDT-SWAP'], 20);
result = await controller.setMarginMode('BTC-USDT-SWAP', 'isolated');
assert.equal(result.ok, true);
assert.equal(ledger.getState().preferences.marginModeBySymbol['BTC-USDT-SWAP'], 'isolated');

result = await controller.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'buy', positionSide: 'long', type: 'market',
  quantity: 1, leverage: 20, marginMode: 'isolated',
});
assert.equal(result.ok, true);
let state = ledger.getState();
let position = state.positions.find(item => item.side === 'long');
assert.ok(position, 'market order must create a long position');
const positionId = position.id;

result = await controller.setPositionProtection(positionId, { takeProfit: 112, stopLoss: 94 });
assert.equal(result.ok, true);
state = ledger.getState();
position = state.positions.find(item => item.id === positionId);
assert.equal(position.takeProfit, 112);
assert.equal(position.stopLoss, 94);

marketState = {
  ...marketState,
  lastReceivedAt: Date.now(),
  ticker: { price: 113 },
  book: { bids: [[113, 50, 50]], asks: [[113.1, 50, 50]] },
};
await marketListener(structuredClone(marketState), { type: 'ticker' });
await controller.flush();
state = ledger.getState();
assert.equal(state.positions.some(item => item.id === positionId), false, 'take-profit must close the protected position');
assert.ok(state.auditEvents.some(item => item.type === 'take_profit' && item.positionId === positionId));

await ledger.reset();
marketState = {
  ...marketState,
  lastReceivedAt: Date.now(),
  ticker: { price: 100 },
  book: { bids: [[99.9, 50, 50]], asks: [[100, 50, 50]] },
};
result = await controller.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'buy', positionSide: 'long', type: 'market',
  quantity: 20, leverage: 100, marginMode: 'isolated',
});
assert.equal(result.ok, true);
state = ledger.getState();
position = state.positions.find(item => item.side === 'long');
assert.ok(position?.liquidationPrice > 0);
const isolatedPositionId = position.id;

marketState = {
  ...marketState,
  lastReceivedAt: Date.now(),
  ticker: { price: Math.max(0.01, position.liquidationPrice * 0.995) },
};
await controller.evaluateNow({ reason: 'liquidation-test' });
state = ledger.getState();
assert.equal(state.positions.some(item => item.id === isolatedPositionId), false, 'isolated position must liquidate below threshold');
assert.ok(state.liquidationEvents.some(item => item.positionId === isolatedPositionId));
assert.ok(state.auditEvents.some(item => item.type === 'liquidation' && item.positionId === isolatedPositionId));
assert.equal(context.localStorage.getItem('atlasX.pro.v1'), spotSeed, 'perpetual liquidation must never mutate spot ledger');

const snapshot = controller.getSnapshot();
assert.equal(snapshot.market.symbol, 'BTC-USDT-SWAP');
assert.ok(snapshot.account && Array.isArray(snapshot.positions));
assert.equal(context.document.documentElement.dataset.perpetualController, 'ready');

await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/perpetual-controller-report.json', JSON.stringify({ passed: true, snapshot, state }, null, 2));
console.log('ATLAS X perpetual controller checks passed');
