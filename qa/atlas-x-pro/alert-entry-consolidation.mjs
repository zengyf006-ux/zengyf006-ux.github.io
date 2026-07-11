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
await context.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('atlasX.pro.v1', JSON.stringify({
    activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'market',
    accountTab: 'positions', mobileView: 'chart', marketFilter: 'all', bookMode: 'all',
    favorites: ['BTCUSDT'], cash: 50000, positions: [], orders: [], history: [], nextId: 1,
  }));
  localStorage.setItem('atlasX.pro.price-alerts.v1', JSON.stringify([
    {
      id: 'legacy-alert-1', pair: 'BTC/USDT', condition: 'above', price: 65000,
      triggered: false, createdAt: Date.now() - 10000,
    },
  ]));
});

const page = await context.newPage();
page.setDefaultTimeout(12000);
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
  await page.waitForSelector('.pro-shell', { state: 'visible' });
  await page.waitForFunction(() => document.documentElement.dataset.alertCenter === 'ready');
  if (viewport.mobile) await page.waitForFunction(() => document.documentElement.dataset.mobileAlertEntry === 'ready');
  await page.waitForTimeout(120);

  const alertState = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{}'));
  checks.legacyRuleMigrated = alertState.rules?.some(rule => rule.symbol === 'BTCUSDT'
    && rule.type === 'price_above'
    && Math.abs(Number(rule.threshold) - 65000) < 0.001
    && rule.enabled === true);
  checks.legacyMigrationMarked = Boolean(localStorage.getItem('atlasX.pro.alertCenter.legacyMigrated.v1'));
  checks.legacyButtonsRemoved = await page.locator('[data-open-price-alert]').count() === 0;
  checks.legacyPanelRemoved = await page.locator('#priceAlertPanel').count() === 0;
  checks.singleMobileAlertEntry = viewport.mobile
    ? await page.locator('.mobile-market-head .mobile-alert-button').count() === 1
    : true;
  checks.mobileAlertEntryVisible = viewport.mobile
    ? await page.locator('.mobile-alert-button').isVisible()
    : true;
  checks.desktopNotificationEntryVisible = viewport.mobile
    ? true
    : await page.locator('.notification-button').isVisible();
  checks.noDuplicateBellControls = await page.evaluate(isMobile => {
    if (!isMobile) return document.querySelectorAll('.pro-topbar .notification-button').length === 1;
    const head = document.querySelector('.mobile-market-head');
    if (!head) return false;
    return head.querySelectorAll('.mobile-alert-button').length === 1
      && head.querySelectorAll('[data-open-price-alert]').length === 0;
  }, viewport.mobile);
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-alert-entry-consolidation.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-alert-entry-consolidation-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/alert-entry-consolidation-report.json', JSON.stringify({
  target, viewport, checks, consoleErrors, pageErrors, fatalError, passed,
  generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro alert entry consolidation failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro alert entry consolidation passed for ${name}`);
