import { SCHEMA_VERSION, type Candle } from '@atlas-x/contracts';
import {
  addDecimal,
  decimalString,
  multiplyDecimal,
  parseDecimal,
} from '@atlas-x/domain';

export type PublicCandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type PublicCandleErrorCode = 'MARKET_OFFLINE' | 'MARKET_DEGRADED';

export interface PublicCandleResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type PublicCandleFetcher = (
  url: string,
  init?: {
    readonly signal?: AbortSignal | undefined;
    readonly headers?: Readonly<Record<string, string>>;
    readonly cache?: RequestCache;
  },
) => Promise<PublicCandleResponse>;

export interface CoinbasePublicCandleAdapterOptions {
  readonly fetcher: PublicCandleFetcher;
  readonly now: () => string;
  readonly baseUrl?: string;
}

export class CoinbasePublicCandleError extends Error {
  constructor(readonly code: PublicCandleErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CoinbasePublicCandleError';
  }
}

const GRANULARITY: Readonly<Record<Exclude<PublicCandleInterval, '4h'>, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1d': 86400,
};

interface ParsedCandleRow {
  readonly time: number;
  readonly low: string;
  readonly high: string;
  readonly open: string;
  readonly close: string;
  readonly volume: string;
}

function canonicalNumber(value: unknown, label: string, allowZero: boolean): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CoinbasePublicCandleError('MARKET_DEGRADED', `Invalid Coinbase candle ${label}`);
  }
  let parsed;
  try {
    parsed = parseDecimal(String(value));
  } catch (error) {
    throw new CoinbasePublicCandleError('MARKET_DEGRADED', `Invalid Coinbase candle ${label}`, { cause: error });
  }
  if (allowZero ? parsed.isNegative() : !parsed.greaterThan(0)) {
    throw new CoinbasePublicCandleError('MARKET_DEGRADED', `Invalid Coinbase candle ${label}`);
  }
  return decimalString(parsed);
}

function parseRow(value: unknown): ParsedCandleRow {
  if (!Array.isArray(value) || value.length < 6) {
    throw new CoinbasePublicCandleError('MARKET_DEGRADED', 'Invalid Coinbase candle row');
  }
  const [timeValue, lowValue, highValue, openValue, closeValue, volumeValue] = value;
  if (!Number.isSafeInteger(timeValue) || (timeValue as number) < 0) {
    throw new CoinbasePublicCandleError('MARKET_DEGRADED', 'Invalid Coinbase candle timestamp');
  }
  const row = {
    time: timeValue as number,
    low: canonicalNumber(lowValue, 'low', false),
    high: canonicalNumber(highValue, 'high', false),
    open: canonicalNumber(openValue, 'open', false),
    close: canonicalNumber(closeValue, 'close', false),
    volume: canonicalNumber(volumeValue, 'volume', true),
  };
  const low = parseDecimal(row.low);
  const high = parseDecimal(row.high);
  const open = parseDecimal(row.open);
  const close = parseDecimal(row.close);
  if (high.lessThan(low) || high.lessThan(open) || high.lessThan(close) || low.greaterThan(open) || low.greaterThan(close)) {
    throw new CoinbasePublicCandleError('MARKET_DEGRADED', 'Inconsistent Coinbase candle range');
  }
  return row;
}

function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function contractCandle(
  symbol: string,
  interval: PublicCandleInterval,
  row: ParsedCandleRow,
  intervalSeconds: number,
  receivedAt: string,
): Candle {
  const closeTimeSeconds = row.time + intervalSeconds;
  return {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      id: `coinbase-candle-${symbol}-${interval}-${row.time}`,
      source: { truthfulness: 'real', provider: 'coinbase' },
      sequence: row.time,
      serverTime: isoFromSeconds(closeTimeSeconds),
      receivedAt,
    },
    symbol,
    interval,
    openTime: isoFromSeconds(row.time),
    closeTime: isoFromSeconds(closeTimeSeconds),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    quoteVolume: multiplyDecimal(row.close, row.volume),
    closed: Date.parse(receivedAt) >= closeTimeSeconds * 1000,
  };
}

function aggregateFourHour(symbol: string, hourly: readonly Candle[], receivedAt: string): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const candle of hourly) {
    const seconds = Date.parse(candle.openTime) / 1000;
    const bucket = Math.floor(seconds / 14400) * 14400;
    const current = buckets.get(bucket) ?? [];
    current.push(candle);
    buckets.set(bucket, current);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucket, values]) => {
      const ordered = [...values].sort((left, right) => Date.parse(left.openTime) - Date.parse(right.openTime));
      const first = ordered[0];
      const last = ordered.at(-1);
      if (first === undefined || last === undefined) {
        throw new CoinbasePublicCandleError('MARKET_DEGRADED', 'Empty four-hour candle bucket');
      }
      const high = ordered.reduce((current, candle) => parseDecimal(candle.high).greaterThan(current) ? parseDecimal(candle.high) : current, parseDecimal(first.high));
      const low = ordered.reduce((current, candle) => parseDecimal(candle.low).lessThan(current) ? parseDecimal(candle.low) : current, parseDecimal(first.low));
      const volume = ordered.reduce((current, candle) => addDecimal(current, candle.volume), '0');
      const quoteVolume = ordered.reduce((current, candle) => addDecimal(current, candle.quoteVolume), '0');
      const closeTimeSeconds = bucket + 14400;
      return {
        metadata: {
          schemaVersion: SCHEMA_VERSION,
          id: `coinbase-candle-${symbol}-4h-${bucket}`,
          source: { truthfulness: 'real' as const, provider: 'coinbase' },
          sequence: bucket,
          serverTime: isoFromSeconds(closeTimeSeconds),
          receivedAt,
        },
        symbol,
        interval: '4h' as const,
        openTime: isoFromSeconds(bucket),
        closeTime: isoFromSeconds(closeTimeSeconds),
        open: first.open,
        high: decimalString(high),
        low: decimalString(low),
        close: last.close,
        volume,
        quoteVolume,
        closed: Date.parse(receivedAt) >= closeTimeSeconds * 1000,
      };
    });
}

export class CoinbasePublicCandleAdapter {
  private readonly fetcher: PublicCandleFetcher;
  private readonly now: () => string;
  private readonly baseUrl: string;

  constructor(options: CoinbasePublicCandleAdapterOptions) {
    this.fetcher = options.fetcher;
    this.now = options.now;
    this.baseUrl = (options.baseUrl ?? 'https://api.exchange.coinbase.com').replace(/\/$/, '');
  }

  async load(symbol: string, interval: PublicCandleInterval, signal?: AbortSignal): Promise<readonly Candle[]> {
    const upstreamInterval = interval === '4h' ? '1h' : interval;
    const granularity = GRANULARITY[upstreamInterval];
    const url = `${this.baseUrl}/products/${encodeURIComponent(symbol)}/candles?granularity=${granularity}`;
    let response: PublicCandleResponse;
    try {
      response = await this.fetcher(url, {
        signal,
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
    } catch (error) {
      throw new CoinbasePublicCandleError('MARKET_OFFLINE', 'Unable to reach Coinbase public candles', { cause: error });
    }
    if (!response.ok) {
      throw new CoinbasePublicCandleError('MARKET_OFFLINE', `Coinbase public candles returned HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new CoinbasePublicCandleError('MARKET_DEGRADED', 'Coinbase public candle response is not JSON', { cause: error });
    }
    if (!Array.isArray(payload) || payload.length > 300) {
      throw new CoinbasePublicCandleError('MARKET_DEGRADED', 'Invalid Coinbase public candle response');
    }

    const receivedAt = this.now();
    const rows = payload.map(parseRow).sort((left, right) => left.time - right.time);
    const candles = rows.map((row) => contractCandle(symbol, upstreamInterval, row, granularity, receivedAt));
    return interval === '4h' ? aggregateFourHour(symbol, candles, receivedAt) : candles;
  }
}
