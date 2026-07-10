import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const target = 'http://127.0.0.1:4173/atlas-x-next/';
const viewports = [
  { name: 'iphone-390x844', width: 390, height: 844, mobile: true },
  { name: 'iphone-430x932', width: 430, height: 932, mobile: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { name: 'desktop-1920x1080', width: 1920, height: 1080, mobile: false },
];

await fs.mkdir('qa-artifacts-next/screenshots', { recursive: true });
const executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
const report = { target, executablePath, generatedAt: new Date().toISOString(), results: [] };
let failed = false;

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, isMobile: viewport.mobile, hasTouch: viewport.mobile });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.app-shell', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1400);
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
      canvas: (() => { const canvas = document.querySelector('#chartCanvas'); const rect = canvas?.getBoundingClientRect(); return rect ? { width: rect.width, height: rect.height } : null; })(),
    }));
    const overflow = metrics.bodyWidth > metrics.viewportWidth + 1;
    const blank = metrics.visibleTextLength < 120;
    const badStatus = !response || response.status() >= 400;
    const missing = Object.entries(visibility).filter(([, visible]) => !visible).map(([selector]) => selector);
    const badCanvas = !metrics.canvas || metrics.canvas.width < 280 || metrics.canvas.height < 200;
    const resultFailed = overflow || blank || badStatus || pageErrors.length > 0 || consoleErrors.length > 0 || missing.length > 0 || badCanvas || metrics.forbiddenCopy.length > 0;
    failed ||= resultFailed;

    await page.screenshot({ path: `qa-artifacts-next/screenshots/${viewport.name}-main.png`, fullPage: false });
    const interactions = {};
    await page.locator('[data-timeframe="4H"]').click();
    interactions.timeframe4HActive = await page.locator('[data-timeframe="4H"]').evaluate(element => element.classList.contains('active'));

    if (viewport.mobile) {
      interactions.orderbookHiddenInitially = !(await page.locator('.orderbook-panel').isVisible());
      await page.locator('[data-mobile-view="book"]').click();
      await page.waitForTimeout(180);
      interactions.orderbookViewVisible = await page.locator('.orderbook-panel').isVisible();
      await page.screenshot({ path: `qa-artifacts-next/screenshots/${viewport.name}-book.png`, fullPage: false });
      await page.locator('[data-mobile-view="chart"]').click();
      await page.locator('[data-mobile-side="buy"]').click();
      await page.waitForTimeout(350);
      interactions.tradeSheetOpen = await page.locator('body').evaluate(element => element.classList.contains('trade-sheet-open'));
      await page.screenshot({ path: `qa-artifacts-next/screenshots/${viewport.name}-trade-sheet.png`, fullPage: false });
      await page.locator('#sheetClose').click();
    } else {
      await page.locator('[data-order-type="limit"]').click();
      interactions.limitFieldVisible = await page.locator('.limit-field').isVisible();
      await page.locator('#orderAmount').fill('1000');
      interactions.estimateUpdated = (await page.locator('#estimatedAmount').innerText()) !== '0.000000 BTC';
    }

    const interactionFailed = Object.values(interactions).some(value => value !== true);
    failed ||= interactionFailed;
    report.results.push({ viewport, httpStatus: response?.status() ?? null, overflow, blank, missing, badCanvas, metrics, interactions, consoleErrors, pageErrors, passed: !resultFailed && !interactionFailed });
  } catch (error) {
    failed = true;
    try { await page.screenshot({ path: `qa-artifacts-next/screenshots/${viewport.name}-fatal.png`, fullPage: false }); } catch {}
    report.results.push({ viewport, passed: false, fatalError: String(error), consoleErrors, pageErrors });
  } finally { await page.close(); }
}

await browser.close();
await fs.writeFile('qa-artifacts-next/report.json', JSON.stringify(report, null, 2));
if (failed) { console.error('ATLAS X Next visual QA failed. Inspect screenshots and report.json.'); process.exit(1); }
console.log('ATLAS X Next visual QA completed successfully.');