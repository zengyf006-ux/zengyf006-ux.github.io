import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const viewportMap = {
  'iphone-390x844': { name: 'iphone-390x844', width: 390, height: 844, mobile: true },
  'iphone-430x932': { name: 'iphone-430x932', width: 430, height: 932, mobile: true },
  'desktop-1440x900': { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  'desktop-1920x1080': { name: 'desktop-1920x1080', width: 1920, height: 1080, mobile: false },
};
const name = process.env.ATLAS_VIEWPORT || 'desktop-1440x900';
const viewport = viewportMap[name];
if (!viewport) throw new Error(`Unknown viewport: ${name}`);

const symbols = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
const tickerRows = symbols.map((symbol, index) => {
  const last = [64000,3500,150,600,.52,.124,.45,34,14.5,6.3,82,.112][index];
  const change = [3.2,-1.5,5.4,1.1,-2.4,4.2,.8,6.8,-.4,2.2,-3.1,1.7][index];
  const open = last / (1 + change / 100);
  const range = [8,6,15,4,12,18,7,20,5,10,9,3][index] / 100;
  return {
    symbol,
    lastPrice: String(last),
    openPrice: String(open),
    highPrice: String(last * (1 + range / 2)),
    lowPrice: String(last * (1 - range / 2)),
    priceChangePercent: String(change),
    quoteVolume: String([5000000000,3200000000,950000000,1200000000,480000000,620000000,300000000,750000000,260000000,210000000,180000000,160000000][index]),
    count: [1200000,900000,480000,410000,350000,550000,270000,320000,210000,180000,160000,150000][index],
  };
});
const bookRows = symbols.map((symbol, index) => {
  const last = Number(tickerRows[index].lastPrice);
  const spreadBps = [0.20,0.35,1.8,0.4,2.4,2.8,2.1,1.1,1.5,1.9,1.2,0.8][index];
  const half = last * spreadBps / 20000;
  return { symbol, bidPrice: String(last - half), askPrice: String(last + half) };
});
const gatewayMarkets = tickerRows.map((ticker, index) => ({
  symbol: ticker.symbol,
  provider: 'fixture',
  price: Number(ticker.lastPrice),
  open: Number(ticker.openPrice),
  high: Number(ticker.highPrice),
  low: Number(ticker.lowPrice),
  volume: 0,
  quoteVolume: Number(ticker.quoteVolume),
  change: Number(ticker.priceChangePercent),
  bid: Number(bookRows[index].bidPrice),
  ask: Number(bookRows[index].askPrice),
  trades: Number(ticker.count),
  serverTime: Date.now(),
}));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: viewport.width, height: viewport.height },
  isMobile: viewport.mobile,
  hasTouch: viewport.mobile,
});
await context.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('atlasX.pro.v1', JSON.stringify({
    activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'market',
    accountTab: 'positions', mobileView: 'chart', marketFilter: 'all', bookMode: 'all',
    favorites: ['BTCUSDT'], cash: 50000, positions: [], orders: [], history: [], nextId: 1,
  }));
});

const page = await context.newPage();
page.setDefaultTimeout(14000);
const gatewayRoute = '**/functions/v1/atlas-market-gateway/markets*';
await page.route(gatewayRoute, route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    version: 'atlas.market.v1',
    provider: 'fixture',
    serverTime: Date.now(),
    receivedAt: Date.now(),
    markets: gatewayMarkets,
  }),
}));

const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

async function openMarkets() {
  if (viewport.mobile) {
    await page.waitForSelector('.mobile-market-center-button', { state: 'visible' });
    await page.locator('.mobile-market-center-button').click();
  } else {
    await page.locator('[data-main-nav="markets"]').click();
  }
  await page.waitForSelector('.module-overlay[data-module="markets"]', { state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.pro-market-screener')?.dataset.ready === 'true');
  await page.waitForFunction(() => document.querySelector('.pro-market-screener')?.dataset.source === 'live');
}

async function visibleRows() {
  return page.locator('.pro-market-row:not([hidden])').count();
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForSelector('.pro-shell', { state: 'visible' });
  await page.waitForFunction(() => document.documentElement.dataset.marketScreener === 'ready');
  await openMarkets();

  checks.screenerReady = await page.locator('.pro-market-screener').isVisible();
  checks.liveSourceDeclared = (await page.locator('.pro-market-screener').getAttribute('data-source')) === 'live';
  checks.allMarketsRendered = await page.locator('.pro-market-row').count() === 12;
  checks.gatewayBacked = await page.evaluate(() => window.AtlasMarketScreener?.gateway?.includes('atlas-market-gateway'));

  const btc = page.locator('.pro-market-row[data-screener-symbol="BTCUSDT"]');
  checks.metricsDerivedCorrectly = (await btc.locator('[data-metric="turnover"]').innerText()).includes('5.00B')
    && Math.abs(Number(await btc.getAttribute('data-range-percent')) - 8) < 0.05
    && Math.abs(Number(await btc.getAttribute('data-spread-bps')) - 0.2) < 0.03;

  await page.locator('#marketScreenerSort').selectOption('turnover');
  await page.locator('#marketScreenerDirection').selectOption('desc');
  await page.waitForTimeout(80);
  checks.turnoverSortCorrect = await page.locator('.pro-market-row:not([hidden])').first().getAttribute('data-screener-symbol') === 'BTCUSDT';

  await page.locator('#marketScreenerSearch').fill('ETH');
  await page.waitForTimeout(80);
  checks.searchFiltersToEth = await visibleRows() === 1
    && await page.locator('.pro-market-row:not([hidden])').first().getAttribute('data-screener-symbol') === 'ETHUSDT';
  await page.locator('#marketScreenerSearch').fill('');

  await page.locator('[data-screener-filter="range"]').click();
  await page.waitForTimeout(80);
  const rangeSymbols = await page.locator('.pro-market-row:not([hidden])').evaluateAll(items => items.map(row => row.dataset.screenerSymbol));
  checks.highRangeFilterCorrect = rangeSymbols.includes('AVAXUSDT') && rangeSymbols.includes('DOGEUSDT') && !rangeSymbols.includes('TRXUSDT');

  await page.locator('[data-screener-filter="spread"]').click();
  await page.waitForTimeout(80);
  const spreadSymbols = await page.locator('.pro-market-row:not([hidden])').evaluateAll(items => items.map(row => row.dataset.screenerSymbol));
  checks.lowSpreadFilterCorrect = spreadSymbols.includes('BTCUSDT') && spreadSymbols.includes('ETHUSDT') && !spreadSymbols.includes('DOGEUSDT');

  await page.locator('[data-screener-filter="all"]').click();
  await page.locator('.pro-market-row[data-screener-symbol="ETHUSDT"] [data-screener-favorite]').click();
  await page.waitForTimeout(80);
  const coreAfterFavorite = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}'));
  checks.favoriteSyncsToCoreStorage = coreAfterFavorite.favorites?.includes('ETHUSDT');
  checks.favoriteVisualUpdates = await page.locator('.pro-market-row[data-screener-symbol="ETHUSDT"] [data-screener-favorite]').evaluate(element => element.classList.contains('active'));

  for (const symbol of ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT']) {
    const checkbox = page.locator(`.pro-market-row[data-screener-symbol="${symbol}"] [data-screener-compare]`);
    if (!await checkbox.evaluate(element => element.classList.contains('active'))) await checkbox.click();
  }
  checks.fourMarketCompareVisible = await page.locator('.pro-market-compare-card').count() === 4;
  await page.locator('.pro-market-row[data-screener-symbol="XRPUSDT"] [data-screener-compare]').click();
  await page.waitForTimeout(80);
  checks.fifthCompareBlocked = await page.locator('.pro-market-compare-card').count() === 4
    && (await page.locator('#marketScreenerStatus').innerText()).includes('最多');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.marketScreener === 'ready');
  await openMarkets();
  checks.comparePersistsAfterReload = await page.locator('.pro-market-compare-card').count() === 4;

  await page.unroute(gatewayRoute);
  await page.route(gatewayRoute, route => route.abort());
  await page.evaluate(() => window.AtlasMarketScreener.refresh({ force: true }));
  await page.waitForFunction(() => document.querySelector('.pro-market-screener')?.dataset.source === 'cache');
  checks.validCacheUsedOnFailure = (await page.locator('.pro-market-screener').getAttribute('data-source')) === 'cache';

  await page.evaluate(() => {
    const cache = JSON.parse(localStorage.getItem('atlasX.pro.marketScreener.cache.v1') || '{}');
    cache.updatedAt = Date.now() - 11 * 60 * 1000;
    localStorage.setItem('atlasX.pro.marketScreener.cache.v1', JSON.stringify(cache));
  });
  await page.evaluate(() => window.AtlasMarketScreener.refresh({ force: true }));
  await page.waitForFunction(() => document.querySelector('.pro-market-screener')?.dataset.source === 'partial');
  checks.expiredCacheDoesNotMasqueradeAsLive = (await page.locator('.pro-market-screener').getAttribute('data-source')) === 'partial'
    && (await page.locator('.pro-market-row[data-screener-symbol="BTCUSDT"] [data-metric="turnover"]').innerText()).trim() === '--';

  await page.locator('.pro-market-row[data-screener-symbol="ETHUSDT"] [data-screener-open]').click();
  await page.waitForFunction(() => document.querySelector('#activePair')?.textContent?.trim() === 'ETH/USDT');
  checks.openTradeSwitchesPair = (await page.locator('#activePair').innerText()).trim() === 'ETH/USDT';
  checks.marketOverlayCloses = await page.locator('.module-overlay[data-module="markets"]').count() === 0;

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.mobileTouchTargets = viewport.mobile
    ? await page.locator('.mobile-market-center-button').evaluate(element => element.getBoundingClientRect().height >= 34)
    : true;
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-professional-market-screener.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-professional-market-screener-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/pro-market-screener-report.json', JSON.stringify({
  target, viewport, checks, consoleErrors, pageErrors, fatalError, passed,
  generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro professional market screener failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro professional market screener passed for ${name}`);
