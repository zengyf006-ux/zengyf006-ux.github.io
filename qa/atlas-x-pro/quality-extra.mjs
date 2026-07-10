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

const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
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
page.setDefaultTimeout(8000);
const consoleErrors = [];
const pageErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

let passed = false;
let checks = {};
let fatalError = null;

async function testChartDrawing() {
  checks.chartToolsReady = await page.evaluate(() => document.documentElement.dataset.chartProTools === 'ready');
  checks.chartToolbarVisible = await page.locator('.chart-drawing-tools').isVisible();
  await page.locator('[data-chart-tool="hline"]').click();
  const box = await page.locator('#chartCanvas').boundingBox();
  if (!box) throw new Error('Chart canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.43);
  await page.waitForTimeout(120);
  checks.horizontalLineCreated = await page.locator('.chart-price-line.user-line').count() === 1;
  await page.locator('[data-chart-tool="clear"]').click();
  checks.horizontalLineCleared = await page.locator('.chart-price-line.user-line').count() === 0;
}

async function submitMarketOrder(total = '500') {
  await page.locator('[data-order-type="market"]').click();
  await page.locator('#orderTotal').fill(total);
  await page.locator('#submitOrder').click();
  await page.waitForTimeout(180);
  checks.positionMarkerVisible = await page.locator('.chart-price-line.position-line').count() >= 1;
}

async function submitLimitOrder() {
  const current = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
  await page.locator('[data-order-type="limit"]').click();
  await page.locator('#orderPrice').fill(String(current * 0.998));
  await page.locator('#orderTotal').fill('350');
  await page.locator('#submitOrder').click();
  await page.waitForTimeout(160);
  checks.orderMarkerVisible = await page.locator('.chart-price-line.order-line').count() >= 1;
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.terminalQuality === 'ready' && document.documentElement.dataset.chartProTools === 'ready',
    null,
    { timeout: 12000 },
  );
  await page.waitForTimeout(700);

  checks.qualityLayerReady = await page.evaluate(() => document.documentElement.dataset.terminalQuality === 'ready');
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await testChartDrawing();

  if (viewport.mobile) {
    checks.quickStatsVisible = await page.locator('.mobile-quick-stats').isVisible();
    const statTexts = await page.locator('.mobile-quick-stats b').allInnerTexts();
    checks.quickStatsPopulated = statTexts.length === 4 && statTexts.every(text => text.trim() && text.trim() !== '--');

    await page.locator('[data-mobile-side="buy"]').click();
    const sheet = await page.locator('#orderTicket').boundingBox();
    checks.orderSheetFits = Boolean(sheet && sheet.y >= 0 && sheet.height <= viewport.height * 0.82);
    await submitMarketOrder('500');

    await page.locator('[data-mobile-view="account"]').click();
    checks.accountMetricsVisible = await page.locator('.account-metrics').isVisible();
    const columns = await page.locator('.account-metrics').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
    checks.accountMetricsThreeColumns = columns === 3;
    checks.mobilePositionCardReadable = await page.locator('#positionsBody .table-row').evaluate(row => {
      const style = getComputedStyle(row);
      const label = row.querySelector('[data-label="交易对"]');
      const action = row.querySelector('[data-close-position]');
      return style.display === 'grid' && Boolean(label) && Boolean(action) && action.getBoundingClientRect().height >= 28;
    });
  } else {
    const handles = page.locator('.workspace-resizer');
    checks.threeResizersVisible = await handles.count() === 3 && await handles.first().isVisible();
    const handle = page.locator('.workspace-resizer[data-resize="market"]');
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--atlas-market-col').trim());
    await handle.focus();
    await handle.press('ArrowRight');
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--atlas-market-col').trim());
    checks.keyboardResizeWorks = before !== after;
    await handle.press('Home');
    checks.resizeSemantics = await handle.evaluate(element => element.getAttribute('role') === 'separator' && element.getAttribute('aria-orientation') === 'vertical');

    await submitLimitOrder();
    await submitMarketOrder('500');
  }

  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
  passed = Object.values(checks).every(Boolean);
  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${viewport.name}-quality.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${viewport.name}-quality-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

await fs.writeFile('qa-artifacts-pro/quality-report.json', JSON.stringify({
  target,
  viewport,
  generatedAt: new Date().toISOString(),
  checks,
  consoleErrors,
  pageErrors,
  fatalError,
  passed,
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro quality checks failed for ${viewport.name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro quality checks passed for ${viewport.name}`);
