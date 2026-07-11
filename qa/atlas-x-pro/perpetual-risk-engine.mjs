import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { approx, createContext, loadPerpetualCore } from './perpetual-test-harness.mjs';

const context = createContext();
await loadPerpetualCore(context, ['ledger', 'risk']);
const risk = context.AtlasPerpetualRisk;
assert.ok(risk, 'AtlasPerpetualRisk must be exposed');

const long = risk.calculatePosition({
  symbol: 'BTC-USDT-SWAP', side: 'long', quantity: 2, entryPrice: 100,
  markPrice: 110, leverage: 10, marginMode: 'isolated', isolatedMargin: 25,
});
approx(long.notional, 220, 1e-9, 'long notional');
approx(long.unrealizedPnl, 20, 1e-9, 'long pnl');
approx(long.initialMargin, 22, 1e-9, 'long initial margin');
assert.ok(long.maintenanceMargin > 0);
assert.ok(Number.isFinite(long.liquidationPrice) && long.liquidationPrice > 0);

const short = risk.calculatePosition({
  symbol: 'BTC-USDT-SWAP', side: 'short', quantity: 2, entryPrice: 100,
  markPrice: 90, leverage: 10, marginMode: 'isolated', isolatedMargin: 25,
});
approx(short.unrealizedPnl, 20, 1e-9, 'short pnl');
assert.ok(short.liquidationPrice > 100, 'short liquidation must be above entry');

approx(risk.weightedEntry(1, 100, 1, 110), 105, 1e-9, 'weighted entry');
approx(risk.realizedPnl({ side: 'long', quantity: 0.5, entryPrice: 105, exitPrice: 120 }), 7.5, 1e-9, 'long realized pnl');
approx(risk.realizedPnl({ side: 'short', quantity: 0.5, entryPrice: 105, exitPrice: 90 }), 7.5, 1e-9, 'short realized pnl');

const tier = risk.getTier('BTC-USDT-SWAP', 500000);
assert.ok(tier.maxLeverage <= 50, 'large notional must reduce max leverage');
const capped = risk.validateLeverage('BTC-USDT-SWAP', 500000, 125);
assert.equal(capped.ok, false);
assert.equal(capped.maxLeverage, tier.maxLeverage);

const cross = risk.calculateAccount({
  account: { walletBalance: 1000, realizedPnl: 50, feesPaid: 10, fundingPaid: 5 },
  positions: [
    { symbol: 'BTC-USDT-SWAP', side: 'long', quantity: 1, entryPrice: 100, markPrice: 110, leverage: 10, marginMode: 'cross' },
    { symbol: 'ETH-USDT-SWAP', side: 'short', quantity: 2, entryPrice: 50, markPrice: 45, leverage: 5, marginMode: 'cross' },
  ],
});
approx(cross.unrealizedPnl, 20, 1e-9, 'cross pnl');
approx(cross.equity, 1055, 1e-9, 'cross equity');
assert.ok(cross.marginRatio >= 0 && Number.isFinite(cross.marginRatio));

assert.equal(risk.canOpen({
  symbol: 'BTC-USDT-SWAP', notional: 1000, leverage: 20,
  freshness: 'stale', availableMargin: 1000,
}).ok, false, 'stale mark data must block opening');
assert.equal(risk.canOpen({
  symbol: 'BTC-USDT-SWAP', notional: 1000, leverage: 20,
  freshness: 'live', availableMargin: 1000,
}).ok, true);

await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/perpetual-risk-report.json', JSON.stringify({ passed: true, long, short, cross }, null, 2));
console.log('ATLAS X perpetual risk checks passed');
