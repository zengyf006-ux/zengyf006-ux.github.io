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
await context.addInitScript(() => localStorage.clear());
const page = await context.newPage();
page.setDefaultTimeout(9000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

const sleepForLock = () => page.waitForTimeout(930);
const countOrders = () => page.locator('#ordersBody [data-cancel-order]').count();
const countPositions = () => page.locator('#positionsBody [data-close-position]').count();

async function openTicket(side = 'buy') {
  if (viewport.mobile) {
    const open = page.locator(`body:not(.order-sheet-open) [data-mobile-side="${side}"]`);
    if (await open.count()) await open.click();
  }
  await page.locator(`[data-side="${side}"]`).click();
}

async function setMarketOrder(total) {
  await page.locator('[data-order-type="market"]').click();
  await page.locator('#postOnly').uncheck();
  await page.locator('#reduceOnly').uncheck();
  await page.locator('#orderTotal').fill(String(total));
  await page.waitForTimeout(70);
}

async function screenshot(suffix) {
  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-${suffix}.png`,
    fullPage: false,
    timeout: 12000,
  });
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.executionGuard === 'ready', null, { timeout: 12000 });
  await page.waitForTimeout(600);

  checks.executionGuardReady = await page.evaluate(() => document.documentElement.dataset.executionGuard === 'ready');
  checks.statusVisible = await page.locator('#executionStatus').isVisible();

  await openTicket('buy');
  await setMarketOrder(1);
  await page.locator('#submitOrder').click();
  checks.minimumNotionalBlocked = (await page.locator('#executionStatusCopy').innerText()).includes('最小模拟成交额');
  checks.minimumNotionalCreatedNothing = await countPositions() === 0 && await countOrders() === 0;
  await screenshot('guard-minimum-blocked');

  await page.locator('[data-order-type="limit"]').click();
  await page.locator('#postOnly').check();
  const bestAsk = await page.locator('#asksRows [data-book-price]').evaluateAll(rows => Math.min(...rows.map(row => Number(row.dataset.bookPrice)).filter(Number.isFinite)));
  await page.locator('#orderPrice').fill(String(bestAsk * 1.02));
  await page.locator('#orderTotal').fill('100');
  await page.locator('#submitOrder').click();
  checks.postOnlyCrossBlocked = (await page.locator('#executionStatusCopy').innerText()).includes('不符合 Post Only');
  checks.postOnlyCreatedNothing = await countOrders() === 0;

  await page.locator('#postOnly').uncheck();
  await page.locator('#reduceOnly').check();
  await page.locator('[data-order-type="market"]').click();
  await page.locator('#orderTotal').fill('100');
  await page.locator('#submitOrder').click();
  checks.reduceOnlyBuyBlocked = (await page.locator('#executionStatusCopy').innerText()).includes('只减仓仅允许卖出');
  await page.locator('#reduceOnly').uncheck();

  await setMarketOrder(1000);
  await page.locator('#submitOrder').click();
  await page.waitForTimeout(220);
  checks.normalMarketOrderExecuted = await countPositions() === 1;
  await sleepForLock();

  if (viewport.mobile && !await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))) {
    await page.locator('[data-mobile-side="sell"]').click();
  }
  await openTicket('sell');
  await page.locator('[data-order-type="limit"]').click();
  await page.locator('#postOnly').uncheck();
  await page.locator('#reduceOnly').uncheck();
  const held = Number((await page.locator('#positionsBody [data-label="数量"]').innerText()).replace(/,/g, ''));
  const current = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
  const firstSellQty = held * 0.55;
  await page.locator('#orderPrice').fill(String(current * 1.03));
  await page.locator('#orderQuantity').fill(String(firstSellQty));
  await page.locator('#orderQuantity').dispatchEvent('input');
  await page.locator('#submitOrder').click();
  await page.waitForTimeout(180);
  checks.firstSellOrderCreated = await countOrders() === 1;
  await sleepForLock();

  if (viewport.mobile && !await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))) {
    await page.locator('[data-mobile-side="sell"]').click();
  }
  await openTicket('sell');
  await page.locator('[data-order-type="limit"]').click();
  await page.locator('#orderPrice').fill(String(current * 1.04));
  await page.locator('#orderQuantity').fill(String(held));
  await page.locator('#orderQuantity').dispatchEvent('input');
  await page.locator('#submitOrder').click();
  checks.reservedSellQuantityBlocked = (await page.locator('#executionStatusCopy').innerText()).includes('已被卖单冻结');
  checks.secondSellOrderNotCreated = await countOrders() === 1;
  await screenshot('guard-sell-freeze');

  await sleepForLock();
  if (viewport.mobile) {
    await page.locator('#orderSheetClose').click();
    await page.locator('[data-mobile-side="buy"]').click();
  }
  await openTicket('buy');
  await setMarketOrder(12000);
  await page.locator('#submitOrder').click();
  checks.largeOrderRequiresConfirmation = await page.locator('#orderConfirmDialog').isVisible();
  checks.confirmationContainsPair = (await page.locator('#confirmPair').innerText()).includes('BTC/USDT');
  checks.confirmationShowsExposure = (await page.locator('#confirmExposure').innerText()).includes('%');
  await screenshot('guard-large-confirmation');
  await page.locator('#confirmOrderSubmit').click();
  await page.waitForTimeout(260);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}'));
  checks.confirmedOrderReachedEngine = Array.isArray(stored.history) && stored.history.length >= 2;
  checks.confirmationClosed = await page.locator('#orderConfirmDialog').isHidden();

  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
} catch (error) {
  fatalError = String(error);
  try { await screenshot('execution-guard-fatal'); } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/execution-guard-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro execution guard failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro execution guard passed for ${name}`);
