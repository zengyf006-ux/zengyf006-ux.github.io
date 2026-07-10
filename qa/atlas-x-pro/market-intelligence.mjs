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
page.setDefaultTimeout(9000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.querySelectorAll('#marketList .market-row').length >= 10, null, { timeout: 12000 });
  await page.waitForTimeout(650);

  const source = await page.evaluate(() => [...document.querySelectorAll('#marketList .market-row')].map(row => ({
    symbol: row.dataset.symbol || '',
    pair: row.querySelector('.pair-cell b')?.textContent?.replace(/\s+/g, '') || '',
    name: row.querySelector('.pair-cell small')?.textContent?.trim() || '',
    price: Number((row.querySelector('.price-cell')?.textContent || '').replace(/,/g, '')),
    change: Number((row.querySelector('.change-cell')?.textContent || '').replace('%', '')),
  })).filter(item => item.symbol && Number.isFinite(item.price) && Number.isFinite(item.change)));
  if (source.length < 10) throw new Error(`Expected at least 10 source markets, found ${source.length}`);

  const changes = source.map(item => item.change).sort((a, b) => a - b);
  const advancers = source.filter(item => item.change > 0).length;
  const decliners = source.filter(item => item.change < 0).length;
  const median = changes.length % 2
    ? changes[Math.floor(changes.length / 2)]
    : (changes[changes.length / 2 - 1] + changes[changes.length / 2]) / 2;
  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const dispersion = Math.sqrt(changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / changes.length);
  const topGainer = [...source].sort((a, b) => b.change - a.change)[0];
  const topLoser = [...source].sort((a, b) => a.change - b.change)[0];

  if (viewport.mobile) {
    await page.waitForSelector('.mobile-market-center-button', { state: 'visible', timeout: 7000 });
    checks.mobileEntryVisible = await page.locator('.mobile-market-center-button').isVisible();
    await page.locator('.mobile-market-center-button').click();
  } else {
    checks.mobileEntryVisible = true;
    await page.evaluate(() => document.querySelector('[data-main-nav="markets"]')?.click());
  }

  await page.waitForSelector('.module-overlay[data-module="markets"]', { state: 'visible', timeout: 7000 });
  await page.waitForSelector('.market-intelligence-dashboard', { state: 'visible', timeout: 7000 });

  const overlay = page.locator('.module-overlay[data-module="markets"]');
  checks.dashboardVisible = await page.locator('.market-intelligence-dashboard').isVisible();
  checks.sixSummaryCards = await page.locator('.market-intelligence-summary .market-intelligence-stat').count() === 6;
  checks.heatmapMatchesSource = await page.locator('.market-heat-tile').count() === source.length;
  checks.rankingMatchesSource = await page.locator('.market-intelligence-row').count() === source.length;
  const metrics = await overlay.evaluate(element => ({
    sourceCount: Number(element.dataset.marketCount),
    advancers: Number(element.dataset.advancers),
    decliners: Number(element.dataset.decliners),
    median: Number(element.dataset.medianChange),
    dispersion: Number(element.dataset.dispersion),
    breadth: Number(element.dataset.breadth),
    topGainer: element.dataset.topGainer || '',
    topLoser: element.dataset.topLoser || '',
  }));
  checks.metricsMatchSource = metrics.sourceCount === source.length
    && metrics.advancers === advancers
    && metrics.decliners === decliners
    && Math.abs(metrics.median - median) < 0.001
    && Math.abs(metrics.dispersion - dispersion) < 0.001
    && Math.abs(metrics.breadth - advancers / source.length * 100) < 0.01;
  checks.moversMatchSource = metrics.topGainer === topGainer.symbol && metrics.topLoser === topLoser.symbol;
  const firstRanked = await page.locator('.market-intelligence-row').first().getAttribute('data-symbol');
  checks.defaultRankingByChange = firstRanked === topGainer.symbol;
  if (viewport.mobile) {
    checks.rankingRowsFillPanel = true;
  } else {
    const [listBox, rowBox] = await Promise.all([
      page.locator('.market-intelligence-list').boundingBox(),
      page.locator('.market-intelligence-row').first().boundingBox(),
    ]);
    checks.rankingRowsFillPanel = Boolean(listBox && rowBox && rowBox.width >= listBox.width - 2);
  }

  await page.locator('[data-market-intelligence-filter="decliners"]').click();
  await page.waitForTimeout(100);
  const visibleDecliners = await page.locator('.market-heat-tile:not([hidden])').count();
  const visibleRows = await page.locator('.market-intelligence-row:not([hidden])').count();
  checks.declinerFilterWorks = visibleDecliners === decliners && visibleRows === decliners;
  await page.locator('[data-market-intelligence-filter="all"]').click();

  checks.distributionHasFourBuckets = await page.locator('.market-distribution-bar').count() === 4;
  const copy = await overlay.innerText();
  checks.noStaticSectorCopy = !copy.includes('模拟分类视图') && !copy.includes('固定分类');
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-market-intelligence.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-market-intelligence-fatal.png`, fullPage: false, timeout: 12000 });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/market-intelligence-report.json', JSON.stringify({
  target,
  viewport,
  checks,
  consoleErrors,
  pageErrors,
  fatalError,
  passed,
  generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro market intelligence failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro market intelligence passed for ${name}`);
