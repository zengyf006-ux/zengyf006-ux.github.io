import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { approx, createContext, loadPerpetualCore } from './perpetual-test-harness.mjs';

const context = createContext();
await loadPerpetualCore(context, ['ledger', 'risk', 'orders']);
const ledger = context.AtlasPerpetualLedger;
const orders = context.AtlasPerpetualOrders;
assert.ok(orders, 'AtlasPerpetualOrders must be exposed');

const liveMarket = {
  symbol: 'BTC-USDT-SWAP',
  lastPrice: 100,
  markPrice: 100,
  indexPrice: 100,
  freshness: 'live',
  bids: [{ price: 99.9, quantity: 10 }],
  asks: [{ price: 100, quantity: 10 }],
};

let result = await orders.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'buy', positionSide: 'long', type: 'market',
  quantity: 1, leverage: 10, marginMode: 'isolated', timeInForce: 'GTC',
}, liveMarket);
assert.equal(result.ok, true);
assert.equal(result.fillIds.length, 1);
let state = ledger.getState();
let position = state.positions.find(item => item.symbol === 'BTC-USDT-SWAP' && item.side === 'long');
approx(position.quantity, 1, 1e-9, 'initial long quantity');
approx(position.entryPrice, 100, 1e-9, 'initial long entry');

result = await orders.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'buy', positionSide: 'long', type: 'market',
  quantity: 1, leverage: 10, marginMode: 'isolated', timeInForce: 'GTC',
}, { ...liveMarket, lastPrice: 110, markPrice: 110, asks: [{ price: 110, quantity: 10 }] });
assert.equal(result.ok, true);
state = ledger.getState();
position = state.positions.find(item => item.symbol === 'BTC-USDT-SWAP' && item.side === 'long');
approx(position.quantity, 2, 1e-9, 'added long quantity');
approx(position.entryPrice, 105, 1e-9, 'weighted entry');

result = await orders.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'sell', positionSide: 'long', type: 'market',
  quantity: 0.5, leverage: 10, marginMode: 'isolated', reduceOnly: true,
}, { ...liveMarket, lastPrice: 120, markPrice: 120, bids: [{ price: 120, quantity: 10 }] });
assert.equal(result.ok, true);
state = ledger.getState();
position = state.positions.find(item => item.symbol === 'BTC-USDT-SWAP' && item.side === 'long');
approx(position.quantity, 1.5, 1e-9, 'reduced quantity');
approx(position.realizedPnl, 7.5, 1e-9, 'realized pnl');

result = await orders.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'sell', positionSide: 'long', type: 'market',
  quantity: 2, leverage: 10, marginMode: 'isolated', reduceOnly: true,
}, { ...liveMarket, lastPrice: 120, markPrice: 120, bids: [{ price: 120, quantity: 10 }] });
assert.equal(result.ok, false);
assert.equal(result.errorCode, 'REDUCE_ONLY_EXCEEDS_POSITION');

result = await orders.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'buy', positionSide: 'long', type: 'limit',
  quantity: 1, price: 101, leverage: 10, marginMode: 'isolated', timeInForce: 'POST_ONLY',
}, liveMarket);
assert.equal(result.ok, false);
assert.equal(result.errorCode, 'POST_ONLY_WOULD_TAKE');

result = await orders.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'buy', positionSide: 'long', type: 'limit',
  quantity: 2, price: 100, leverage: 10, marginMode: 'isolated', timeInForce: 'FOK',
}, { ...liveMarket, asks: [{ price: 100, quantity: 1 }] });
assert.equal(result.ok, false);
assert.equal(result.errorCode, 'FOK_NOT_FILLABLE');

result = await orders.submitOrder({
  symbol: 'BTC-USDT-SWAP', side: 'buy', positionSide: 'long', type: 'limit',
  quantity: 2, price: 100, leverage: 10, marginMode: 'isolated', timeInForce: 'IOC',
}, { ...liveMarket, asks: [{ price: 100, quantity: 1 }] });
assert.equal(result.ok, true);
assert.equal(result.filledQuantity, 1);
assert.equal(result.canceledQuantity, 1);

const beforeReload = ledger.getState();
const fillsBefore = beforeReload.fills.length;
await orders.evaluateMarket(liveMarket);
await orders.evaluateMarket(liveMarket);
assert.equal(ledger.getState().fills.length, fillsBefore, 'repeated market evaluation must not duplicate fills');

await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/perpetual-order-report.json', JSON.stringify({ passed: true, state: ledger.getState() }, null, 2));
console.log('ATLAS X perpetual order checks passed');
