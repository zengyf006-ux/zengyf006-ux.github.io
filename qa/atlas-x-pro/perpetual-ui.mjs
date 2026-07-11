import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const viewportMap = {
  'iphone-390x844': { width: 390, height: 844, mobile: true },
  'iphone-430x932': { width: 430, height: 932, mobile: true },
  'desktop-1440x900': { width: 1440, height: 900, mobile: false },
  'desktop-1920x1080': { width: 1920, height: 1080, mobile: false },
};
const name = process.env.ATLAS_VIEWPORT || 'desktop-1440x900';
const viewport = viewportMap[name];
if (!viewport) throw new Error(`Unknown viewport ${name}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport, isMobile: viewport.mobile, hasTouch: viewport.mobile });
await context.addInitScript(() => {
  localStorage.removeItem('atlasX.pro.perpetual.v1');
  localStorage.removeItem('atlasX.pro.perpetual.corruptBackup.v1');
  localStorage.setItem('atlasX.pro.tradingMode.v1', 'perpetual');
});
const page = await context.newPage();
page.setDefaultTimeout(14000);
const consoleErrors = [];
const pageErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

const checks = {};
let fatalError = null;
try {
  await page.goto('http://127.0.0.1:4173/atlas-x-pro/?qa=1&perpetual=1', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css' });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css' });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.perpetualUi === 'ready');

  checks.uiReady = await page.evaluate(() => document.documentElement.dataset.perpetualUi === 'ready');
  checks.workspaceVisible = await page.locator('#perpetualWorkspace').isVisible();
  checks.simulationBoundaryVisible = await page.locator('[data-perpetual-sim-label]').isVisible();
  checks.contractSelectorVisible = await page.locator('#perpSymbol').isVisible();
  checks.marketContextVisible = await page.locator('#perpMarkPrice').isVisible()
    && await page.locator('#perpIndexPrice').isVisible()
    && await page.locator('#perpFundingRate').isVisible()
    && await page.locator('#perpFundingCountdown').isVisible();
  checks.tradeContextVisible = await page.locator('[data-perp-margin-mode]').isVisible()
    && await page.locator('#perpLeverage').isVisible()
    && await page.locator('[data-perp-order-type="market"]').isVisible();
  checks.estimatePanelVisible = await page.locator('#perpEstimate').isVisible();

  await page.locator('#perpSymbol').selectOption('BTC-USDT-SWAP');
  await page.locator('[data-perp-margin-mode="isolated"]').click();
  await page.locator('#perpLeverage').selectOption('20');
  await page.locator('[data-perp-order-type="market"]').click();
  await page.locator('#perpQuantity').fill('0.01');
  await page.locator('[data-perp-submit="long"]').click();
  await page.waitForFunction(() => window.AtlasPerpetual?.getSnapshot?.().positions?.length === 1);

  checks.longOrderCreatesPosition = await page.locator('[data-perp-position-id]').count() === 1;
  const snapshot = await page.evaluate(() => window.AtlasPerpetual.getSnapshot());
  checks.positionUsesSelectedContext = snapshot.positions[0]?.marginMode === 'isolated'
    && snapshot.positions[0]?.leverage === 20
    && snapshot.positions[0]?.side === 'long';
  checks.accountTabsReachable = await page.locator('[data-perp-account-tab="positions"]').isVisible()
    && await page.locator('[data-perp-account-tab="orders"]').isVisible()
    && await page.locator('[data-perp-account-tab="funding"]').isVisible()
    && await page.locator('[data-perp-account-tab="liquidations"]').isVisible()
    && await page.locator('[data-perp-account-tab="audit"]').isVisible();

  if (viewport.mobile) {
    checks.mobileCoreButtonsLarge = await page.locator('[data-perp-submit="long"]').evaluate(el => el.getBoundingClientRect().height >= 48)
      && await page.locator('[data-perp-submit="short"]').evaluate(el => el.getBoundingClientRect().height >= 48);
    checks.mobilePrimaryControlsLarge = await page.locator('#perpSymbol').evaluate(el => el.getBoundingClientRect().height >= 42)
      && await page.locator('#perpLeverage').evaluate(el => el.getBoundingClientRect().height >= 42);
  } else {
    checks.mobileCoreButtonsLarge = true;
    checks.mobilePrimaryControlsLarge = true;
  }

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
  await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-perpetual-ui.png`, fullPage: false });
} catch (error) {
  fatalError = String(error);
  try { await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-perpetual-ui-fatal.png`, fullPage: false }); } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/perpetual-ui-report.json', JSON.stringify({ name, viewport, checks, consoleErrors, pageErrors, fatalError, passed }, null, 2));
await context.close();
await browser.close();
if (!passed) {
  console.error(`ATLAS X perpetual UI failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X perpetual UI passed for ${name}`);
