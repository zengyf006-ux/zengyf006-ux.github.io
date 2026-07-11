import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const viewportMap = {
  'iphone-390x844': { name: 'iphone-390x844', width: 390, height: 844, mobile: true },
  'iphone-430x932': { name: 'iphone-430x932', width: 430, height: 932, mobile: true },
  'desktop-1440x900': { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  'desktop-1920x1080': { name: 'desktop-1920x1080', width: 1920, height: 1080, mobile: false },
};
const name = process.env.ATLAS_VIEWPORT || 'iphone-390x844';
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
page.setDefaultTimeout(12_000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1&stage=mobile-terminal-2';
const checks = {};
const measurements = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18_000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.marketDataEngine === 'ready');

  if (viewport.mobile) {
    await page.waitForFunction(() => document.documentElement.dataset.mobileTerminalStage2 === 'ready');
    const shell = page.locator('.mobile-terminal-stage2');
    checks.shellUnique = await shell.count() === 1 && await shell.isVisible();
    checks.marketHeaderUnique = await page.locator('.mobile-stage2-market').count() === 1;
    checks.surfaceNavUnique = await page.locator('.mobile-stage2-surfaces').count() === 1;
    checks.contentUnique = await page.locator('.mobile-stage2-content').count() === 1;
    checks.primaryActionsUnique = await page.locator('.mobile-primary-actions').count() === 1;
    checks.surfaceButtonsComplete = await page.locator('.mobile-stage2-surfaces [data-mobile-surface]').evaluateAll(elements => {
      const values = elements.map(element => element.dataset.mobileSurface).sort();
      return values.join(',') === 'account,book,chart,trades';
    });
    checks.twoPrimaryActions = await page.locator('.mobile-primary-actions button').evaluateAll(elements => {
      const sides = elements.map(element => element.dataset.mobileTradeSide).sort();
      return sides.join(',') === 'buy,sell';
    });
    checks.oneVisibleAlert = await page.locator('.mobile-alert-button:visible').count() === 1;
    checks.oneVisibleScreener = await page.locator('.mobile-market-center-button:visible').count() === 1;
    checks.oneVisibleFavorite = await page.locator('#mobileFavorite:visible').count() === 1;

    const primaryHeights = await page.locator('.mobile-primary-actions button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    const secondaryHeights = await page.locator('.mobile-stage2-market button:visible, .mobile-stage2-surfaces button:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    measurements.primaryHeights = primaryHeights;
    measurements.secondaryHeights = secondaryHeights;
    checks.primaryTouch44 = primaryHeights.length === 2 && primaryHeights.every(value => value >= 44);
    checks.secondaryTouch40 = secondaryHeights.length >= 6 && secondaryHeights.every(value => value >= 40);

    checks.chartStartsActive = await page.locator('[data-mobile-surface="chart"]').evaluate(element => element.classList.contains('active'));
    await page.locator('[data-mobile-surface="book"]').click();
    await page.waitForFunction(() => document.querySelector('.orderbook-panel')?.classList.contains('mobile-active'));
    checks.bookSurfaceWorks = await page.locator('[data-mobile-surface="book"]').evaluate(element => element.classList.contains('active'));
    await page.locator('[data-mobile-surface="trades"]').click();
    await page.waitForFunction(() => document.querySelector('[data-book-content="trades"]')?.classList.contains('active'));
    checks.tradesSurfaceWorks = await page.locator('[data-mobile-surface="trades"]').evaluate(element => element.classList.contains('active'));
    await page.locator('[data-mobile-surface="account"]').click();
    await page.waitForFunction(() => document.querySelector('.account-workspace')?.classList.contains('mobile-active'));
    checks.accountSurfaceWorks = await page.locator('[data-mobile-surface="account"]').evaluate(element => element.classList.contains('active'));
    await page.locator('[data-mobile-surface="chart"]').click();

    await page.locator('[data-mobile-trade-side="buy"]').click();
    checks.buyOpensExistingTicket = await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))
      && await page.locator('#submitOrder').evaluate(element => element.classList.contains('buy'));
    await page.locator('#orderSheetClose').click();
    await page.locator('[data-mobile-trade-side="sell"]').click();
    checks.sellOpensExistingTicket = await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))
      && await page.locator('#submitOrder').evaluate(element => element.classList.contains('sell'));
    await page.locator('#orderSheetClose').click();

    checks.safeAreaReserved = await page.locator('.mobile-primary-actions').evaluate(element => {
      const style = getComputedStyle(element);
      return parseFloat(style.paddingBottom || '0') >= 8 || style.paddingBottom.includes('env(');
    });
  } else {
    checks.shellUnique = await page.locator('.mobile-terminal-stage2').count() === 0;
    checks.marketHeaderUnique = true;
    checks.surfaceNavUnique = true;
    checks.contentUnique = true;
    checks.primaryActionsUnique = true;
    checks.surfaceButtonsComplete = true;
    checks.twoPrimaryActions = true;
    checks.oneVisibleAlert = true;
    checks.oneVisibleScreener = true;
    checks.oneVisibleFavorite = true;
    checks.primaryTouch44 = true;
    checks.secondaryTouch40 = true;
    checks.chartStartsActive = true;
    checks.bookSurfaceWorks = true;
    checks.tradesSurfaceWorks = true;
    checks.accountSurfaceWorks = true;
    checks.buyOpensExistingTicket = true;
    checks.sellOpensExistingTicket = true;
    checks.safeAreaReserved = true;
    checks.desktopWorkspaceUnchanged = await page.locator('.market-panel').isVisible()
      && await page.locator('.chart-panel').isVisible()
      && await page.locator('.orderbook-panel').isVisible()
      && await page.locator('.order-ticket').isVisible();
  }

  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-mobile-terminal-stage2.png`,
    fullPage: false,
    timeout: 12_000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-mobile-terminal-stage2-fatal.png`,
      fullPage: false,
      timeout: 12_000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/mobile-terminal-stage2-report.json', JSON.stringify({
  target, viewport, checks, measurements, consoleErrors, pageErrors, fatalError, passed,
  generatedAt: new Date().toISOString(),
}, null, 2));

await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro Stage 2 mobile shell failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro Stage 2 mobile shell passed for ${name}`);
