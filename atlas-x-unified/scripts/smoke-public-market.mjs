const baseUrl = process.env.ATLAS_PUBLIC_MARKET_BASE_URL ?? 'https://api.exchange.coinbase.com';
const productId = process.env.ATLAS_PUBLIC_MARKET_PRODUCT ?? 'BTC-USD';
const attempts = 3;

function decimalLike(value, label) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error(`Invalid public market ${label}`);
  }
  return value;
}

async function requestJson(path) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          accept: 'application/json',
          'user-agent': 'atlas-x-unified-public-smoke/1.0',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Public market request failed for ${path}`);
}

const ticker = await requestJson(`/products/${encodeURIComponent(productId)}/ticker`);
if (ticker === null || typeof ticker !== 'object' || Array.isArray(ticker)) {
  throw new Error('Public market ticker must be an object');
}
decimalLike(ticker.price, 'ticker price');
decimalLike(ticker.bid, 'ticker bid');
decimalLike(ticker.ask, 'ticker ask');
if (typeof ticker.time !== 'string' || Number.isNaN(Date.parse(ticker.time))) {
  throw new Error('Invalid public market ticker time');
}

const book = await requestJson(`/products/${encodeURIComponent(productId)}/book?level=2`);
if (book === null || typeof book !== 'object' || Array.isArray(book)
  || !Array.isArray(book.bids) || !Array.isArray(book.asks)
  || book.bids.length === 0 || book.asks.length === 0) {
  throw new Error('Public market level2 book is empty or invalid');
}
for (const [label, level] of [['bid', book.bids[0]], ['ask', book.asks[0]]]) {
  if (!Array.isArray(level) || level.length < 2) throw new Error(`Invalid public market ${label} level`);
  decimalLike(level[0], `${label} price`);
  decimalLike(level[1], `${label} quantity`);
}

const candles = await requestJson(`/products/${encodeURIComponent(productId)}/candles?granularity=60`);
if (!Array.isArray(candles) || candles.length === 0 || !Array.isArray(candles[0]) || candles[0].length < 6) {
  throw new Error('Public market candles are empty or invalid');
}
for (const value of candles[0].slice(1, 6)) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Invalid upstream public candle value');
  }
}

console.log(JSON.stringify({
  provider: 'coinbase-exchange',
  truthfulness: 'real',
  productId,
  observedAt: new Date().toISOString(),
  tickerTime: ticker.time,
  bookBidLevels: book.bids.length,
  bookAskLevels: book.asks.length,
  candleCount: candles.length,
}));
