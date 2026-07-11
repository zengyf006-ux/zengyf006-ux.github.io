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
  activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'sell', orderType: 'market',
  accountTab: 'positions', mobileView: 'chart', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 50000,
  positions: [{ id: 'exit-position', symbol: 'BTCUSDT', qty: 0.6, entry: 60000, fees: 28.8, createdAt: now - 500000 }],
  orders: [], history: [], nextId: 200,
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
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

const readCore = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}'));
const readExitStore = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}'));

async function openExitPanel(tab = 'trailing') {
  if (viewport.mobile && !await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))) {
    await page.locator('[data-mobile-side="sell"]').click();
  }
  await page.waitForSelector('.advanced-exit-panel', { state: 'visible' });
  const toggle = page.locator('.advanced-exit-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.waitForSelector('.advanced-exit-body', { state: 'visible' });
  await page.locator(`[data-exit-tab="${tab}"]`).click();
  await page.waitForSelector(`[data-exit-pane="${tab}"]`, { state: 'visible' });
}

async function createTrailing(quantity, trailPercent, activation = '', tif = 'gtc') {
  const previousIds = (await readExitStore()).strategies.map(strategy => strategy.id);
  await openExitPanel('trailing');
  await page.locator('#trailingQuantity').fill(String(quantity));
  await page.locator('#trailingActivation').fill(String(activation));
  await page.locator('#trailingPercent').fill(String(trailPercent));
  await page.locator('#trailingTif').selectOption(tif);
  await page.locator('#createTrailingStop').click();
  await page.waitForFunction(ids => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}');
    return store.strategies?.some(strategy => strategy.kind === 'trailing_stop'
      && ['waiting_activation', 'active'].includes(strategy.status)
      && !ids.includes(strategy.id));
  }, previousIds);
  return (await readExitStore()).strategies.find(strategy => strategy.kind === 'trailing_stop'
    && ['waiting_activation', 'active'].includes(strategy.status)
    && !previousIds.includes(strategy.id));
}

async function createScaledExit(totalQuantity, prices, percentages, tif = 'gtc') {
  const previousIds = (await readExitStore()).strategies.map(strategy => strategy.id);
  await openExitPanel('scaled');
  await page.locator('#scaledTotalQuantity').fill(String(totalQuantity));
  for (let index = 0; index < 3; index += 1) {
    await page.locator(`#scaledPrice${index + 1}`).fill(String(prices[index]));
    await page.locator(`#scaledPercent${index + 1}`).fill(String(percentages[index]));
  }
  await page.locator('#scaledTif').selectOption(tif);
  await page.locator('#createScaledExit').click();
  await page.waitForFunction(ids => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}');
    return store.strategies?.some(strategy => strategy.kind === 'scaled_exit'
      && strategy.status === 'active'
      && !ids.includes(strategy.id));
  }, previousIds, { timeout: 16000 });
  return (await readExitStore()).strategies.find(strategy => strategy.kind === 'scaled_exit'
    && strategy.status === 'active'
    && !previousIds.includes(strategy.id));
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForSelector('.pro-shell', { state: 'visible', timeout: 12000 });
  await page.waitForFunction(() => document.documentElement.dataset.exitStrategies === 'ready', null, { timeout: 12000 });

  const current = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
  const trailing = await createTrailing(0.1, 2, '', 'gtc');
  const coreAfterTrailing = await readCore();
  checks.panelVisible = await page.locator('.advanced-exit-panel').isVisible();
  checks.trailingCreatesNoCoreOrder = (coreAfterTrailing.orders || []).length === 0;
  checks.trailingStoredActive = trailing?.status === 'active'
    && Math.abs(Number(trailing.quantity) - 0.1) < 1e-10
    && Math.abs(Number(trailing.peakPrice) - current) < current * 0.01;
  checks.trailingReservedLocally = Math.abs(Number(await page.locator('.advanced-exit-panel').getAttribute('data-trailing-reserved')) - 0.1) < 1e-10;

  await page.locator('.side-selector [data-side="sell"]').click();
  await page.locator('[data-order-type="market"]').click();
  await page.locator('#orderQuantity').fill('0.55');
  await page.locator('#orderQuantity').dispatchEvent('input');
  await page.locator('#submitOrder').click();
  await page.waitForTimeout(150);
  checks.guardHonorsTrailingReservation = (await page.locator('#executionStatusCopy').innerText()).includes('退出策略预留');
  checks.reservedSellNotExecuted = (await readCore()).history.length === 0;

  const peakPrice = current * 1.05;
  await page.evaluate(price => window.AtlasExitStrategies?.evaluateAtPrice?.(price), peakPrice);
  await page.waitForFunction(id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}');
    const strategy = store.strategies?.find(item => item.id === id);
    return Number(strategy?.peakPrice) > 0 && Number(strategy?.triggerPrice) > 0;
  }, trailing.id);
  const afterPeak = (await readExitStore()).strategies.find(strategy => strategy.id === trailing.id);
  checks.trailingPeakMovesUp = Math.abs(Number(afterPeak.peakPrice) - peakPrice) < 0.02;
  checks.trailingTriggerCalculated = Math.abs(Number(afterPeak.triggerPrice) - peakPrice * 0.98) < 0.02;

  await page.evaluate(price => window.AtlasExitStrategies?.evaluateAtPrice?.(price), Number(afterPeak.triggerPrice) * 0.999);
  await page.waitForFunction(id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}');
    return store.strategies?.find(strategy => strategy.id === id)?.status === 'completed';
  }, trailing.id, { timeout: 12000 });
  const coreAfterTrigger = await readCore();
  checks.trailingExecutesCoreSell = coreAfterTrigger.history?.some(history => history.side === 'sell' && Math.abs(Number(history.qty) - 0.1) < 1e-10);
  checks.trailingReducesPosition = Math.abs(Number(coreAfterTrigger.positions?.find(position => position.symbol === 'BTCUSDT')?.qty) - 0.5) < 1e-8;

  const liveBeforeScale = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
  const scalePrices = [1.02, 1.04, 1.06].map(multiplier => Number((liveBeforeScale * multiplier).toFixed(2)));
  const scaled = await createScaledExit(0.3, scalePrices, [30, 30, 40], 'gtc');
  const coreAfterScale = await readCore();
  const scaledCoreOrders = coreAfterScale.orders.filter(order => scaled.legs.some(leg => leg.coreOrderId === order.id));
  checks.scaledCreatesThreeCoreOrders = scaledCoreOrders.length === 3
    && scaledCoreOrders.every(order => order.side === 'sell' && order.type === 'limit' && order.reduceOnly === true);
  checks.scaledQuantitiesExact = Math.abs(scaledCoreOrders.reduce((sum, order) => sum + Number(order.qty), 0) - 0.3) < 1e-8;
  const quantities = scaled.legs.map(leg => Number(leg.quantity));
  checks.scaledDistributionCorrect = Math.abs(quantities[0] - 0.09) < 1e-8
    && Math.abs(quantities[1] - 0.09) < 1e-8
    && Math.abs(quantities[2] - 0.12) < 1e-8;
  checks.scaledLegsLinked = scaled.legs.length === 3 && scaled.legs.every(leg => leg.coreOrderId);

  const firstLeg = scaled.legs[0];
  await page.evaluate(async ({ strategyId, legId, coreOrderId, price, quantity }) => {
    const core = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
    core.orders = (core.orders || []).filter(order => order.id !== coreOrderId);
    core.history = [{
      id: `qa-scale-${Date.now()}`, symbol: 'BTCUSDT', side: 'sell', price, qty: quantity,
      fee: price * quantity * 0.0008, status: '已成交', createdAt: Date.now(),
    }, ...(core.history || [])];
    localStorage.setItem('atlasX.pro.v1', JSON.stringify(core));
    await window.AtlasExitStrategies?.evaluateNow?.();
  }, { strategyId: scaled.id, legId: firstLeg.id, coreOrderId: firstLeg.coreOrderId, price: firstLeg.price, quantity: firstLeg.quantity });
  await page.waitForFunction(id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}');
    return store.strategies?.find(strategy => strategy.id === id)?.status === 'partially_completed';
  }, scaled.id);
  checks.scaledPartialCompletionDetected = true;

  await page.evaluate(async id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}');
    const strategy = store.strategies?.find(item => item.id === id);
    const core = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
    const remaining = strategy.legs.filter(leg => leg.status === 'pending');
    core.orders = (core.orders || []).filter(order => !remaining.some(leg => leg.coreOrderId === order.id));
    core.history = remaining.map((leg, index) => ({
      id: `qa-scale-rest-${Date.now()}-${index}`, symbol: strategy.symbol, side: 'sell',
      price: leg.price, qty: leg.quantity, fee: leg.price * leg.quantity * 0.0008,
      status: '已成交', createdAt: Date.now() + index,
    })).concat(core.history || []);
    localStorage.setItem('atlasX.pro.v1', JSON.stringify(core));
    await window.AtlasExitStrategies?.evaluateNow?.();
  }, scaled.id);
  await page.waitForFunction(id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}');
    return store.strategies?.find(strategy => strategy.id === id)?.status === 'completed';
  }, scaled.id);
  checks.scaledCompletionDetected = true;

  await page.evaluate(() => document.querySelector('#marketList [data-symbol="ETHUSDT"]')?.click());
  await page.waitForFunction(() => document.querySelector('#activePair')?.textContent?.includes('ETH/USDT'));
  await openExitPanel('trailing');
  await page.waitForFunction(() => document.querySelector('.advanced-exit-panel')?.dataset.exitSymbol === 'ETHUSDT');
  checks.symbolIsolation = await page.locator('.advanced-exit-row').count() === 0;

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.mobileTouchTargets = viewport.mobile
    ? await page.locator('#createTrailingStop').evaluate(element => element.getBoundingClientRect().height >= 38)
    : true;
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-exit-strategies.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-exit-strategies-fatal.png`, fullPage: false, timeout: 12000 });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/exit-strategies-report.json', JSON.stringify({
  target, viewport, checks, consoleErrors, pageErrors, fatalError, passed,
  generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro exit strategies failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro exit strategies passed for ${name}`);
