export const VERSION = 'atlas.market.v1';

export const INTERVAL_MS = Object.freeze({
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
});

export const OKX_INTERVAL = Object.freeze({
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '6h': '6H',
  '12h': '12H',
  '1d': '1D',
  '1w': '1W',
});

export const BYBIT_INTERVAL = Object.freeze({
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
});

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const positive = value => {
  const number = finite(value);
  return number > 0 ? number : 0;
};

const timestamp = value => {
  const number = finite(value);
  return number > 0 ? Math.trunc(number) : 0;
};

const cleanLevels = rows => (Array.isArray(rows) ? rows : [])
  .map(row => [positive(row?.[0]), positive(row?.[1])])
  .filter(([price, quantity]) => price > 0 && quantity > 0);

export function normalizeSymbol(symbol) {
  return String(symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function toOkxInstrument(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized.endsWith('USDT')) return normalized;
  return `${normalized.slice(0, -4)}-USDT`;
}

export function normalizeCandle(input, provider, interval) {
  const step = INTERVAL_MS[interval];
  if (!step) throw new Error(`Unsupported interval: ${interval}`);
  const time = timestamp(input?.time);
  const open = positive(input?.open);
  const high = positive(input?.high);
  const low = positive(input?.low);
  const close = positive(input?.close);
  const volume = Math.max(0, finite(input?.volume));
  const quoteVolume = Math.max(0, finite(input?.quoteVolume, volume * close));
  if (!time || !open || !high || !low || !close) return null;
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;
  const closeTime = timestamp(input?.closeTime) || (time + step - 1);
  return {
    time,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
    quoteVolume,
    trades: Math.max(0, Math.trunc(finite(input?.trades))),
    closed: input?.closed !== false,
    provider,
  };
}

export function sortAndDedupeCandles(candles) {
  const byTime = new Map();
  for (const candle of candles || []) {
    if (candle?.time) byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function normalizeBinanceCandles(rows, interval) {
  return sortAndDedupeCandles((Array.isArray(rows) ? rows : []).map(row => normalizeCandle({
    time: row?.[0],
    open: row?.[1],
    high: row?.[2],
    low: row?.[3],
    close: row?.[4],
    volume: row?.[5],
    closeTime: row?.[6],
    quoteVolume: row?.[7],
    trades: row?.[8],
    closed: true,
  }, 'binance', interval)).filter(Boolean));
}

export function normalizeOkxCandles(payload, interval) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return sortAndDedupeCandles(rows.map(row => normalizeCandle({
    time: row?.[0],
    open: row?.[1],
    high: row?.[2],
    low: row?.[3],
    close: row?.[4],
    volume: row?.[5],
    quoteVolume: row?.[7] ?? row?.[6],
    trades: 0,
    closed: String(row?.[8] ?? '1') === '1',
  }, 'okx', interval)).filter(Boolean));
}

export function normalizeBybitCandles(payload, interval) {
  const rows = Array.isArray(payload?.result?.list) ? payload.result.list : [];
  return sortAndDedupeCandles(rows.map(row => normalizeCandle({
    time: row?.[0],
    open: row?.[1],
    high: row?.[2],
    low: row?.[3],
    close: row?.[4],
    volume: row?.[5],
    quoteVolume: row?.[6],
    trades: 0,
    closed: true,
  }, 'bybit', interval)).filter(Boolean));
}

export function normalizeBinanceSnapshot({ symbol, ticker, book, trades, receivedAt = Date.now() }) {
  const price = positive(ticker?.lastPrice ?? ticker?.c);
  const open = positive(ticker?.openPrice ?? ticker?.o);
  const high = positive(ticker?.highPrice ?? ticker?.h);
  const low = positive(ticker?.lowPrice ?? ticker?.l);
  if (!price) throw new Error('Binance ticker missing price');
  const serverTime = timestamp(ticker?.closeTime ?? ticker?.E) || receivedAt;
  return {
    version: VERSION,
    symbol: normalizeSymbol(symbol),
    provider: 'binance',
    serverTime,
    receivedAt,
    sequence: timestamp(book?.lastUpdateId) || serverTime,
    ticker: {
      price,
      open,
      high,
      low,
      volume: Math.max(0, finite(ticker?.volume ?? ticker?.v)),
      quoteVolume: Math.max(0, finite(ticker?.quoteVolume ?? ticker?.q)),
      change: finite(ticker?.priceChangePercent ?? ticker?.P, open ? ((price - open) / open) * 100 : 0),
      bid: positive(ticker?.bidPrice ?? ticker?.b),
      ask: positive(ticker?.askPrice ?? ticker?.a),
    },
    book: {
      bids: cleanLevels(book?.bids),
      asks: cleanLevels(book?.asks),
      sequence: timestamp(book?.lastUpdateId) || serverTime,
    },
    trades: (Array.isArray(trades) ? trades : []).map(row => ({
      id: String(row?.id ?? row?.a ?? `${row?.time}-${row?.price}`),
      price: positive(row?.price ?? row?.p),
      qty: positive(row?.qty ?? row?.q),
      quoteQty: Math.max(0, finite(row?.quoteQty)),
      time: timestamp(row?.time ?? row?.T),
      side: (row?.isBuyerMaker ?? row?.m) ? 'sell' : 'buy',
    })).filter(row => row.price > 0 && row.qty > 0 && row.time > 0),
  };
}

export function normalizeOkxSnapshot({ symbol, ticker, book, trades, receivedAt = Date.now() }) {
  const tick = Array.isArray(ticker?.data) ? ticker.data[0] : null;
  const depth = Array.isArray(book?.data) ? book.data[0] : null;
  const price = positive(tick?.last);
  const open = positive(tick?.open24h);
  if (!price) throw new Error('OKX ticker missing price');
  const serverTime = timestamp(tick?.ts ?? depth?.ts) || receivedAt;
  return {
    version: VERSION,
    symbol: normalizeSymbol(symbol),
    provider: 'okx',
    serverTime,
    receivedAt,
    sequence: timestamp(depth?.seqId) || serverTime,
    ticker: {
      price,
      open,
      high: positive(tick?.high24h),
      low: positive(tick?.low24h),
      volume: Math.max(0, finite(tick?.vol24h)),
      quoteVolume: Math.max(0, finite(tick?.volCcy24h)),
      change: open ? ((price - open) / open) * 100 : 0,
      bid: positive(tick?.bidPx),
      ask: positive(tick?.askPx),
    },
    book: {
      bids: cleanLevels(depth?.bids),
      asks: cleanLevels(depth?.asks),
      sequence: timestamp(depth?.seqId) || serverTime,
    },
    trades: (Array.isArray(trades?.data) ? trades.data : []).map(row => ({
      id: String(row?.tradeId ?? `${row?.ts}-${row?.px}`),
      price: positive(row?.px),
      qty: positive(row?.sz),
      quoteQty: positive(row?.px) * positive(row?.sz),
      time: timestamp(row?.ts),
      side: String(row?.side || '').toLowerCase() === 'sell' ? 'sell' : 'buy',
    })).filter(row => row.price > 0 && row.qty > 0 && row.time > 0),
  };
}

export function normalizeBybitSnapshot({ symbol, ticker, book, trades, receivedAt = Date.now() }) {
  const tick = Array.isArray(ticker?.result?.list) ? ticker.result.list[0] : null;
  const depth = book?.result || null;
  const price = positive(tick?.lastPrice);
  const open = positive(tick?.prevPrice24h);
  if (!price) throw new Error('Bybit ticker missing price');
  const serverTime = timestamp(ticker?.time ?? depth?.ts ?? book?.time) || receivedAt;
  return {
    version: VERSION,
    symbol: normalizeSymbol(symbol),
    provider: 'bybit',
    serverTime,
    receivedAt,
    sequence: timestamp(depth?.u) || serverTime,
    ticker: {
      price,
      open,
      high: positive(tick?.highPrice24h),
      low: positive(tick?.lowPrice24h),
      volume: Math.max(0, finite(tick?.volume24h)),
      quoteVolume: Math.max(0, finite(tick?.turnover24h)),
      change: finite(tick?.price24hPcnt) * 100,
      bid: positive(tick?.bid1Price),
      ask: positive(tick?.ask1Price),
    },
    book: {
      bids: cleanLevels(depth?.b),
      asks: cleanLevels(depth?.a),
      sequence: timestamp(depth?.u) || serverTime,
    },
    trades: (Array.isArray(trades?.result?.list) ? trades.result.list : []).map(row => ({
      id: String(row?.execId ?? `${row?.time}-${row?.price}`),
      price: positive(row?.price),
      qty: positive(row?.size),
      quoteQty: positive(row?.price) * positive(row?.size),
      time: timestamp(row?.time),
      side: String(row?.side || '').toLowerCase() === 'sell' ? 'sell' : 'buy',
    })).filter(row => row.price > 0 && row.qty > 0 && row.time > 0),
  };
}

export function validateCandleSpacing(candles, interval) {
  const step = INTERVAL_MS[interval];
  if (!step || !Array.isArray(candles) || candles.length < 2) return false;
  return candles.every((candle, index) => index === 0 || candle.time - candles[index - 1].time === step);
}
