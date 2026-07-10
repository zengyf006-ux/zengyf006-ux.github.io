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
  cash: 99984.16,
  positions: [],
  orders: [],
  nextId: 20,
  history: [
    { id: 'h4', symbol: 'ETHUSDT', side: 'sell', price: 3400, qty: 1, fee: 2.72, status: '已成交', createdAt: now - 1000 },
    { id: 'h3', symbol: 'ETHUSDT', side: 'buy', price: 3500, qty: 1, fee: 2.8, status: '已成交', createdAt: now - 2000 },
    { id: 'h2', symbol: 'BTCUSDT', side: 'sell', price: 65000, qty: 0.1, fee: 5.2, status: '已成交', createdAt: now - 3000 },
    { id: 'h1', symbol: 'BTCUSDT', side: 'buy', price: 64000, qty: 0.1, fee: 5.12, status: '已成交', createdAt: now - 4000 },
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
  checks.tradeCountCorrect = await overlay.getAttribute('data-trade-count') === '4';
  const realized = Number(await overlay.getAttribute('data-realized-net'));
  checks.realizedNetCorrect = Math.abs(realized - (-15.84)) < 0.001;
  const winRate = Number(await overlay.getAttribute('data-win-rate'));
  checks.winRateCorrect = Math.abs(winRate - 50) < 0.001;
  checks.equityCurveRendered = await page.locator('#performanceChart').evaluate(canvas => canvas.dataset.rendered === 'true' && Number(canvas.dataset.points) >= 5 && canvas.width > 250);
  checks.twoContributionsVisible = await page.locator('.contribution-row').count() === 2;
  checks.fourRecentTradesVisible = await page.locator('.performance-trade-row').count() === 4;
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
