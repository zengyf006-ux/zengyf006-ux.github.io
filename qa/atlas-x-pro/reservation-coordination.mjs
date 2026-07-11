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

const seedState = {
  activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'sell', orderType: 'market',
  accountTab: 'positions', mobileView: 'chart', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 50000,
  positions: [{ id: 'coord-position', symbol: 'BTCUSDT', qty: 0.6, entry: 60000, fees: 28.8, createdAt: Date.now() - 500000 }],
  orders: [], history: [], nextId: 300,
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
page.setDefaultTimeout(12000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const geometry = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

async function openOrderSheet(side = 'sell') {
  if (viewport.mobile && !await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))) {
    await page.locator(`[data-mobile-side="${side}"]`).click();
    await page.waitForFunction(() => document.body.classList.contains('order-sheet-open'));
  }
  await page.locator(`.side-selector [data-side="${side}"]`).click();
}

async function openPanel(toggleSelector, bodySelector) {
  const toggle = page.locator(toggleSelector);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.waitForSelector(bodySelector, { state: 'visible' });
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.exitStrategies === 'ready'
    && document.documentElement.dataset.reservationCoordinator === 'ready'
    && document.documentElement.dataset.atlasQualityStyles === 'ready', null, { timeout: 12000 });

  await openOrderSheet('sell');
  await openPanel('.advanced-exit-toggle', '.advanced-exit-body');
  await page.locator('[data-exit-tab="trailing"]').click();
  await page.locator('#trailingQuantity').fill('0.1');
  await page.locator('#trailingPercent').fill('2');
  await page.locator('#createTrailingStop').click();
  await page.waitForFunction(() => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}');
    return store.strategies?.some(strategy => strategy.kind === 'trailing_stop' && strategy.status === 'active');
  });
  await page.waitForFunction(() => Math.abs(Number(window.AtlasReservations?.snapshot?.().available) - 0.5) < 1e-8);

  const reservation = await page.evaluate(() => window.AtlasReservations.snapshot());
  checks.unifiedSnapshotCorrect = Math.abs(reservation.held - 0.6) < 1e-8
    && Math.abs(reservation.trailingReserved - 0.1) < 1e-8
    && Math.abs(reservation.available - 0.5) < 1e-8;

  await openPanel('.advanced-oco-toggle', '.advanced-oco-body');
  const current = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
  await page.locator('#ocoQuantity').fill('0.55');
  await page.locator('#ocoTakeProfit').fill(String((current * 1.04).toFixed(2)));
  await page.locator('#ocoStopTrigger').fill(String((current * 0.96).toFixed(2)));
  await page.locator('#createOcoOrder').click();
  await page.waitForTimeout(160);
  const ocoStatus = await page.locator('#advancedOcoStatus').innerText();
  const advancedOrders = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}'));
  const coreAfterOco = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}'));
  checks.ocoHonorsTrailingReservation = ocoStatus.includes('退出策略预留')
    && !(advancedOrders.orders || []).some(order => order.status === 'active')
    && (coreAfterOco.orders || []).length === 0;
  const badgeHandle = await page.waitForFunction(() => {
    const badge = document.querySelector('#ocoAvailableBadge');
    const available = Number(badge?.dataset.availableQuantity);
    const text = badge?.textContent || '';
    return Math.abs(available - 0.5) < 1e-8 && text.includes('0.5') ? { available, text } : false;
  });
  const badgeSnapshot = await badgeHandle.jsonValue();
  checks.ocoBadgeUsesUnifiedAvailability = Math.abs(Number(badgeSnapshot?.available) - 0.5) < 1e-8
    && String(badgeSnapshot?.text || '').includes('0.5');

  await openPanel('.risk-sizing-toggle', '.risk-sizing-body');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('.risk-sizing-panel')?.dataset.suggestedQuantity) - 0.5) < 1e-8);
  const riskPanel = page.locator('.risk-sizing-panel');
  checks.riskSizingUsesUnifiedAvailability = Math.abs(Number(await riskPanel.getAttribute('data-suggested-quantity')) - 0.5) < 1e-8
    && (await page.locator('#riskSizingStatus').innerText()).includes('退出策略预留');

  if (viewport.mobile) {
    await page.locator('#orderSheetClose').click();
    await page.waitForFunction(() => !document.body.classList.contains('order-sheet-open'));
    await page.waitForFunction(() => {
      const ticket = document.querySelector('#orderTicket');
      if (!ticket) return true;
      const style = getComputedStyle(ticket);
      const rect = ticket.getBoundingClientRect();
      return style.display === 'none'
        || style.visibility === 'hidden'
        || Number(style.opacity || 1) < 0.05
        || rect.top >= innerHeight - 1;
    }, null, { timeout: 2000 });
    await page.locator('#chartStage').scrollIntoViewIfNeeded();
  }

  const visibilityHandle = await page.waitForFunction(() => {
    const element = document.querySelector('.chart-trade-layer .trailing-stop-line');
    if (!element) return false;
    const label = element.querySelector('span,b,em,small') || element;
    const lineStyle = getComputedStyle(element);
    const labelStyle = getComputedStyle(label);
    const lineRect = element.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const visible = lineStyle.display !== 'none'
      && lineStyle.visibility !== 'hidden'
      && Number(lineStyle.opacity || 1) > 0
      && labelStyle.display !== 'none'
      && labelStyle.visibility !== 'hidden'
      && Number(labelStyle.opacity || 1) > 0
      && lineRect.width > 0
      && lineRect.height > 0
      && labelRect.width > 0
      && labelRect.height > 0
      && labelRect.right >= 0
      && labelRect.bottom >= 0
      && labelRect.left <= innerWidth
      && labelRect.top <= innerHeight;
    if (!visible) return false;
    return {
      visible,
      line: { left: lineRect.left, top: lineRect.top, width: lineRect.width, height: lineRect.height },
      label: { left: labelRect.left, top: labelRect.top, width: labelRect.width, height: labelRect.height },
      styles: {
        lineDisplay: lineStyle.display,
        lineVisibility: lineStyle.visibility,
        lineOpacity: lineStyle.opacity,
        labelDisplay: labelStyle.display,
        labelVisibility: labelStyle.visibility,
        labelOpacity: labelStyle.opacity,
      },
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, null, { timeout: 5000, polling: 50 });
  geometry.trailing = await visibilityHandle.jsonValue();
  checks.trailingChartLineVisible = geometry.trailing?.visible === true;

  const trailingLine = page.locator('.chart-trade-layer .trailing-stop-line');
  const lineText = await trailingLine.innerText();
  checks.trailingChartLabelDetailed = lineText.includes('追踪止损') && lineText.includes('0.1');
  const chartVisibility = await trailingLine.getAttribute('data-chart-visibility');
  checks.trailingChartRangeState = ['visible', 'above', 'below'].includes(chartVisibility || '');
  checks.offscreenRiskRemainsExplicit = chartVisibility === 'visible'
    || (chartVisibility === 'above' && lineText.includes('高于可视区'))
    || (chartVisibility === 'below' && lineText.includes('低于可视区'));

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-reservation-coordination.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-reservation-coordination-fatal.png`, fullPage: false, timeout: 12000 });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/reservation-coordination-report.json', JSON.stringify({
  target, viewport, checks, geometry, consoleErrors, pageErrors, fatalError, passed,
  generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro reservation coordination failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro reservation coordination passed for ${name}`);
