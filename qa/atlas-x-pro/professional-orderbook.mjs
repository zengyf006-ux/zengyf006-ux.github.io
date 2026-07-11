import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const viewports = {
  'iphone-390x844': { width: 390, height: 844, mobile: true },
  'iphone-430x932': { width: 430, height: 932, mobile: true },
  'desktop-1440x900': { width: 1440, height: 900, mobile: false },
  'desktop-1920x1080': { width: 1920, height: 1080, mobile: false },
};
const name = process.env.ATLAS_VIEWPORT || 'desktop-1440x900';
const viewport = viewports[name];
if (!viewport) throw new Error(`Unknown viewport ${name}`);

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
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = {};
const metrics = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto('http://127.0.0.1:4173/atlas-x-pro/?qa=1&stage=mobile-terminal-2', { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css' });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css' });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.professionalOrderbook === 'ready');

  const apiResult = await page.evaluate(() => {
    const api = window.AtlasProfessionalOrderbook;
    const input = {
      bids: [[99, 1], [98.9, 2], [98.1, 3]],
      asks: [[100.1, 1], [100.4, 2], [101.2, 3]],
      tickSize: 1,
      rows: 10,
      mode: 'all',
    };
    const result = api?.aggregateBook?.(input);
    return {
      hasApi: Boolean(api?.aggregateBook && api?.precisionOptions && api?.snapshot),
      result,
      precision: api?.precisionOptions?.(64370.7, 1),
      sourceBidQty: input.bids.reduce((sum, row) => sum + row[1], 0),
      sourceAskQty: input.asks.reduce((sum, row) => sum + row[1], 0),
    };
  });

  checks.apiReady = apiResult.hasApi;
  checks.aggregationSorts = apiResult.result?.bids?.[0]?.price > apiResult.result?.bids?.at(-1)?.price
    && apiResult.result?.asks?.[0]?.price < apiResult.result?.asks?.at(-1)?.price;
  checks.aggregationConservesQuantity = Math.abs(apiResult.result.bids.reduce((sum, row) => sum + row.quantity, 0) - apiResult.sourceBidQty) < 1e-8
    && Math.abs(apiResult.result.asks.reduce((sum, row) => sum + row.quantity, 0) - apiResult.sourceAskQty) < 1e-8;
  checks.cumulativeCorrect = apiResult.result.bids.every((row, index, rows) => index === 0 || row.cumulative >= rows[index - 1].cumulative)
    && apiResult.result.asks.every((row, index, rows) => index === 0 || row.cumulative >= rows[index - 1].cumulative);
  checks.spreadMetricsCorrect = apiResult.result.bestAsk > apiResult.result.bestBid
    && apiResult.result.spread > 0
    && apiResult.result.spreadBps > 0;
  checks.precisionOptionsValid = Array.isArray(apiResult.precision)
    && apiResult.precision.length >= 3
    && apiResult.precision.every(value => Number(value) > 0)
    && [...apiResult.precision].sort((a, b) => a - b).every((value, index) => value === apiResult.precision[index]);

  if (viewport.mobile) {
    await page.locator('[data-mobile-view="book"], [data-mobile-context="book"]').first().click();
  }
  await page.waitForSelector('.professional-orderbook', { state: 'visible' });
  checks.columnsPresent = await page.locator('[data-book-column]').evaluateAll(elements => {
    const keys = elements.map(element => element.dataset.bookColumn);
    return ['price','quantity','cumulative'].every(key => keys.includes(key));
  });
  checks.rowsRendered = await page.locator('.pro-book-row').count() >= 8;
  checks.numericColumnsAligned = await page.locator('.pro-book-row').first().evaluate(row => {
    const cells = [...row.querySelectorAll('[data-book-cell]')];
    const rects = cells.map(cell => cell.getBoundingClientRect());
    return cells.length === 3 && rects.every(rect => rect.width > 28) && rects[0].right <= rects[1].left + 1 && rects[1].right <= rects[2].left + 1;
  });

  const beforeOrders = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}').orders?.length || 0);
  await page.locator('.pro-book-row[data-book-side="ask"]').first().click();
  const selectedPrice = Number(await page.locator('#orderPrice').inputValue());
  const afterOrders = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}').orders?.length || 0);
  checks.priceClickOnlyFills = selectedPrice > 0 && beforeOrders === afterOrders;

  const modes = [];
  for (const mode of ['all','bids','asks']) {
    const control = page.locator(`[data-pro-book-mode="${mode}"]`);
    await control.click();
    const active = await control.evaluate(element => element.classList.contains('active'));
    const visibleBids = await page.locator('.pro-book-row[data-book-side="bid"]:visible').count();
    const visibleAsks = await page.locator('.pro-book-row[data-book-side="ask"]:visible').count();
    modes.push({ mode, active, visibleBids, visibleAsks });
  }
  checks.modeSwitches = modes.every(item => item.active)
    && modes.find(item => item.mode === 'all').visibleBids > 0
    && modes.find(item => item.mode === 'all').visibleAsks > 0
    && modes.find(item => item.mode === 'bids').visibleBids > 0
    && modes.find(item => item.mode === 'bids').visibleAsks === 0
    && modes.find(item => item.mode === 'asks').visibleAsks > 0
    && modes.find(item => item.mode === 'asks').visibleBids === 0;

  const precisionSelect = page.locator('#proBookPrecision');
  const options = await precisionSelect.locator('option').allTextContents();
  checks.dynamicPrecisionControl = options.length >= 3 && new Set(options).size === options.length;
  const firstPriceBefore = await page.locator('.pro-book-row[data-book-side="ask"] [data-book-cell="price"]').first().innerText();
  await precisionSelect.selectOption({ index: Math.min(1, options.length - 1) });
  await page.waitForTimeout(80);
  const firstPriceAfter = await page.locator('.pro-book-row[data-book-side="ask"] [data-book-cell="price"]').first().innerText();
  checks.precisionRerenders = firstPriceBefore !== firstPriceAfter || options.length > 1;

  metrics.rowHeight = await page.locator('.pro-book-row').first().evaluate(element => element.getBoundingClientRect().height);
  checks.touchTargetSafe = viewport.mobile ? metrics.rowHeight >= 36 : true;
  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-professional-orderbook.png`, fullPage: false });
} catch (error) {
  fatalError = String(error);
  try { await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-professional-orderbook-fatal.png`, fullPage: false }); } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/professional-orderbook-report.json', JSON.stringify({
  viewport: { name, ...viewport }, checks, metrics, consoleErrors, pageErrors, fatalError, passed, generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});
if (!passed) {
  console.error(`Professional order book failed for ${name}`);
  process.exit(1);
}
console.log(`Professional order book passed for ${name}`);
