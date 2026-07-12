import { SCHEMA_VERSION, type Ticker } from '@atlas-x/contracts';
import {
  decimalString,
  divideDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from '@atlas-x/domain';
import type { MarketDataSnapshot } from '@atlas-x/market-data';
import { marketFixture } from './model.js';

export type MarketPresentationTone = 'positive' | 'warning' | 'neutral' | 'negative';

export interface MarketPresentation {
  readonly label: string;
  readonly detail: string;
  readonly tone: MarketPresentationTone;
  readonly connectionLabel: string;
  readonly ticker: Ticker | null;
}

export interface TickerDisplayMetrics {
  readonly price: string;
  readonly changeAmount: string;
  readonly changePercent: string;
  readonly direction: 'positive' | 'negative' | 'neutral';
}

const CONNECTION_LABELS: Readonly<Record<MarketDataSnapshot['connection']['state'], string>> = {
  initializing: '初始化',
  cached: '缓存',
  live: '实时',
  delayed: '延迟',
  reconnecting: '重连中',
  stale: '已过期',
  offline: '离线',
  degraded: '降级',
  error: '错误',
};

function providerName(provider: string | undefined): string {
  if (provider === undefined) return '未知来源';
  if (provider.toLowerCase() === 'coinbase') return 'Coinbase';
  return provider;
}

export function formatMarketDecimal(value: string): string {
  const canonical = decimalString(parseDecimal(value));
  const negative = canonical.startsWith('-');
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [integer = '0', fraction] = unsigned.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

export function tickerDisplayMetrics(ticker: Ticker): TickerDisplayMetrics {
  const changeAmount = subtractDecimal(ticker.last, ticker.open24h);
  const changePercent = multiplyDecimal(divideDecimal(changeAmount, ticker.open24h), '100');
  const roundedPercent = decimalString(parseDecimal(changePercent).toDecimalPlaces(2));
  const comparison = parseDecimal(changeAmount).comparedTo(0);
  const direction = comparison > 0 ? 'positive' : comparison < 0 ? 'negative' : 'neutral';
  const prefix = comparison > 0 ? '+' : '';
  return {
    price: formatMarketDecimal(ticker.last),
    changeAmount: `${prefix}${formatMarketDecimal(changeAmount)}`,
    changePercent: `${prefix}${roundedPercent}%`,
    direction,
  };
}

export function createFixtureMarketSnapshot(): MarketDataSnapshot {
  const capturedAt = '2026-07-12T00:00:00.000Z';
  const source = {
    truthfulness: 'fixture' as const,
    fixtureId: marketFixture.source.fixtureId,
    provider: marketFixture.source.provider,
  };
  const ticker: Ticker = {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      id: 'fixture-ticker-btc-usd',
      source,
      sequence: 1,
      serverTime: capturedAt,
      receivedAt: capturedAt,
    },
    symbol: marketFixture.symbol,
    bid: marketFixture.bids[0].price,
    ask: marketFixture.asks[0].price,
    last: marketFixture.last,
    open24h: '115894.15',
    high24h: '119200',
    low24h: '114800',
    baseVolume24h: '1240.5',
    quoteVolume24h: '146500000',
  };
  return {
    capturedAt,
    truthfulness: 'fixture',
    connection: {
      schemaVersion: SCHEMA_VERSION,
      state: 'live',
      source,
      updatedAt: capturedAt,
      latencyMs: 0,
      retryAt: null,
      error: null,
    },
    tickers: [ticker],
  };
}

export function presentMarketSnapshot(snapshot: MarketDataSnapshot): MarketPresentation {
  const ticker = snapshot.tickers.find((item) => item.symbol === marketFixture.symbol)
    ?? snapshot.tickers[0]
    ?? null;
  const connectionLabel = CONNECTION_LABELS[snapshot.connection.state];
  const source = snapshot.connection.source;

  switch (snapshot.truthfulness) {
    case 'real': {
      const provider = 'provider' in source ? providerName(source.provider) : '未知来源';
      const latency = snapshot.connection.latencyMs;
      return {
        label: '实时真实',
        detail: latency === undefined ? provider : `${provider} · ${latency} ms`,
        tone: snapshot.connection.state === 'live' ? 'positive' : 'warning',
        connectionLabel,
        ticker,
      };
    }
    case 'cachedReal': {
      const provider = 'provider' in source ? providerName(source.provider) : '真实来源';
      const cacheTime = source.truthfulness === 'cachedReal' ? source.cacheTime : snapshot.capturedAt;
      return {
        label: '真实缓存',
        detail: `${provider} · 缓存时间 ${cacheTime}`,
        tone: 'warning',
        connectionLabel,
        ticker,
      };
    }
    case 'fixture':
      return {
        label: '测试数据 · fixture',
        detail: '确定性测试数据，不代表实时市场',
        tone: 'warning',
        connectionLabel: '测试',
        ticker,
      };
    case 'simulated':
      return {
        label: '模拟行情',
        detail: '模拟场景数据，不代表实时市场',
        tone: 'warning',
        connectionLabel,
        ticker,
      };
    case 'unknown':
      return {
        label: '来源未知',
        detail: '无法确认数据真实性',
        tone: 'negative',
        connectionLabel,
        ticker,
      };
  }
}
