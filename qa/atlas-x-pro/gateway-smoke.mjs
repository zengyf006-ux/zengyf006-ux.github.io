import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = String(process.env.ATLAS_MARKET_GATEWAY || 'https://vtcunypvhtudragsittb.supabase.co/functions/v1/atlas-market-gateway').replace(/\/$/, '');
const checks = {};
const timings = {};
let fatalError = null;
let passed = false;

async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Gateway smoke timeout', 'TimeoutError')), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(path) {
  const started = performance.now();
  const response = await fetchWithTimeout(`${base}${path}`);
  timings[path] = Math.round(performance.now() - started);
  const body = await response.text();
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  const payload = JSON.parse(body);
  assert.equal(payload?.error, undefined, `${path} returned gateway error`);
  return payload;
}

function candleSpacing(payload, expected, label) {
  assert.equal(payload.version, 'atlas.market.v1', `${label} version mismatch`);
  assert.ok(['binance', 'okx', 'bybit'].includes(payload.provider), `${label} used an unknown provider`);
  assert.ok(Array.isArray(payload.candles) && payload.candles.length === 30, `${label} did not return 30 candles`);
  assert.ok(payload.candles.every((candle, index, rows) => index === 0 || Number(candle.time) - Number(rows[index - 1].time) === expected), `${label} spacing mismatch`);
  assert.ok(payload.candles.every(candle => Number(candle.open) > 0 && Number(candle.high) >= Number(candle.low) && Number(candle.close) > 0), `${label} contains invalid OHLC`);
}

async function readStream() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('SSE smoke timeout', 'TimeoutError')), 12_000);
  const started = performance.now();
  try {
    const response = await fetch(`${base}/stream?symbol=BTCUSDT&interval=1m`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    assert.equal(response.status, 200, `stream returned HTTP ${response.status}`);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/i);
    const reader = response.body?.getReader();
    assert.ok(reader, 'stream body reader unavailable');
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < 120_000) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes('event: status') && (text.includes('event: snapshot') || text.includes('event: ticker'))) break;
    }
    await reader.cancel().catch(() => {});
    timings.streamFirstData = Math.round(performance.now() - started);
    return text;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

try {
  const health = await fetchJson('/health');
  checks.healthVersion = health.version === 'atlas.market.v1';
  checks.healthTimestamp = Number(health.serverTime) > 0;
  checks.healthHasProvider = Object.values(health.providers || {}).some(provider => provider.status === 'healthy');

  const oneMinute = await fetchJson('/candles?symbol=BTCUSDT&interval=1m&limit=30');
  const oneDay = await fetchJson('/candles?symbol=BTCUSDT&interval=1d&limit=30');
  candleSpacing(oneMinute, 60_000, '1m');
  candleSpacing(oneDay, 86_400_000, '1d');
  checks.oneMinuteCorrect = true;
  checks.oneDayCorrect = true;
  checks.intervalsDiffer = Number(oneMinute.candles.at(-1).time) !== Number(oneDay.candles.at(-1).time)
    || Number(oneMinute.candles[1].time) - Number(oneMinute.candles[0].time) !== Number(oneDay.candles[1].time) - Number(oneDay.candles[0].time);

  const first = await fetchJson('/snapshot?symbol=BTCUSDT');
  await new Promise(resolve => setTimeout(resolve, 1250));
  const second = await fetchJson('/snapshot?symbol=BTCUSDT');
  for (const snapshot of [first, second]) {
    assert.equal(snapshot.version, 'atlas.market.v1');
    assert.ok(['binance', 'okx', 'bybit'].includes(snapshot.provider));
    assert.ok(Number(snapshot.ticker?.price) > 0);
    assert.ok(Array.isArray(snapshot.book?.bids) && snapshot.book.bids.length > 0);
    assert.ok(Array.isArray(snapshot.book?.asks) && snapshot.book.asks.length > 0);
    assert.ok(Array.isArray(snapshot.trades) && snapshot.trades.length > 0);
    assert.ok(Number(snapshot.serverTime) > 0 && Number(snapshot.receivedAt) >= Number(snapshot.serverTime));
  }
  checks.snapshotContract = true;
  checks.snapshotAdvanced = Number(second.receivedAt) > Number(first.receivedAt);
  checks.noFixtureProvider = first.provider !== 'fixture' && second.provider !== 'fixture';

  const streamText = await readStream();
  checks.streamStatus = streamText.includes('event: status');
  checks.streamMarketData = streamText.includes('event: snapshot') || streamText.includes('event: ticker');
  checks.streamNoFixture = !streamText.includes('"provider":"fixture"');

  passed = Object.values(checks).every(Boolean);
} catch (error) {
  fatalError = String(error?.stack || error);
}

await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/gateway-smoke-report.json', JSON.stringify({
  base,
  generatedAt: new Date().toISOString(),
  checks,
  timings,
  fatalError,
  passed,
}, null, 2));

if (!passed) {
  console.error('ATLAS deployed market gateway smoke failed');
  if (fatalError) console.error(fatalError);
  process.exit(1);
}
console.log('ATLAS deployed market gateway smoke passed');
