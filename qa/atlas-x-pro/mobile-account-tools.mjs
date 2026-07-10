import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const viewportMap = {
  'iphone-390x844': { name: 'iphone-390x844', width: 390, height: 844 },
  'iphone-430x932': { name: 'iphone-430x932', width: 430, height: 932 },
};
const name = process.env.ATLAS_VIEWPORT || 'iphone-390x844';
const viewport = viewportMap[name];
if (!viewport) throw new Error(`Mobile account test received non-mobile viewport: ${name}`);

const now = Date.now();
const seedState = {
  activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'market',
  accountTab: 'history', mobileView: 'account', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 99994.88, positions: [{ id: 'p1', symbol: 'BTCUSDT', qty: 0.1, entry: 64000 }], orders: [], nextId: 4,
  history: [{ id: 'h1', symbol: 'BTCUSDT', side: 'buy', price: 64000, qty: 0.1, fee: 5.12, status: '已成交', createdAt: now - 1000 }],
};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: viewport.width, height: viewport.height },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
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
  await page.waitForFunction(() => document.documentElement.dataset.mobileAccountTools === 'ready', null, { timeout: 12000 });
  await page.waitForTimeout(450);

  await page.locator('[data-mobile-view="account"]').click();
  checks.toolsVisible = await page.locator('.mobile-account-tools').isVisible();
  checks.threeToolsPresent = await page.locator('[data-mobile-account-tool]').count() === 3;

  await page.locator('[data-mobile-account-tool="analytics"]').click();
  await page.waitForSelector('.module-overlay[data-module="analytics"]', { state: 'visible' });
  await page.waitForSelector('.performance-dashboard', { state: 'visible' });
  checks.analyticsAccessible = await page.locator('.performance-dashboard').isVisible();
  await page.locator('.module-close').click();

  await page.locator('[data-mobile-view="account"]').click();
  await page.locator('[data-mobile-account-tool="assets"]').click();
  await page.waitForSelector('.module-overlay[data-module="assets"]', { state: 'visible' });
  await page.waitForSelector('.portfolio-risk-dashboard', { state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#portfolioAllocationCanvas')?.dataset.rendered === 'true', null, { timeout: 7000 });
  checks.assetsAccessible = await page.locator('.portfolio-risk-dashboard').isVisible();
  checks.assetAllocationRendered = await page.locator('#portfolioAllocationCanvas').evaluate(canvas => canvas.dataset.rendered === 'true');
  await page.locator('.module-close').click();

  await page.locator('[data-mobile-view="account"]').click();
  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-mobile-account-tools.png`,
    fullPage: false,
    timeout: 12000,
  });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-mobile-account-tool="export"]').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const csv = downloadPath ? await fs.readFile(downloadPath, 'utf8') : '';
  checks.csvFilenameCorrect = download.suggestedFilename().startsWith('ATLAS-X-模拟成交-') && download.suggestedFilename().endsWith('.csv');
  checks.csvContainsHeaders = csv.includes('交易对') && csv.includes('手续费(USDT)');
  checks.csvContainsLedger = csv.includes('BTC/USDT') && csv.includes('64000') && csv.includes('5.12000000');
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
} catch (error) {
  fatalError = String(error);
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/mobile-account-tools-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro mobile account tools failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro mobile account tools passed for ${name}`);
