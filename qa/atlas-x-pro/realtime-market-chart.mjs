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

const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1&stage=realtime-chart';
const fontCss400 = 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css';
const fontCss700 = 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css';
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
  const INTERVAL_MS = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
    '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
    '1d': 86_400_000, '1w': 604_800_000,
  };
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const abortableDelay = (milliseconds, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
  const createCandles = (symbol, interval, limit) => {
    const step = INTERVAL_MS[interval];
    const end = Math.floor(Date.now() / step) * step;
    const symbolSeed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return Array.from({ length: limit }, (_, index) => {
      const wave = Math.sin((index + symbolSeed) / 7) * 80;
      const open = 60_000 + symbolSeed + index * 4 + wave;
      const close = open + Math.cos(index / 5) * 22;
      return {
        time: end - (limit - index) * step,
        closeTime: end - (limit - index - 1) * step - 1,
        open,
        high: Math.max(open, close) + 31 + (index % 4),
        low: Math.min(open, close) - 27 - (index % 3),
        close,
        volume: 100 + index * 1.25,
        quoteVolume: (100 + index * 1.25) * close,
        trades: 50 + index,
        closed: index < limit - 1,
        provider: 'fixture',
      };
    });
  };

  let sequence = 1;
  let livePrice = 64_370.7;
  window.__ATLAS_MARKET_TEST_PROVIDER__ = {
    intervalMs: interval => INTERVAL_MS[interval],
    async candles({ symbol, interval, limit, signal }) {
      const requestDelay = interval === '1m' ? 460 : interval === '30m' ? 300 : interval === '1d' ? 45 : 90;
      await abortableDelay(requestDelay, signal);
      return createCandles(symbol, interval, limit);
    },
    async snapshot({ symbol, signal }) {
      await abortableDelay(35, signal);
      const now = Date.now();
      return {
        version: 'atlas.market.v1',
        symbol,
        provider: 'fixture',
        serverTime: now - 8,
        receivedAt: now,
        sequence: sequence++,
        ticker: {
          price: livePrice,
          open: 62_830,
          high: 64_482.3,
          low: 63_772.6,
          volume: 566.51,
          quoteVolume: 36_430_300,
          change: 2.44,
        },
        book: {
          bids: [[64_370.7, 9.41], [64_370.6, 1.22], [64_370.5, 0.40]],
          asks: [[64_370.8, 0.27], [64_370.9, 0.01], [64_371.5, 0.01]],
          sequence: sequence++,
        },
        trades: [{ id: `fixture-${sequence}`, price: livePrice, qty: 0.01, time: now, side: 'buy' }],
      };
    },
    subscribe({ symbol, interval, onEvent }) {
      let stopped = false;
      const emit = async () => {
        while (!stopped) {
          await delay(240);
          if (stopped) break;
          livePrice += 0.1;
          const now = Date.now();
          onEvent({
            type: 'ticker', provider: 'fixture', symbol, interval,
            sequence: sequence++, serverTime: now - 6, receivedAt: now,
            data: {
              price: livePrice,
              open: 62_830,
              high: Math.max(64_482.3, livePrice),
              low: 63_772.6,
              volume: 566.51,
              quoteVolume: 36_430_300,
              change: 2.44,
            },
          });
        }
      };
      emit();
      return () => { stopped = true; };
    },
  };
});

const page = await context.newPage();
page.setDefaultTimeout(10_000);
const consoleErrors = [];
const pageErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

let passed = false;
let fatalError = null;
const checks = {};
const measurements = {};

async function injectQaFont() {
  await page.addStyleTag({ url: fontCss400, timeout: 6000 });
  await page.addStyleTag({ url: fontCss700, timeout: 6000 });
  await page.addStyleTag({ content: 'html, body, button, input, select { font-family: "Noto Sans SC", sans-serif !important; }' });
  await page.evaluate(() => document.fonts?.ready);
}

async function shot(suffix) {
  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${viewport.name}-realtime-${suffix}.png`,
    fullPage: false,
    timeout: 12_000,
  });
}

async function activeInterval() {
  return page.evaluate(() => window.AtlasMarketDataEngine?.getState?.().interval || '');
}

try {
  const navigationStartedAt = Date.now();
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18_000 });
  await injectQaFont();
  await page.waitForFunction(() => document.documentElement.dataset.marketDataEngine === 'ready', null, { timeout: 12_000 });
  await page.waitForFunction(() => window.AtlasMarketDataEngine?.getState?.().connectionState === 'live', null, { timeout: 8_000 });
  measurements.initialLiveMs = Date.now() - navigationStartedAt;

  checks.engineReady = await page.evaluate(() => document.documentElement.dataset.marketDataEngine === 'ready');
  checks.chartExperienceReady = await page.evaluate(() => document.documentElement.dataset.chartExperience === 'ready');

  const intervalValues = await page.locator('[data-timeframe]').evaluateAll(elements => elements.map(element => element.dataset.timeframe));
  checks.intervalSetComplete = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']
    .every(interval => intervalValues.includes(interval));

  const switchStartedAt = Date.now();
  await page.locator('[data-timeframe="1m"]').click();
  await page.locator('[data-timeframe="30m"]').click();
  await page.locator('[data-timeframe="1d"]').click();
  await page.waitForFunction(() => {
    const state = window.AtlasMarketDataEngine?.getState?.();
    const candles = state?.candles || [];
    return state?.interval === '1d'
      && state?.loading === false
      && state?.source === 'fixture'
      && candles.length >= 100
      && candles[1]?.time - candles[0]?.time === 86_400_000;
  });
  measurements.intervalSwitchCommitMs = Date.now() - switchStartedAt;
  checks.lastIntervalWins = await activeInterval() === '1d';
  checks.intervalSpanMatches = await page.evaluate(() => {
    const state = window.AtlasMarketDataEngine?.getState?.();
    const candles = state?.candles || [];
    return candles.length > 10
      && candles[1].time - candles[0].time === 86_400_000
      && document.documentElement.dataset.activeMarketInterval === '1d';
  });
  await page.waitForTimeout(650);
  checks.oldRequestDidNotOverwrite = await activeInterval() === '1d';

  const marketState = await page.evaluate(() => window.AtlasMarketDataEngine?.getState?.());
  measurements.finalInterval = marketState?.interval;
  measurements.finalSpacingMs = Number(marketState?.candles?.[1]?.time) - Number(marketState?.candles?.[0]?.time);
  measurements.finalGeneration = marketState?.requestGeneration;
  checks.sessionUnified = Boolean(marketState?.sessionId
    && marketState.provider === 'fixture'
    && marketState.ticker?.price > 0
    && marketState.book?.bids?.length
    && marketState.trades?.length
    && marketState.candles?.length);
  checks.timestampsPresent = Number(marketState?.lastServerTime) > 0
    && Number(marketState?.lastReceivedAt) > 0
    && Number(marketState?.lastReceivedAt) >= Number(marketState?.lastServerTime);

  const connection = page.locator('#marketConnectionState');
  checks.liveStateVisible = await connection.isVisible();
  checks.liveStateCorrect = await connection.getAttribute('data-state') === 'live';
  checks.dataAgeVisible = await page.locator('#marketDataAge').isVisible();
  checks.blockingLoaderGone = await page.locator('#chartLoading').evaluate(element => {
    const style = getComputedStyle(element);
    const stage = document.querySelector('#chartStage')?.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return style.display === 'none' || style.visibility === 'hidden' || !stage || box.height < stage.height * 0.35;
  });

  const canvas = page.locator('#chartCanvas');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Chart canvas has no bounding box');
  const clickX = Math.max(70, Math.min(canvasBox.width - 90, canvasBox.width * 0.58));
  const clickY = Math.max(70, Math.min(canvasBox.height - 80, canvasBox.height * 0.46));
  await canvas.click({ position: { x: clickX, y: clickY } });
  const detail = page.locator('#chartCandleDetail');
  await detail.waitFor({ state: 'visible' });
  checks.richCardVisible = await detail.isVisible();
  checks.richCardComplete = await detail.evaluate(card => [
    '开盘','最高','最低','收盘','涨跌额','涨跌幅','振幅','成交量','成交额','EMA10','EMA20','数据源',
  ].every(text => card.textContent.includes(text)));
  checks.detailHasClose = await detail.locator('[data-clear-candle-selection]').isVisible();
  await shot('candle-detail');

  await canvas.click({ position: { x: clickX, y: clickY } });
  await detail.waitFor({ state: 'hidden' });
  checks.sameCandleCancels = await detail.isHidden();

  await canvas.click({ position: { x: clickX + 18, y: clickY } });
  await detail.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await detail.waitFor({ state: 'hidden' });
  checks.escapeCancels = await detail.isHidden();

  await canvas.click({ position: { x: clickX + 28, y: clickY } });
  await detail.waitFor({ state: 'visible' });
  await page.locator('[data-clear-candle-selection]').click();
  await detail.waitFor({ state: 'hidden' });
  checks.closeButtonCancels = await detail.isHidden();

  checks.extremaVisible = await page.locator('.chart-extrema-label').count() === 2;
  checks.extremaKinds = await page.locator('.chart-extrema-label').evaluateAll(elements => {
    const kinds = elements.map(element => element.dataset.kind).sort();
    return kinds.join(',') === 'high,low' && elements.every(element => element.textContent.trim().length > 0);
  });
  checks.countdownVisible = await page.locator('#chartCountdown').isVisible();
  checks.countdownFormatted = /^\d{2}:\d{2}(?::\d{2})?$/.test((await page.locator('#chartCountdown').innerText()).trim());

  await page.locator('[data-timeframe="30m"]').click();
  await page.waitForFunction(() => window.AtlasMarketDataEngine?.getState?.().interval === '30m');
  checks.intervalSwitchClearsSelection = await detail.isHidden();

  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
  passed = Object.values(checks).every(Boolean);
  await shot('final');
} catch (error) {
  fatalError = String(error);
  try { await shot('fatal'); } catch {}
}

await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/realtime-market-chart-report.json', JSON.stringify({
  target,
  viewport,
  generatedAt: new Date().toISOString(),
  checks,
  measurements,
  consoleErrors,
  pageErrors,
  fatalError,
  passed,
}, null, 2));

await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro realtime market/chart checks failed for ${viewport.name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro realtime market/chart checks passed for ${viewport.name}`);
