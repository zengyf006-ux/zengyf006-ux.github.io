import { useEffect, useMemo, useState } from 'react';
import { SCHEMA_VERSION, type Candle, type Truthfulness } from '@atlas-x/contracts';
import { addDecimal, multiplyDecimal, parseDecimal, subtractDecimal } from '@atlas-x/domain';
import {
  CoinbasePublicCandleAdapter,
  IndexedDbCandleCache,
  type CandleCacheEntry,
  type PublicCandleFetcher,
  type PublicCandleInterval,
} from '@atlas-x/market-data';

export interface PublicCandleState {
  readonly candles: readonly Candle[];
  readonly truthfulness: Truthfulness;
  readonly label: string;
  readonly detail: string;
  readonly loading: boolean;
  readonly error: string | null;
}

const INTERVAL_SECONDS: Readonly<Record<PublicCandleInterval, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

const FIXTURE_CLOSES = [
  '117900', '118050', '117980', '118180', '118260', '118190', '118340', '118420',
  '118310', '118480', '118560', '118510', '118680', '118620', '118760', '118700',
  '118820', '118900', '118840', '118980', '119040', '118960', '119120', '119080',
  '119180', '119260', '119210', '119340', '119280', '119420', '119360', '119500',
] as const;

function createFixtureCandles(symbol: string, interval: PublicCandleInterval): readonly Candle[] {
  const seconds = INTERVAL_SECONDS[interval];
  const end = Date.parse('2026-07-12T00:00:00.000Z') / 1000;
  return FIXTURE_CLOSES.map((close, index) => {
    const previous = FIXTURE_CLOSES[index - 1] ?? subtractDecimal(close, '80');
    const openTimeSeconds = end - (FIXTURE_CLOSES.length - index) * seconds;
    const open = previous;
    const openDecimal = parseDecimal(open);
    const closeDecimal = parseDecimal(close);
    const upper = openDecimal.greaterThan(closeDecimal) ? open : close;
    const lower = openDecimal.lessThan(closeDecimal) ? open : close;
    const high = addDecimal(upper, '90');
    const low = subtractDecimal(lower, '90');
    const volume = `${index + 1}.25`;
    const source = { truthfulness: 'fixture' as const, fixtureId: `web-candles-${interval}`, provider: 'golden-vector' };
    return {
      metadata: {
        schemaVersion: SCHEMA_VERSION,
        id: `fixture-candle-${symbol}-${interval}-${openTimeSeconds}`,
        source,
        sequence: openTimeSeconds,
        serverTime: new Date((openTimeSeconds + seconds) * 1000).toISOString(),
        receivedAt: '2026-07-12T00:00:00.000Z',
      },
      symbol,
      interval,
      openTime: new Date(openTimeSeconds * 1000).toISOString(),
      closeTime: new Date((openTimeSeconds + seconds) * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: multiplyDecimal(close, volume),
      closed: true,
    } satisfies Candle;
  });
}

function cacheCandles(entry: CandleCacheEntry): readonly Candle[] {
  const source = {
    truthfulness: 'cachedReal' as const,
    provider: 'coinbase',
    cacheTime: entry.cacheTime,
  };
  return entry.candles.map((candle) => ({
    ...candle,
    metadata: { ...candle.metadata, source },
  }));
}

function initialState(symbol: string, interval: PublicCandleInterval): PublicCandleState {
  return {
    candles: createFixtureCandles(symbol, interval),
    truthfulness: 'fixture',
    label: '测试 K线 · fixture',
    detail: '确定性图表数据，不代表实时市场',
    loading: true,
    error: null,
  };
}

function browserFetcher(): PublicCandleFetcher {
  return async (url, init) => {
    const response = await globalThis.fetch(url, {
      ...(init?.signal === undefined ? {} : { signal: init.signal }),
      ...(init?.headers === undefined ? {} : { headers: init.headers }),
      ...(init?.cache === undefined ? {} : { cache: init.cache }),
    });
    return response;
  };
}

export function usePublicCandles(symbol: string, interval: PublicCandleInterval): PublicCandleState {
  const fixture = useMemo(() => initialState(symbol, interval), [symbol, interval]);
  const [state, setState] = useState<PublicCandleState>(fixture);

  useEffect(() => {
    setState(fixture);
    if (!('fetch' in globalThis)) {
      setState({ ...fixture, loading: false, error: '当前环境不支持公共 K 线请求。' });
      return;
    }

    let active = true;
    let timer: ReturnType<typeof globalThis.setInterval> | undefined;
    let cache: IndexedDbCandleCache | null = null;
    const controller = new AbortController();
    const adapter = new CoinbasePublicCandleAdapter({
      fetcher: browserFetcher(),
      now: () => new Date().toISOString(),
    });
    if (globalThis.indexedDB !== undefined) {
      cache = new IndexedDbCandleCache({
        factory: globalThis.indexedDB,
        databaseName: 'atlas-x-unified-candles-v1',
        storeName: 'candles',
      });
    }

    async function readCache(): Promise<boolean> {
      if (cache === null) return false;
      try {
        const entry = await cache.read(symbol, interval);
        if (!active || entry === null || entry.candles.length === 0) return false;
        setState({
          candles: cacheCandles(entry),
          truthfulness: 'cachedReal',
          label: '真实 K线缓存',
          detail: `Coinbase · 缓存时间 ${entry.cacheTime}`,
          loading: true,
          error: null,
        });
        return true;
      } catch {
        return false;
      }
    }

    async function refresh() {
      try {
        const candles = await adapter.load(symbol, interval, controller.signal);
        if (!active) return;
        if (candles.length === 0) throw new Error('Coinbase 当前没有返回该周期的 K 线。');
        const cacheTime = new Date().toISOString();
        setState({
          candles,
          truthfulness: 'real',
          label: '实时真实 K线',
          detail: `Coinbase · ${interval} · ${candles.length} 根`,
          loading: false,
          error: null,
        });
        if (cache !== null) {
          try {
            await cache.write(symbol, interval, candles, cacheTime);
          } catch (error) {
            if (active) {
              setState((current) => ({
                ...current,
                error: error instanceof Error ? `实时 K线可用，但本地缓存失败：${error.message}` : '实时 K线可用，但本地缓存失败',
              }));
            }
          }
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        const cached = await readCache();
        if (!active) return;
        if (cached) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : '公共 K 线暂时不可用',
          }));
        } else {
          setState({
            ...fixture,
            loading: false,
            error: error instanceof Error ? error.message : '公共 K 线暂时不可用',
          });
        }
      }
    }

    async function start() {
      await readCache();
      await refresh();
      const requested = INTERVAL_SECONDS[interval] * 1000;
      const refreshMs = Math.min(Math.max(requested, 60_000), 3_600_000);
      if (active) timer = globalThis.setInterval(() => void refresh(), refreshMs);
    }

    void start();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) globalThis.clearInterval(timer);
      void cache?.close();
    };
  }, [fixture, interval, symbol]);

  return state;
}
