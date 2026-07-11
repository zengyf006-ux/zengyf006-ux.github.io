(() => {
  'use strict';
  if (window.__ATLAS_STAGE1_LOADER__) return;
  window.__ATLAS_STAGE1_LOADER__ = true;
  document.documentElement.dataset.marketRouter = 'stage1';

  function installQaProvider() {
    if (!window.__ATLAS_QA_MODE__ || window.__ATLAS_MARKET_TEST_PROVIDER__) return;
    const intervalMap = {
      '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
      '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
      '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
      '1d': 86_400_000, '1w': 604_800_000,
    };
    const bases = {
      BTCUSDT: 64_400, ETHUSDT: 3_518, SOLUSDT: 153, BNBUSDT: 598,
      XRPUSDT: .52, DOGEUSDT: .124, ADAUSDT: .45, AVAXUSDT: 34.2,
      LINKUSDT: 14.6, DOTUSDT: 6.32, LTCUSDT: 82.4, TRXUSDT: .112,
    };
    let sequence = 1;
    let currentSymbol = 'BTCUSDT';
    let currentPrice = bases[currentSymbol];
    const createCandles = (symbol, interval, limit) => {
      const step = intervalMap[interval];
      const base = bases[symbol] || 100;
      const end = Math.floor(Date.now() / step) * step;
      return Array.from({ length: limit }, (_, index) => {
        const phase = index / 9 + [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0) / 31;
        const open = base * (1 + Math.sin(phase) * .012 + index / limit * .004);
        const close = open * (1 + Math.cos(phase * .83) * .0018);
        const volume = 40 + index * .75 + Math.abs(Math.sin(phase)) * 130;
        return {
          time: end - (limit - index) * step,
          closeTime: end - (limit - index - 1) * step - 1,
          open,
          high: Math.max(open, close) * 1.0022,
          low: Math.min(open, close) * .9978,
          close,
          volume,
          quoteVolume: volume * close,
          trades: 70 + index,
          closed: index < limit - 1,
          provider: 'fixture',
        };
      });
    };
    window.__ATLAS_MARKET_TEST_PROVIDER__ = {
      intervalMs: interval => intervalMap[interval],
      async candles({ symbol, interval, limit, signal }) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 28);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
        currentSymbol = symbol;
        const candles = createCandles(symbol, interval, limit);
        currentPrice = candles.at(-1).close;
        return candles;
      },
      async snapshot({ symbol, signal }) {
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        currentSymbol = symbol;
        const price = currentPrice || bases[symbol] || 100;
        const at = Date.now();
        return {
          version: 'atlas.market.v1', symbol, provider: 'fixture', serverTime: at - 4, receivedAt: at, sequence: sequence++,
          ticker: { price, open: price * .991, high: price * 1.018, low: price * .982, volume: 8_320, quoteVolume: price * 8_320, change: .91, bid: price * .99999, ask: price * 1.00001 },
          book: {
            bids: Array.from({ length: 20 }, (_, index) => [price * (1 - (index + 1) * .00008), .18 + index * .035]),
            asks: Array.from({ length: 20 }, (_, index) => [price * (1 + (index + 1) * .00008), .16 + index * .032]),
            sequence: sequence++,
          },
          trades: Array.from({ length: 24 }, (_, index) => ({ id: `qa-${sequence}-${index}`, price: price * (1 + (index % 2 ? 1 : -1) * index * .00001), qty: .01 + index * .002, time: at - index * 900, side: index % 2 ? 'buy' : 'sell' })),
        };
      },
      subscribe({ symbol, interval, onEvent }) {
        let stopped = false;
        const timer = setInterval(() => {
          if (stopped) return;
          currentPrice *= sequence % 2 ? 1.000006 : .999997;
          const at = Date.now();
          onEvent({
            type: 'ticker', provider: 'fixture', symbol, interval, sequence: sequence++, serverTime: at - 3, receivedAt: at,
            data: { price: currentPrice, open: currentPrice * .991, high: currentPrice * 1.018, low: currentPrice * .982, volume: 8_320, quoteVolume: currentPrice * 8_320, change: .91, bid: currentPrice * .99999, ask: currentPrice * 1.00001 },
          });
        }, 900);
        return () => {
          stopped = true;
          clearInterval(timer);
        };
      },
    };
  }

  installQaProvider();

  const stylesheets = ['./realtime-market-chart.css', './realtime-market-chart-fixes.css'];
  const scripts = [
    './market-data-engine.js',
    './chart-experience.js',
    './realtime-market-integration.js',
    './interval-persistence-compat.js',
  ];

  if (document.readyState === 'loading') {
    stylesheets.forEach(source => document.write(`<link rel="stylesheet" href="${source}">`));
    scripts.forEach(source => document.write(`<script src="${source}"><\/script>`));
    return;
  }

  stylesheets.forEach(source => {
    if (document.querySelector(`link[href="${source}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = source;
    document.head.append(link);
  });

  let chain = Promise.resolve();
  scripts.forEach(source => {
    chain = chain.then(() => new Promise((resolve, reject) => {
      if ([...document.scripts].some(script => script.getAttribute('src') === source)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${source}`));
      document.head.append(script);
    }));
  });
  chain.catch(error => console.error(error));
})();
