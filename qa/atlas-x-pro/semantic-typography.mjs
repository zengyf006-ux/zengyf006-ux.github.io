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
  accountTab: 'history', mobileView: 'account', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 99994.88, positions: [], orders: [], nextId: 4,
  history: [{ id: 'h1', symbol: 'BTCUSDT', side: 'buy', price: 64000, qty: 0.1, fee: 5.12, status: '已成交', createdAt: now - 1000 }],
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

const isUiFont = family => {
  const normalized = String(family || '').toLowerCase();
  return !normalized.includes('sfmono')
    && !normalized.includes('consolas')
    && !normalized.includes('menlo')
    && !normalized.includes('monospace');
};
const orderTypeSelector = type => viewport.mobile
  ? `[data-stage2-order-type="${type}"]`
  : `[data-order-type="${type}"]`;

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.atlasQuality === 'ready', null, { timeout: 12000 });
  await page.waitForTimeout(500);

  if (viewport.mobile) await page.locator('[data-mobile-view="account"]').click();
  await page.locator('[data-account-tab="history"]').click();
  const direction = page.locator('#historyBody [data-label="方向"]').first();
  const status = page.locator('#historyBody [data-label="状态"]').first();
  checks.directionCopyCorrect = (await direction.innerText()).trim() === '买入';
  checks.statusCopyCorrect = (await status.innerText()).trim() === '已成交';
  checks.directionUsesUiFont = isUiFont(await direction.evaluate(element => getComputedStyle(element).fontFamily));
  checks.statusUsesUiFont = isUiFont(await status.evaluate(element => getComputedStyle(element).fontFamily));

  if (viewport.mobile) {
    await page.locator('[data-mobile-view="chart"]').click();
    await page.locator('[data-mobile-side="buy"]').click();
  } else {
    await page.locator('[data-side="buy"]').click();
  }
  await page.locator(orderTypeSelector('market')).click();
  await page.locator('#orderTotal').fill('12000');
  await page.locator('#submitOrder').click();
  await page.waitForSelector('#orderConfirmDialog', { state: 'visible' });

  const sideType = page.locator('#confirmSideType');
  const price = page.locator('#confirmPrice');
  checks.confirmSideCopyCorrect = (await sideType.innerText()).includes('买入') && (await sideType.innerText()).includes('市价');
  checks.confirmPriceCopyCorrect = (await price.innerText()).includes('市场价');
  checks.confirmSideUsesUiFont = isUiFont(await sideType.evaluate(element => getComputedStyle(element).fontFamily));
  checks.confirmPriceUsesUiFont = isUiFont(await price.evaluate(element => getComputedStyle(element).fontFamily));
  checks.noReplacementGlyphs = !((await page.locator('#orderConfirmDialog').innerText()).includes('□'));
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-semantic-typography.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/semantic-typography-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro semantic typography failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro semantic typography passed for ${name}`);
