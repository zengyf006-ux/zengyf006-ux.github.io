import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const target = 'http://127.0.0.1:4173/atlas-x-next/';
const viewports = [
  { name: 'iphone-390x844', width: 390, height: 844, mobile: true },
  { name: 'iphone-430x932', width: 430, height: 932, mobile: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { name: 'desktop-1920x1080', width: 1920, height: 1080, mobile: false },
];

await fs.rm('qa-artifacts-next', { recursive: true, force: true });
await fs.mkdir('qa-artifacts-next/screenshots', { recursive: true });
const executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
const report = { target, executablePath, generatedAt: new Date().toISOString(), results: [] };
let failed = false;

const screenshot = (page, viewport, suffix) => page.screenshot({
  path: `qa-artifacts-next/screenshots/${viewport.name}-${suffix}.png`,
  fullPage: false,
});

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

  try {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.app-shell', { state: 'visible', timeout: 15000 });
    await page.waitForSelector('#pairSelector', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500);

    const required = viewport.mobile
      ? ['.topbar', '.market-summary', '#chartCanvas', '.mobile-view-tabs', '.mobile-action-bar']
      : ['.topbar', '.market-summary', '#chartCanvas', '.orderbook-panel', '.order-panel', '.account-panel'];
    const visibility = {};
    for (const selector of required) visibility[selector] = await page.locator(selector).isVisible();

    const metrics = await page.evaluate(() => ({
      title: document.title,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyHeight: document.body.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
      visibleTextLength: (document.body.innerText || '').trim().length,
      forbiddenCopy: ['邓总', 'CLIENT SHOWCASE', 'Release Candidate', '项目展示'].filter(term => document.body.innerText.includes(term)),
      canvas: (() => {
        const canvas = document.querySelector('#chartCanvas');
        const rect = canvas?.getBoundingClientRect();
        return rect ? { width: rect.width, height: rect.height } : null;
      })(),
    }));
    const overflow = metrics.bodyWidth > metrics.viewportWidth + 1;
    const blank = metrics.visibleTextLength < 120;
    const badStatus = !response || response.status() >= 400;
    const missing = Object.entries(visibility).filter(([, visible]) => !visible).map(([selector]) => selector);
    const badCanvas = !metrics.canvas || metrics.canvas.width < 280 || metrics.canvas.height < 200;
    const startupToastHidden = !(await page.locator('#toast').evaluate(element => element.classList.contains('show')));

    await screenshot(page, viewport, 'main');

    const interactions = { startupToastHidden };

    await page.locator('[data-timeframe="4H"]').click();
    interactions.timeframe4HActive = await page.locator('[data-timeframe="4H"]').evaluate(element => element.classList.contains('active'));

    await page.locator('#pairSelector').click();
    interactions.marketPickerVisible = await page.locator('#marketPicker').isVisible();
    await screenshot(page, viewport, 'market-picker');
    await page.locator('[data-market="ETH"]').click();
    await page.waitForTimeout(250);
    interactions.ethPairSelected = (await page.locator('.pair-selector strong').innerText()).trim() === 'ETH/USDT';
    interactions.ethOrderCopy = (await page.locator('#submitOrder').innerText()).includes('ETH');
    interactions.ethCanvasLabel = (await page.locator('#chartCanvas').getAttribute('aria-label')) === 'ETH K线图';
    const ema10 = Number((await page.locator('#ema10Value').innerText()).replace(/,/g, ''));
    const ema20 = Number((await page.locator('#ema20Value').innerText()).replace(/,/g, ''));
    interactions.ethIndicatorScaleCorrect = ema10 > 3000 && ema10 < 5000 && ema20 > 3000 && ema20 < 5000;

    if (viewport.mobile) {
      interactions.favoriteToggled = true;
    } else {
      const favoriteBefore = await page.locator('#favoriteButton').getAttribute('aria-pressed');
      await page.locator('#favoriteButton').click();
      const favoriteAfter = await page.locator('#favoriteButton').getAttribute('aria-pressed');
      interactions.favoriteToggled = favoriteBefore !== favoriteAfter;
    }

    await page.locator('[data-menu="book"]').click();
    interactions.bookMenuVisible = await page.locator('#floatingMenu').isVisible();
    await page.locator('[data-book-choice="asks"]').click();
    interactions.asksModeApplied = (await page.locator('.orderbook-panel').getAttribute('data-book-mode')) === 'asks';

    if (!viewport.mobile) {
      await page.locator('[data-nav-target="market"]').click();
      await page.waitForTimeout(60);
      interactions.navFeedbackVisible = await page.locator('#toast').evaluate(element => element.classList.contains('show'));
      await page.waitForTimeout(2250);
    } else {
      interactions.navFeedbackVisible = true;
    }

    if (viewport.mobile) {
      await page.locator('[data-mobile-view="book"]').click();
      await page.waitForTimeout(150);
      interactions.orderbookViewVisible = await page.locator('.orderbook-panel').isVisible();
      await screenshot(page, viewport, 'book');
      await page.locator('[data-mobile-view="chart"]').click();
      await page.locator('[data-mobile-side="buy"]').click();
      await page.waitForTimeout(250);
      interactions.tradeSheetOpen = await page.locator('body').evaluate(element => element.classList.contains('trade-sheet-open'));
    } else {
      await page.locator('[data-side="buy"]').click();
    }
    await page.locator('[data-order-type="market"]').click();
    await page.locator('#orderAmount').fill('1000');
    const estimateText = await page.locator('#estimatedAmount').innerText();
    interactions.estimateUpdated = estimateText.includes('ETH') && !estimateText.startsWith('0.000000');
    if (viewport.mobile) await screenshot(page, viewport, 'trade-sheet');
    await page.locator('#submitOrder').click();
    await page.waitForTimeout(220);

    if (viewport.mobile) {
      await page.locator('[data-mobile-view="account"]').click();
      await page.waitForTimeout(150);
    }
    await page.locator('[data-account-view="positions"]').click();
    interactions.positionCreated = (await page.locator('#accountBody').innerText()).includes('ETH/USDT');
    interactions.accountCountUpdated = (await page.locator('[data-account-view="positions"] span').innerText()).trim() === '1';
    if (viewport.mobile) {
      const positionRow = page.locator('#accountBody tr:not(.empty-row)').first();
      interactions.mobilePositionCardVisible = await positionRow.isVisible();
      const box = await positionRow.boundingBox();
      interactions.mobilePositionCardFits = Boolean(box && box.x >= 0 && box.x + box.width <= viewport.width + 1);
    } else {
      interactions.mobilePositionCardVisible = true;
      interactions.mobilePositionCardFits = true;
    }
    await screenshot(page, viewport, 'account-position');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#pairSelector', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
    interactions.marketPersisted = (await page.locator('.pair-selector strong').innerText()).trim() === 'ETH/USDT';
    interactions.timeframePersisted = await page.locator('[data-timeframe="4H"]').evaluate(element => element.classList.contains('active'));
    interactions.positionPersisted = (await page.locator('#accountBody').innerText()).includes('ETH/USDT');

    const resultFailed = overflow || blank || badStatus || pageErrors.length > 0 || consoleErrors.length > 0 || missing.length > 0 || badCanvas || metrics.forbiddenCopy.length > 0;
    const interactionFailed = Object.values(interactions).some(value => value !== true);
    failed ||= resultFailed || interactionFailed;
    report.results.push({
      viewport,
      httpStatus: response?.status() ?? null,
      overflow,
      blank,
      missing,
      badCanvas,
      metrics,
      interactions,
      consoleErrors,
      pageErrors,
      passed: !resultFailed && !interactionFailed,
    });
  } catch (error) {
    failed = true;
    try { await screenshot(page, viewport, 'fatal'); } catch {}
    report.results.push({ viewport, passed: false, fatalError: String(error), consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

await browser.close();
await fs.writeFile('qa-artifacts-next/report.json', JSON.stringify(report, null, 2));
if (failed) {
  console.error('ATLAS X launch-quality QA failed. Inspect screenshots and report.json.');
  process.exit(1);
}
console.log('ATLAS X launch-quality QA completed successfully.');
