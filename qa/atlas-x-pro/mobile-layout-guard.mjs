import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const viewportMap = {
  'iphone-390x844': { name: 'iphone-390x844', width: 390, height: 844 },
  'iphone-430x932': { name: 'iphone-430x932', width: 430, height: 932 },
};
const name = process.env.ATLAS_VIEWPORT || 'iphone-390x844';
const viewport = viewportMap[name];
if (!viewport) throw new Error(`Mobile layout guard received non-mobile viewport: ${name}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: viewport.width, height: viewport.height },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
let fatalError = null;

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.waitForFunction(() => document.documentElement.dataset.tradingAdvanced === 'ready', null, { timeout: 12000 });
  await page.waitForTimeout(500);

  const terminalBox = await page.locator('.terminal-grid').boundingBox();
  if (!terminalBox) throw new Error('Missing terminal-grid bounds');

  await page.locator('[data-mobile-view="book"]').click();
  await page.waitForTimeout(120);
  const bookBox = await page.locator('.orderbook-panel').boundingBox();
  checks.bookStartsAtWorkspaceTop = Boolean(bookBox && Math.abs(bookBox.y - terminalBox.y) <= 3);
  checks.bookFillsWorkspace = Boolean(bookBox && bookBox.height >= terminalBox.height - 3);
  checks.bookRowsVisible = await page.locator('#orderBook .book-row').first().isVisible();

  await page.locator('[data-book-view="trades"]').click();
  await page.waitForTimeout(100);
  const tradesBox = await page.locator('[data-book-content="trades"]').boundingBox();
  checks.tradesVisibleInFirstScreen = Boolean(tradesBox && tradesBox.y < viewport.height * 0.45 && tradesBox.height > viewport.height * 0.35);
  checks.tradeRowsVisible = await page.locator('#tradeStream .trade-row').first().isVisible();

  await page.locator('[data-book-view="depth"]').click();
  await page.waitForFunction(() => document.querySelector('#depthChartCanvas')?.dataset.rendered === 'true', null, { timeout: 6000 });
  const depthBox = await page.locator('#depthChartCanvas').boundingBox();
  checks.depthVisibleInFirstScreen = Boolean(depthBox && depthBox.y < viewport.height * 0.45 && depthBox.height > viewport.height * 0.35);

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-mobile-layout-guard.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/mobile-layout-report.json', JSON.stringify({
  target,
  viewport,
  checks,
  fatalError,
  passed,
  generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro mobile layout guard failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro mobile layout guard passed for ${name}`);
