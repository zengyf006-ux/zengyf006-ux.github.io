import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const fontCss400 = 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css';
const fontCss700 = 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css';
const viewportMap = {
  'iphone-390x844': { name: 'iphone-390x844', width: 390, height: 844, mobile: true },
  'iphone-430x932': { name: 'iphone-430x932', width: 430, height: 932, mobile: true },
  'desktop-1440x900': { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  'desktop-1920x1080': { name: 'desktop-1920x1080', width: 1920, height: 1080, mobile: false },
};
const selectedName = process.env.ATLAS_VIEWPORT || 'desktop-1440x900';
const viewport = viewportMap[selectedName];
if (!viewport) throw new Error(`Unknown ATLAS_VIEWPORT: ${selectedName}`);

await fs.rm('qa-artifacts-pro', { recursive: true, force: true });
await fs.mkdir('qa-artifacts-pro/screenshots', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const report = { target, generatedAt: new Date().toISOString(), viewport, results: [] };
let failed = false;
const allTrue = object => Object.values(object).every(Boolean);
const checkpoint = label => console.log(`[ATLAS-QA][${viewport.name}] ${label}`);

async function injectQaFont(page) {
  checkpoint('inject-font:start');
  await page.addStyleTag({ url: fontCss400, timeout: 6000 });
  await page.addStyleTag({ url: fontCss700, timeout: 6000 });
  await page.addStyleTag({ content: `
    html, body, button, input, select {
      font-family: "Noto Sans SC", sans-serif !important;
    }
  ` });
  await page.waitForTimeout(250);
  checkpoint('inject-font:done');
}

const context = await browser.newContext({
  viewport: { width: viewport.width, height: viewport.height },
  deviceScaleFactor: 1,
  isMobile: viewport.mobile,
  hasTouch: viewport.mobile,
});
const page = await context.newPage();
page.setDefaultTimeout(7000);
page.setDefaultNavigationTimeout(18000);
const consoleErrors = [];
const pageErrors = [];
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', error => pageErrors.push(String(error)));
const shot = async suffix => {
  checkpoint(`screenshot:${suffix}:start`);
  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${viewport.name}-${suffix}.png`,
    fullPage: false,
    timeout: 12000,
  });
  checkpoint(`screenshot:${suffix}:done`);
};

try {
  checkpoint('navigate:start');
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  checkpoint('navigate:done');
  await injectQaFont(page);
  await page.waitForSelector('.pro-shell', { state: 'visible', timeout: 12000 });
  await page.waitForTimeout(900);

  const required = viewport.mobile
    ? ['.pro-topbar', '.mobile-market-head', '#chartCanvas', '.mobile-nav', '.mobile-trade-bar']
    : ['.pro-topbar', '.market-sidebar', '#chartCanvas', '.orderbook-panel', '.order-ticket', '.account-workspace'];
  const visibility = {};
  for (const selector of required) visibility[selector] = await page.locator(selector).isVisible();

  const metrics = await page.evaluate(() => {
    const body = document.body;
    const canvas = document.querySelector('#chartCanvas')?.getBoundingClientRect();
    return {
      bodyWidth: body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyText: (body.innerText || '').trim().length,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      forbidden: ['CLIENT SHOWCASE', '邓总', '项目展示', 'Release Candidate'].filter(term => body.innerText.includes(term)),
      feedMode: document.querySelector('.pro-shell')?.dataset.feedMode || '',
    };
  });

  const structural = {
    httpOk: Boolean(response && response.status() < 400),
    noHorizontalOverflow: metrics.bodyWidth <= metrics.viewportWidth + 1,
    notBlank: metrics.bodyText > 260,
    canvasUsable: Boolean(metrics.canvas && metrics.canvas.width >= 300 && metrics.canvas.height >= 220),
    requiredVisible: Object.values(visibility).every(Boolean),
    noForbiddenCopy: metrics.forbidden.length === 0,
    feedModeDeclared: ['live', 'demo', 'connecting'].includes(metrics.feedMode),
    noConsoleErrors: consoleErrors.length === 0,
    noPageErrors: pageErrors.length === 0,
  };

  const interactions = {};
  await shot('main');

  if (viewport.mobile) {
    checkpoint('mobile:market-sheet');
    await page.locator('#mobilePairButton').click();
    interactions.marketSheetVisible = await page.locator('#marketSheet').isVisible();
    await page.locator('#marketSheet [data-symbol="ETHUSDT"]').click();
    interactions.ethSelected = (await page.locator('#activePair').innerText()).includes('ETH/USDT');

    checkpoint('mobile:book');
    await page.locator('[data-mobile-view="book"]').click();
    interactions.mobileBookVisible = await page.locator('.orderbook-panel').isVisible();
    await shot('book');
    await page.locator('[data-mobile-view="chart"]').click();

    checkpoint('mobile:order');
    await page.locator('[data-mobile-side="buy"]').click();
    interactions.orderSheetOpen = await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'));
    const sheetBox = await page.locator('#orderTicket').boundingBox();
    interactions.orderSheetFits = Boolean(sheetBox && sheetBox.height <= viewport.height * 0.86 && sheetBox.y >= 0);
    await page.locator('[data-order-type="market"]').click();
    await page.locator('#orderTotal').fill('1200');
    interactions.estimateUpdated = Number(await page.locator('#orderQuantity').inputValue()) > 0;
    await shot('order-sheet');
    await page.locator('#submitOrder').click();
    await page.waitForTimeout(250);

    checkpoint('mobile:account');
    await page.locator('[data-mobile-view="account"]').click();
    interactions.positionVisible = (await page.locator('#positionsBody').innerText()).includes('ETH/USDT');
    interactions.balanceChanged = (await page.locator('#availableBalance').innerText()).trim() !== '100,000.00';
    await shot('account');
  } else {
    checkpoint('desktop:controls');
    await page.locator('#quickSearchButton').click();
    interactions.quickSearchFocused = await page.locator('#marketSearch').evaluate(element => element === document.activeElement);

    const compactBefore = await page.locator('.pro-shell').evaluate(element => element.classList.contains('compact-mode'));
    await page.locator('#layoutButton').click();
    const compactAfter = await page.locator('.pro-shell').evaluate(element => element.classList.contains('compact-mode'));
    interactions.layoutToggled = compactBefore !== compactAfter;
    await page.locator('#layoutButton').click();

    await page.locator('.notification-button').click();
    interactions.notificationPopoverVisible = await page.locator('#controlPopover').isVisible();
    await page.locator('[data-close-popover]').click();

    checkpoint('desktop:market-module');
    await page.locator('[data-main-nav="markets"]').click();
    interactions.marketModuleVisible = await page.locator('.module-overlay[data-module="markets"]').isVisible();
    await shot('market-module');
    await page.locator('.module-overlay[data-module="markets"] .module-close').click();

    checkpoint('desktop:trade');
    await page.locator('#marketSearch').fill('ETH');
    interactions.marketSearchFiltered = await page.locator('#marketList [data-symbol="ETHUSDT"]').isVisible();
    await page.locator('#marketList [data-symbol="ETHUSDT"]').click();
    interactions.ethSelected = (await page.locator('#activePair').innerText()).includes('ETH/USDT');

    await page.locator('[data-timeframe="4h"]').click();
    interactions.timeframeChanged = await page.locator('[data-timeframe="4h"]').evaluate(el => el.classList.contains('active'));
    await page.locator('#orderBook .book-row').first().click();
    interactions.bookPriceFilled = Number(await page.locator('#orderPrice').inputValue()) > 0;

    await page.locator('#pricePrecision').selectOption('1');
    interactions.precisionControlApplied = await page.locator('#pricePrecision').evaluate(element => element.value === '1');

    await page.locator('[data-order-type="limit"]').click();
    await page.locator('#orderTotal').fill('1500');
    await page.locator('#submitOrder').click();
    await page.waitForTimeout(180);
    await page.locator('[data-account-tab="orders"]').click();
    interactions.limitOrderCreated = (await page.locator('#ordersBody').innerText()).includes('ETH/USDT');
    await shot('open-order');

    await page.locator('[data-order-type="market"]').click();
    await page.locator('#orderTotal').fill('1000');
    await page.locator('#submitOrder').click();
    await page.waitForTimeout(180);
    await page.locator('[data-account-tab="positions"]').click();
    interactions.positionCreated = (await page.locator('#positionsBody').innerText()).includes('ETH/USDT');
    interactions.accountEquityVisible = Number((await page.locator('#accountEquity').innerText()).replace(/[^0-9.-]/g, '')) > 0;
    await shot('position');

    checkpoint('desktop:assets-module');
    await page.locator('[data-main-nav="assets"]').click();
    interactions.assetsModuleVisible = await page.locator('.module-overlay[data-module="assets"]').isVisible();
    await shot('assets-module');
    await page.locator('.module-overlay[data-module="assets"] .module-close').click();
  }

  checkpoint('persistence:reload');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 18000 });
  await injectQaFont(page);
  await page.waitForSelector('.pro-shell', { state: 'visible', timeout: 12000 });
  await page.waitForTimeout(350);
  interactions.marketPersisted = (await page.locator('#activePair').innerText()).includes('ETH/USDT');
  interactions.ordersOrPositionPersisted = (await page.locator('#accountWorkspace').innerText()).includes('ETH/USDT');

  const passed = allTrue(structural) && allTrue(interactions);
  failed = !passed;
  report.results.push({ viewport, structural, interactions, metrics, consoleErrors, pageErrors, passed });
  checkpoint(`result:${passed ? 'pass' : 'fail'}`);
} catch (error) {
  failed = true;
  checkpoint(`fatal:${String(error)}`);
  try { await shot('fatal'); } catch {}
  report.results.push({ viewport, passed: false, fatalError: String(error), consoleErrors, pageErrors });
} finally {
  await fs.writeFile('qa-artifacts-pro/report.json', JSON.stringify(report, null, 2));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

if (failed) {
  console.error(`ATLAS X Pro acceptance failed for ${viewport.name}.`);
  process.exit(1);
}
console.log(`ATLAS X Pro acceptance completed successfully for ${viewport.name}.`);
