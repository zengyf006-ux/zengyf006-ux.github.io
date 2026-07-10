import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const target = 'http://127.0.0.1:4173/atlas-x-pro/';
const viewports = [
  { name: 'iphone-390x844', width: 390, height: 844, mobile: true },
  { name: 'iphone-430x932', width: 430, height: 932, mobile: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { name: 'desktop-1920x1080', width: 1920, height: 1080, mobile: false },
];

await fs.rm('qa-artifacts-pro', { recursive: true, force: true });
await fs.mkdir('qa-artifacts-pro/screenshots', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});
const report = { target, generatedAt: new Date().toISOString(), results: [] };
let failed = false;
const allTrue = object => Object.values(object).every(Boolean);

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(String(error)));
  const shot = suffix => page.screenshot({
    path: `qa-artifacts-pro/screenshots/${viewport.name}-${suffix}.png`,
    fullPage: false,
  });

  try {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.pro-shell', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(1800);

    const required = viewport.mobile
      ? ['.pro-topbar', '.mobile-market-head', '#chartCanvas', '.mobile-nav', '.mobile-trade-bar']
      : ['.pro-topbar', '.market-sidebar', '#chartCanvas', '.orderbook-panel', '.order-ticket', '.account-workspace'];
    const visibility = {};
    for (const selector of required) visibility[selector] = await page.locator(selector).isVisible();

    const metrics = await page.evaluate(() => {
      const body = document.body;
      const canvas = document.querySelector('#chartCanvas')?.getBoundingClientRect();
      return {
        bodyWidth: body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        bodyText: (body.innerText || '').trim().length,
        canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
        forbidden: ['CLIENT SHOWCASE', '邓总', '项目展示', 'Release Candidate'].filter(term => body.innerText.includes(term)),
        feedMode: document.querySelector('.pro-shell')?.dataset.feedMode || '',
      };
    });

    const structural = {
      httpOk: Boolean(response && response.status() < 400),
      noHorizontalOverflow: metrics.bodyWidth <= metrics.viewportWidth + 1,
      notBlank: metrics.bodyText > 260,
      canvasUsable: Boolean(metrics.canvas && metrics.canvas.width >= 300 && metrics.canvas.height >= 220),
      requiredVisible: Object.values(visibility).every(Boolean),
      noForbiddenCopy: metrics.forbidden.length === 0,
      feedModeDeclared: ['live', 'demo', 'connecting'].includes(metrics.feedMode),
      noConsoleErrors: consoleErrors.length === 0,
      noPageErrors: pageErrors.length === 0,
    };

    const interactions = {};
    await shot('main');

    if (viewport.mobile) {
      await page.locator('#mobilePairButton').click();
      interactions.marketSheetVisible = await page.locator('#marketSheet').isVisible();
      await page.locator('#marketSheet [data-symbol="ETHUSDT"]').click();
      interactions.ethSelected = (await page.locator('#activePair').innerText()).includes('ETH/USDT');

      await page.locator('[data-mobile-view="book"]').click();
      interactions.mobileBookVisible = await page.locator('.orderbook-panel').isVisible();
      await shot('book');
      await page.locator('[data-mobile-view="chart"]').click();

      await page.locator('[data-mobile-side="buy"]').click();
      interactions.orderSheetOpen = await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'));
      await page.locator('[data-order-type="market"]').click();
      await page.locator('#orderTotal').fill('1200');
      interactions.estimateUpdated = !(await page.locator('#orderQuantity').inputValue()).startsWith('0');
      await shot('order-sheet');
      await page.locator('#submitOrder').click();
      await page.waitForTimeout(250);
      await page.locator('[data-mobile-view="account"]').click();
      interactions.positionVisible = (await page.locator('#positionsBody').innerText()).includes('ETH/USDT');
      interactions.balanceChanged = (await page.locator('#availableBalance').innerText()).trim() !== '100,000.00';
      await shot('account');
    } else {
      await page.locator('#marketSearch').fill('ETH');
      interactions.marketSearchFiltered = await page.locator('#marketList [data-symbol="ETHUSDT"]').isVisible();
      await page.locator('#marketList [data-symbol="ETHUSDT"]').click();
      interactions.ethSelected = (await page.locator('#activePair').innerText()).includes('ETH/USDT');

      await page.locator('[data-timeframe="4h"]').click();
      interactions.timeframeChanged = await page.locator('[data-timeframe="4h"]').evaluate(el => el.classList.contains('active'));
      await page.locator('#orderBook .book-row').first().click();
      interactions.bookPriceFilled = Number(await page.locator('#orderPrice').inputValue()) > 0;

      await page.locator('[data-order-type="limit"]').click();
      await page.locator('#orderTotal').fill('1500');
      await page.locator('#submitOrder').click();
      await page.waitForTimeout(180);
      await page.locator('[data-account-tab="orders"]').click();
      interactions.limitOrderCreated = (await page.locator('#ordersBody').innerText()).includes('ETH/USDT');
      await shot('open-order');

      await page.locator('[data-order-type="market"]').click();
      await page.locator('#orderTotal').fill('1000');
      await page.locator('#submitOrder').click();
      await page.waitForTimeout(180);
      await page.locator('[data-account-tab="positions"]').click();
      interactions.positionCreated = (await page.locator('#positionsBody').innerText()).includes('ETH/USDT');
      interactions.accountEquityVisible = Number((await page.locator('#accountEquity').innerText()).replace(/[^0-9.-]/g, '')) > 0;
      await shot('position');
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pro-shell', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(600);
    interactions.marketPersisted = (await page.locator('#activePair').innerText()).includes('ETH/USDT');
    interactions.ordersOrPositionPersisted = (await page.locator('#accountWorkspace').innerText()).includes('ETH/USDT');

    const passed = allTrue(structural) && allTrue(interactions);
    failed ||= !passed;
    report.results.push({ viewport, structural, interactions, metrics, consoleErrors, pageErrors, passed });
  } catch (error) {
    failed = true;
    try { await shot('fatal'); } catch {}
    report.results.push({ viewport, passed: false, fatalError: String(error), consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

await browser.close();
await fs.writeFile('qa-artifacts-pro/report.json', JSON.stringify(report, null, 2));
if (failed) {
  console.error('ATLAS X Pro acceptance failed. Inspect qa-artifacts-pro/report.json.');
  process.exit(1);
}
console.log('ATLAS X Pro acceptance completed successfully.');
