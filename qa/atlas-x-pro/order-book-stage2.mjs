import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const viewportMap = {
  'iphone-390x844': { name: 'iphone-390x844', width: 390, height: 844, mobile: true },
  'iphone-430x932': { name: 'iphone-430x932', width: 430, height: 932, mobile: true },
  'desktop-1440x900': { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  'desktop-1920x1080': { name: 'desktop-1920x1080', width: 1920, height: 1080, mobile: false },
};
const name = process.env.ATLAS_VIEWPORT || 'iphone-390x844';
const viewport = viewportMap[name];
if (!viewport) throw new Error(`Unknown viewport: ${name}`);

const seed = {
  activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'market',
  accountTab: 'positions', mobileView: 'book', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 50000, positions: [], orders: [], history: [], nextId: 100,
};

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
await context.addInitScript(value => {
  localStorage.clear();
  localStorage.setItem('atlasX.pro.v1', JSON.stringify(value));
}, seed);

const page = await context.newPage();
page.setDefaultTimeout(15000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const evidence = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.orderBookStage2 === 'ready'
    && document.documentElement.dataset.mobileTradingStage2 === 'ready');

  checks.moduleReady = await page.evaluate(() => Boolean(window.AtlasOrderBookStage2));
  const aggregation = await page.evaluate(() => {
    const asks = window.AtlasOrderBookStage2.aggregate([[100.01, 1], [100.09, 2], [100.11, 3]], .1, 'ask');
    const bids = window.AtlasOrderBookStage2.aggregate([[99.99, 1], [99.94, 2], [99.81, 3]], .1, 'bid');
    return { asks, bids };
  });
  evidence.aggregation = aggregation;
  const askQty = aggregation.asks.reduce((sum, level) => sum + level.quantity, 0);
  const bidQty = aggregation.bids.reduce((sum, level) => sum + level.quantity, 0);
  checks.quantityConserved = Math.abs(askQty - 6) < 1e-9 && Math.abs(bidQty - 6) < 1e-9;
  checks.askRoundsUp = Math.abs(aggregation.asks[0]?.price - 100.1) < 1e-9
    && Math.abs(aggregation.asks[1]?.price - 100.2) < 1e-9;
  checks.bidRoundsDown = Math.abs(aggregation.bids[0]?.price - 99.9) < 1e-9
    && Math.abs(aggregation.bids[1]?.price - 99.8) < 1e-9;
  checks.cumulativeMonotonic = [aggregation.asks, aggregation.bids]
    .every(levels => levels.every((level, index) => index === 0 || level.cumulative >= levels[index - 1].cumulative));

  const snapshot = await page.evaluate(() => window.AtlasOrderBookStage2.getSnapshot());
  evidence.snapshot = {
    step: snapshot.step,
    options: snapshot.options,
    mode: snapshot.mode,
    asks: snapshot.asks.length,
    bids: snapshot.bids.length,
  };
  checks.dynamicSteps = Array.isArray(snapshot.options) && snapshot.options.length === 4
    && snapshot.options.every(value => Number.isFinite(value) && value > 0);
  checks.liveEngineProjection = snapshot.asks.length > 0 && snapshot.bids.length > 0;

  if (viewport.mobile) {
    await page.locator('[data-mobile-view="book"]').click();
    await page.waitForSelector('.orderbook-panel.mobile-active', { state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('#orderBook .stage2-book-row').length > 4);

    await page.evaluate(() => window.AtlasOrderBookStage2.setMode('bids'));
    await page.waitForFunction(() => document.querySelector('#orderBook')?.dataset.stage2Mode === 'bids');
    checks.bidOnlyWorks = await page.locator('#asksRows').isHidden() && await page.locator('#bidsRows').isVisible();

    await page.evaluate(() => window.AtlasOrderBookStage2.setMode('asks'));
    await page.waitForFunction(() => document.querySelector('#orderBook')?.dataset.stage2Mode === 'asks');
    checks.askOnlyWorks = await page.locator('#bidsRows').isHidden() && await page.locator('#asksRows').isVisible();

    await page.evaluate(() => window.AtlasOrderBookStage2.setMode('all'));
    await page.waitForFunction(() => document.querySelector('#orderBook')?.dataset.stage2Mode === 'all');
    checks.bothSidesWork = await page.locator('#asksRows').isVisible() && await page.locator('#bidsRows').isVisible();

    const nextStep = snapshot.options.find(value => value !== snapshot.step) || snapshot.step;
    await page.evaluate(step => window.AtlasOrderBookStage2.setAggregation(step), nextStep);
    await page.waitForFunction(step => Number(document.querySelector('#orderBook')?.dataset.aggregation) === Number(step), nextStep);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.mobileStage2.v1') || '{}'));
    checks.preferencePersisted = Number(stored.bookAggregation) === Number(nextStep) && stored.bookMode === 'all';
    checks.stableThreeColumns = await page.locator('#orderBook .stage2-book-row').first().evaluate(element => {
      const spans = [...element.querySelectorAll(':scope > span')];
      const style = getComputedStyle(element);
      return spans.length === 3 && style.display === 'grid' && style.gridTemplateColumns.split(' ').length >= 3;
    });
    checks.rowsCarrySelectablePrice = await page.locator('#orderBook .stage2-book-row[data-book-price]').count() > 2;
    checks.mobileTouchTargets = await page.evaluate(() => {
      const targets = [...document.querySelectorAll('.orderbook-panel [data-book-mode], .orderbook-panel #pricePrecision')]
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      return targets.length >= 4 && targets.every(element => element.getBoundingClientRect().height >= 40);
    });
    checks.desktopDomUntouched = true;

    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-order-book-stage2.png`,
      fullPage: false,
      timeout: 12000,
    });
  } else {
    checks.bidOnlyWorks = true;
    checks.askOnlyWorks = true;
    checks.bothSidesWork = true;
    checks.preferencePersisted = true;
    checks.stableThreeColumns = true;
    checks.rowsCarrySelectablePrice = true;
    checks.mobileTouchTargets = true;
    checks.desktopDomUntouched = await page.evaluate(() => {
      const rows = document.querySelectorAll('#orderBook .stage2-book-row');
      const select = document.querySelector('#pricePrecision');
      return rows.length === 0
        && !select?.dataset.stage2Aggregation
        && document.querySelector('#orderBook')?.dataset.stage2Mode === undefined;
    });
  }

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
} catch (error) {
  fatalError = String(error);
  try { await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-order-book-stage2-fatal.png`, fullPage: false }); } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/order-book-stage2-report.json', JSON.stringify({
  target, viewport, checks, evidence, consoleErrors, pageErrors, fatalError, passed, generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});
if (!passed) {
  console.error(`ATLAS X Pro Stage 2 order book failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro Stage 2 order book passed for ${name}`);
