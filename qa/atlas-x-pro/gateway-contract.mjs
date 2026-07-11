import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  VERSION,
  INTERVAL_MS,
  OKX_INTERVAL,
  BYBIT_INTERVAL,
  normalizeBinanceCandles,
  normalizeOkxCandles,
  normalizeBybitCandles,
  normalizeBinanceSnapshot,
  normalizeOkxSnapshot,
  normalizeBybitSnapshot,
  normalizeSymbol,
  toOkxInstrument,
  validateCandleSpacing,
} from '../../supabase/functions/atlas-market-gateway/normalizers.mjs';

const checks = {};
let fatalError = null;
let passed = false;

const now = 1_783_753_357_000;
const step = INTERVAL_MS['1m'];
const binanceRows = [
  [now - step * 2, '64000', '64100', '63950', '64080', '12.5', now - step - 1, '800900', 120],
  [now - step, '64080', '64200', '64020', '64190', '9.2', now - 1, '590800', 98],
];
const okxPayload = {
  code: '0',
  data: [
    [String(now - step), '64080', '64200', '64020', '64190', '9.2', '9.2', '590800', '1'],
    [String(now - step * 2), '64000', '64100', '63950', '64080', '12.5', '12.5', '800900', '1'],
  ],
};
const bybitPayload = {
  retCode: 0,
  result: {
    list: [
      [String(now - step), '64080', '64200', '64020', '64190', '9.2', '590800'],
      [String(now - step * 2), '64000', '64100', '63950', '64080', '12.5', '800900'],
    ],
  },
};

function assertCandleShape(candles, provider) {
  assert.equal(candles.length, 2);
  assert.equal(candles[0].provider, provider);
  assert.ok(validateCandleSpacing(candles, '1m'));
  for (const candle of candles) {
    assert.deepEqual(Object.keys(candle), [
      'time', 'closeTime', 'open', 'high', 'low', 'close', 'volume', 'quoteVolume', 'trades', 'closed', 'provider',
    ]);
    assert.ok(candle.time > 0);
    assert.ok(candle.closeTime > candle.time);
    assert.ok(candle.high >= candle.open && candle.high >= candle.close);
    assert.ok(candle.low <= candle.open && candle.low <= candle.close);
  }
}

try {
  checks.version = VERSION === 'atlas.market.v1';
  checks.intervalSet = Object.keys(INTERVAL_MS).join(',') === '1m,3m,5m,15m,30m,1h,2h,4h,6h,12h,1d,1w';
  checks.okxIntervals = OKX_INTERVAL['1h'] === '1H' && OKX_INTERVAL['1d'] === '1D' && OKX_INTERVAL['1w'] === '1W';
  checks.bybitIntervals = BYBIT_INTERVAL['1h'] === '60' && BYBIT_INTERVAL['1d'] === 'D' && BYBIT_INTERVAL['1w'] === 'W';
  checks.symbolNormalization = normalizeSymbol('btc-usdt') === 'BTCUSDT' && toOkxInstrument('BTCUSDT') === 'BTC-USDT';

  const binanceCandles = normalizeBinanceCandles(binanceRows, '1m');
  const okxCandles = normalizeOkxCandles(okxPayload, '1m');
  const bybitCandles = normalizeBybitCandles(bybitPayload, '1m');
  assertCandleShape(binanceCandles, 'binance');
  assertCandleShape(okxCandles, 'okx');
  assertCandleShape(bybitCandles, 'bybit');
  checks.binanceCandles = true;
  checks.okxCandles = true;
  checks.bybitCandles = true;
  checks.sameCanonicalOhlc = [binanceCandles, okxCandles, bybitCandles]
    .every(candles => candles[1].open === 64080 && candles[1].high === 64200 && candles[1].low === 64020 && candles[1].close === 64190);

  const binanceSnapshot = normalizeBinanceSnapshot({
    symbol: 'BTCUSDT',
    receivedAt: now,
    ticker: { lastPrice: '64237.6', openPrice: '63821.2', highPrice: '64699', lowPrice: '63663.3', volume: '5933.68', quoteVolume: '380499622', priceChangePercent: '0.65', closeTime: now - 5, bidPrice: '64237.6', askPrice: '64237.7' },
    book: { lastUpdateId: 12, bids: [['64237.6', '0.7']], asks: [['64237.7', '0.4']] },
    trades: [{ id: 1, price: '64237.6', qty: '0.01', quoteQty: '642.376', time: now - 10, isBuyerMaker: false }],
  });
  const okxSnapshot = normalizeOkxSnapshot({
    symbol: 'BTCUSDT',
    receivedAt: now,
    ticker: { data: [{ last: '64228.5', open24h: '63816.7', high24h: '64694.9', low24h: '63664', vol24h: '5569.4', volCcy24h: '357396896', ts: String(now - 5), bidPx: '64228.5', askPx: '64228.6' }] },
    book: { data: [{ bids: [['64228.5', '1.8', '0', '2']], asks: [['64228.6', '1.4', '0', '1']], ts: String(now - 5), seqId: '22' }] },
    trades: { data: [{ tradeId: 'okx-1', px: '64228.5', sz: '0.01', ts: String(now - 10), side: 'buy' }] },
  });
  const bybitSnapshot = normalizeBybitSnapshot({
    symbol: 'BTCUSDT',
    receivedAt: now,
    ticker: { time: now - 5, result: { list: [{ lastPrice: '64237.6', prevPrice24h: '63821.2', highPrice24h: '64699', lowPrice24h: '63663.3', turnover24h: '380499622', volume24h: '5933.68', price24hPcnt: '0.0065', bid1Price: '64237.6', ask1Price: '64237.7' }] } },
    book: { time: now - 5, result: { u: 33, b: [['64237.6', '0.7']], a: [['64237.7', '0.4']] } },
    trades: { result: { list: [{ execId: 'bybit-1', price: '64237.6', size: '0.01', time: String(now - 10), side: 'Buy' }] } },
  });

  for (const snapshot of [binanceSnapshot, okxSnapshot, bybitSnapshot]) {
    assert.equal(snapshot.version, VERSION);
    assert.equal(snapshot.symbol, 'BTCUSDT');
    assert.ok(snapshot.ticker.price > 0);
    assert.ok(snapshot.book.bids.length > 0 && snapshot.book.asks.length > 0);
    assert.ok(snapshot.trades.length > 0);
    assert.ok(snapshot.serverTime > 0 && snapshot.receivedAt >= snapshot.serverTime);
  }
  checks.snapshotContract = true;
  checks.providersDistinct = new Set([binanceSnapshot.provider, okxSnapshot.provider, bybitSnapshot.provider]).size === 3;

  assert.throws(() => normalizeBinanceCandles(binanceRows, '7m'), /Unsupported interval/);
  checks.unsupportedIntervalRejected = true;

  passed = Object.values(checks).every(Boolean);
} catch (error) {
  fatalError = String(error?.stack || error);
}

await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/gateway-contract-report.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  checks,
  fatalError,
  passed,
}, null, 2));

if (!passed) {
  console.error('ATLAS market gateway contract failed');
  if (fatalError) console.error(fatalError);
  process.exit(1);
}
console.log('ATLAS market gateway contract passed');
