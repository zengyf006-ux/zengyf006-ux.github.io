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
const measurements = {};
let fatalError = null;

const boxEvidence = box => box ? {
  x: Number(box.x.toFixed(2)),
  y: Number(box.y.toFixed(2)),
  width: Number(box.width.toFixed(2)),
  height: Number(box.height.toFixed(2)),
  bottom: Number((box.y + box.height).toFixed(2)),
} : null;

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
  checks.bookRowsVisible = await page.locator('#orderBook .book-row:visible').first().isVisible();

  const visibleAsks = page.locator('#asksRows .book-row:visible');
  const visibleBids = page.locator('#bidsRows .book-row:visible');
  const askCount = await visibleAsks.count();
  const bidCount = await visibleBids.count();
  const lastAskBox = askCount ? await visibleAsks.nth(askCount - 1).boundingBox() : null;
  const firstBidBox = bidCount ? await visibleBids.first().boundingBox() : null;
  const asksHostBox = await page.locator('#asksRows').boundingBox();
  const bidsHostBox = await page.locator('#bidsRows').boundingBox();
  const midBox = await page.locator('.mid-price').boundingBox();
  const orderBookBox = await page.locator('#orderBook').boundingBox();
  measurements.orderBook = boxEvidence(orderBookBox);
  measurements.asksHost = boxEvidence(asksHostBox);
  measurements.lastAsk = boxEvidence(lastAskBox);
  measurements.mid = boxEvidence(midBox);
  measurements.firstBid = boxEvidence(firstBidBox);
  measurements.bidsHost = boxEvidence(bidsHostBox);
  measurements.askCount = askCount;
  measurements.bidCount = bidCount;
  measurements.askOverlapPx = lastAskBox && midBox
    ? Number((lastAskBox.y + lastAskBox.height - midBox.y).toFixed(2))
    : null;
  measurements.bidOverlapPx = firstBidBox && midBox
    ? Number((midBox.y + midBox.height - firstBidBox.y).toFixed(2))
    : null;
  measurements.styles = await page.evaluate(() => {
    const describe = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        display: style.display,
        position: style.position,
        overflow: style.overflow,
        flex: style.flex,
        minHeight: style.minHeight,
        height: style.height,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        borderTopWidth: style.borderTopWidth,
        borderBottomWidth: style.borderBottomWidth,
      };
    };
    return {
      orderBook: describe('#orderBook'),
      asksHost: describe('#asksRows'),
      row: describe('#asksRows .book-row'),
      mid: describe('.mid-price'),
      bidsHost: describe('#bidsRows'),
    };
  });

  checks.mobileDepthCountReadable = askCount >= 8 && askCount <= 9 && bidCount >= 8 && bidCount <= 9;
  checks.askDoesNotOverlapMid = Boolean(lastAskBox && midBox && lastAskBox.y + lastAskBox.height <= midBox.y + 1);
  checks.bidDoesNotOverlapMid = Boolean(firstBidBox && midBox && firstBidBox.y >= midBox.y + midBox.height - 1);
  checks.orderBookRowsHaveReadableHeight = Boolean(lastAskBox && firstBidBox && lastAskBox.height >= 17 && firstBidBox.height >= 17);

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-mobile-layout-book.png`,
    fullPage: false,
    timeout: 12000,
  });

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
const report = {
  target,
  viewport,
  checks,
  measurements,
  fatalError,
  passed,
  generatedAt: new Date().toISOString(),
};
await fs.writeFile('qa-artifacts-pro/mobile-layout-report.json', JSON.stringify(report, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro mobile layout guard failed for ${name}`);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(`ATLAS X Pro mobile layout guard passed for ${name}`);
