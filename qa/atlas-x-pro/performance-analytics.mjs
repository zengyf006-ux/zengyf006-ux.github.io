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

const now = Date.now();
const seedState = {
  activeSymbol: 'BTCUSDT',
  timeframe: '1h',
  indicator: 'ema',
  side: 'buy',
  orderType: 'market',
  accountTab: 'positions',
  mobileView: 'chart',
  marketFilter: 'all',
  bookMode: 'all',
  favorites: ['BTCUSDT'],
  cash: 97898.5264,
  positions: [
    { id: 'p-btc', symbol: 'BTCUSDT', qty: 0.006, entry: 60000, fees: 0.288, createdAt: now - 900000 },
    { id: 'p-eth', symbol: 'ETHUSDT', qty: 0.3, entry: 3000, fees: 0.72, createdAt: now - 700000 },
    { id: 'p-sol', symbol: 'SOLUSDT', qty: 5, entry: 150, fees: 0.6, createdAt: now - 500000 },
  ],
  orders: [],
  nextId: 30,
  history: [
    { id: 'h6', symbol: 'SOLUSDT', side: 'sell', price: 140, qty: 5, fee: 0.56, status: '已成交', createdAt: now - 100000 },
    { id: 'h5', symbol: 'SOLUSDT', side: 'buy', price: 150, qty: 10, fee: 1.2, status: '已成交', createdAt: now - 600000 },
    { id: 'h4', symbol: 'ETHUSDT', side: 'sell', price: 3200, qty: 0.2, fee: 0.512, status: '已成交', createdAt: now - 200000 },
    { id: 'h3', symbol: 'ETHUSDT', side: 'buy', price: 3000, qty: 0.5, fee: 1.2, status: '已成交', createdAt: now - 800000 },
    { id: 'h2', symbol: 'BTCUSDT', side: 'sell', price: 63000, qty: 0.004, fee: 0.2016, status: '已成交', createdAt: now - 300000 },
    { id: 'h1', symbol: 'BTCUSDT', side: 'buy', price: 60000, qty: 0.01, fee: 0.48, status: '已成交', createdAt: now - 1000000 },
  ],
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
await context.addInitScript(state => {
  localStorage.clear();
  localStorage.setItem('atlasX.pro.v1', JSON.stringify(state));
}, seedState);
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
  await page.waitForFunction(() => document.documentElement.dataset.performanceAnalytics === 'ready', null, { timeout: 12000 });
  await page.waitForTimeout(500);

  await page.evaluate(() => document.querySelector('[data-main-nav="analytics"]')?.click());
  await page.waitForSelector('.module-overlay[data-module="analytics"]', { state: 'visible', timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('.module-overlay[data-module="analytics"]')?.dataset.performanceReady === 'true', null, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('#performanceChart')?.dataset.rendered === 'true', null, { timeout: 8000 });

  const overlay = page.locator('.module-overlay[data-module="analytics"]');
  checks.dynamicDashboardVisible = await page.locator('.performance-dashboard').isVisible();
  checks.tradeCountCorrect = await overlay.getAttribute('data-trade-count') === '6';
  const realized = Number(await overlay.getAttribute('data-realized-net'));
  checks.partialCloseFeesAllocated = Math.abs(realized - (-0.5456)) < 0.001;
  const winRate = Number(await overlay.getAttribute('data-win-rate'));
  checks.winRateCorrect = Math.abs(winRate - (200 / 3)) < 0.01;
  checks.equityCurveRendered = await page.locator('#performanceChart').evaluate(canvas => canvas.dataset.rendered === 'true' && Number(canvas.dataset.points) >= 7 && canvas.width > 250);
  checks.threeContributionsVisible = await page.locator('.contribution-row').count() === 3;
  checks.sixRecentTradesVisible = await page.locator('.performance-trade-row').count() === 6;
  const contributionNet = await page.locator('.contribution-row > strong').evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.textContent.replace(/[^0-9.-]/g, '')), 0));
  checks.contributionSumMatchesRealized = Math.abs(contributionNet - realized) < 0.03;
  checks.staticDemoChartRemoved = !(await overlay.innerText()).includes('演示可视化');
  checks.disclaimerPresent = (await overlay.innerText()).includes('不构成投资建议');
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-performance-analytics.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-performance-analytics-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/performance-analytics-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro performance analytics failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro performance analytics passed for ${name}`);
