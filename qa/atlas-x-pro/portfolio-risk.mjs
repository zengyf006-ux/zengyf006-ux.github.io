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
  activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'market',
  accountTab: 'positions', mobileView: 'chart', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 60000,
  positions: [
    { id: 'risk-btc', symbol: 'BTCUSDT', qty: 0.5, entry: 60000, fees: 24, createdAt: now - 300000 },
    { id: 'risk-eth', symbol: 'ETHUSDT', qty: 5, entry: 3000, fees: 12, createdAt: now - 200000 },
    { id: 'risk-sol', symbol: 'SOLUSDT', qty: 100, entry: 150, fees: 12, createdAt: now - 100000 },
  ],
  orders: [
    { id: 'risk-order', symbol: 'BTCUSDT', side: 'buy', type: 'limit', price: 50000, qty: 0.1, total: 5000, filled: 0, estimatedFee: 4, createdAt: now - 50000, postOnly: true, reduceOnly: false },
  ],
  history: [],
  nextId: 50,
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
  await page.waitForSelector('.pro-shell', { state: 'visible', timeout: 12000 });
  await page.waitForTimeout(650);

  await page.evaluate(() => document.querySelector('[data-main-nav="assets"]')?.click());
  await page.waitForSelector('.module-overlay[data-module="assets"]', { state: 'visible', timeout: 7000 });
  await page.waitForSelector('.portfolio-risk-dashboard', { state: 'visible', timeout: 7000 });
  await page.waitForFunction(() => document.querySelector('#portfolioAllocationCanvas')?.dataset.rendered === 'true', null, { timeout: 7000 });

  const overlay = page.locator('.module-overlay[data-module="assets"]');
  checks.dashboardVisible = await page.locator('.portfolio-risk-dashboard').isVisible();
  checks.sixSummaryCards = await page.locator('.portfolio-risk-summary .portfolio-risk-stat').count() === 6;
  checks.threePositionRows = await page.locator('.portfolio-position-row').count() === 3;
  checks.allocationCanvasRendered = await page.locator('#portfolioAllocationCanvas').evaluate(canvas => canvas.dataset.rendered === 'true' && canvas.width > 180 && canvas.height > 180);
  const totalWeight = Number(await overlay.getAttribute('data-total-weight'));
  checks.weightsSumToHundred = totalWeight > 99.8 && totalWeight < 100.2;
  const largestWeight = Number(await overlay.getAttribute('data-largest-weight'));
  checks.largestWeightValid = largestWeight > 15 && largestWeight < 60;
  const reserved = Number(await overlay.getAttribute('data-reserved-cash'));
  checks.reservedCashCalculated = Math.abs(reserved - 5004) < 0.1;
  const stress5 = Number(await overlay.getAttribute('data-stress-minus-5'));
  const stress10 = Number(await overlay.getAttribute('data-stress-minus-10'));
  const stressUp = Number(await overlay.getAttribute('data-stress-plus-5'));
  checks.stressScenariosCalculated = stress5 < 0 && stress10 < stress5 && stressUp > 0 && Math.abs(stress10 - stress5 * 2) < 0.2;
  checks.riskLevelNotPlaceholder = !['', '--'].includes((await page.locator('#portfolioRiskLevel').innerText()).trim());
  checks.noStaticSafetyCopy = !(await overlay.innerText()).includes('真实充值 / 提现');
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-portfolio-risk.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-portfolio-risk-fatal.png`, fullPage: false, timeout: 12000 });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/portfolio-risk-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro portfolio risk failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro portfolio risk passed for ${name}`);
