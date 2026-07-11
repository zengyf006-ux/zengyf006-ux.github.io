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
  activeSymbol: 'BTCUSDT',
  timeframe: '1h',
  indicator: 'ema',
  side: 'buy',
  orderType: 'market',
  accountTab: 'positions',
  mobileView: 'chart',
  marketFilter: 'all',
  bookMode: 'all',
  favorites: ['BTCUSDT'],
  cash: 50000,
  positions: [{ id: 'oco-position', symbol: 'BTCUSDT', qty: 0.5, entry: 60000, fees: 24, createdAt: now - 500000 }],
  orders: [],
  history: [],
  nextId: 100,
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
const readAdvanced = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}'));

async function openOcoPanel() {
  if (viewport.mobile && !await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))) {
    await page.locator('[data-mobile-side="sell"]').click();
  }
  await page.waitForSelector('.advanced-oco-panel', { state: 'visible' });
  const toggle = page.locator('.advanced-oco-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.waitForSelector('.advanced-oco-body', { state: 'visible' });
}

async function fillOco(quantity, takeProfit, stopTrigger, tif = 'gtc') {
  await openOcoPanel();
  await page.locator('#ocoQuantity').fill(String(quantity));
  await page.locator('#ocoTakeProfit').fill(String(takeProfit));
  await page.locator('#ocoStopTrigger').fill(String(stopTrigger));
  await page.locator('#ocoTif').selectOption(tif);
  await page.locator('#ocoStopTrigger').dispatchEvent('input');
}

async function waitForNewActiveOco(previousIds) {
  await page.waitForFunction(ids => {
    const stored = JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}');
    return stored.orders?.some(order => order.status === 'active' && !ids.includes(order.id));
  }, previousIds);
  return (await readAdvanced()).orders.find(order => order.status === 'active' && !previousIds.includes(order.id));
}

async function createOco(quantity, takeProfit, stopTrigger, tif = 'gtc') {
  const previousIds = (await readAdvanced()).orders.map(order => order.id);
  await fillOco(quantity, takeProfit, stopTrigger, tif);
  await page.locator('#createOcoOrder').click();
  return waitForNewActiveOco(previousIds);
}

async function createRelativeOco(quantity, takeProfitMultiplier, stopMultiplier, tif = 'gtc') {
  const previousIds = (await readAdvanced()).orders.map(order => order.id);
  await openOcoPanel();
  const draft = await page.evaluate(({ quantity: qty, takeProfitMultiplier: tpMultiplier, stopMultiplier: slMultiplier, tifValue }) => {
    const current = Number((document.querySelector('#lastPrice')?.textContent || '').replace(/,/g, ''));
    const takeProfit = Number((current * tpMultiplier).toFixed(2));
    const stopTrigger = Number((current * slMultiplier).toFixed(2));
    const setValue = (selector, value, eventName = 'input') => {
      const input = document.querySelector(selector);
      if (!input) throw new Error(`Missing OCO field: ${selector}`);
      input.value = String(value);
      input.dispatchEvent(new Event(eventName, { bubbles: true }));
    };
    setValue('#ocoQuantity', qty);
    setValue('#ocoTakeProfit', takeProfit);
    setValue('#ocoStopTrigger', stopTrigger);
    setValue('#ocoTif', tifValue, 'change');
    return { current, takeProfit, stopTrigger };
  }, { quantity, takeProfitMultiplier, stopMultiplier, tifValue: tif });
  await page.locator('#createOcoOrder').click();
  const order = await waitForNewActiveOco(previousIds);
  return { order, ...draft };
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForSelector('.pro-shell', { state: 'visible', timeout: 12000 });
  await page.waitForFunction(() => document.documentElement.dataset.advancedOco === 'ready', null, { timeout: 12000 });

  const current = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
  const takeProfit = Number((current * 1.04).toFixed(2));
  const stopTrigger = Number((current * 0.96).toFixed(2));
  const quantity = 0.05;

  const first = await createOco(quantity, takeProfit, stopTrigger, 'gtc');
  const coreAfterCreate = await readCore();
  checks.panelVisible = await page.locator('.advanced-oco-panel').isVisible();
  checks.singleCoreLeg = coreAfterCreate.orders?.length === 1
    && coreAfterCreate.orders[0].side === 'sell'
    && coreAfterCreate.orders[0].type === 'limit';
  checks.coreLegMatches = Math.abs(Number(coreAfterCreate.orders[0]?.qty) - quantity) < 1e-10
    && Math.abs(Number(coreAfterCreate.orders[0]?.price) - takeProfit) < 0.02;
  checks.reduceOnlyCoreLeg = coreAfterCreate.orders[0]?.reduceOnly === true;
  checks.advancedRecordLinked = first?.status === 'active'
    && first?.tpOrderId === coreAfterCreate.orders[0]?.id
    && Math.abs(Number(first?.stopTrigger) - stopTrigger) < 0.02;
  const reserved = coreAfterCreate.orders
    .filter(order => order.side === 'sell')
    .reduce((sum, order) => sum + Number(order.qty || 0) - Number(order.filled || 0), 0);
  checks.reservedOnlyOnce = Math.abs(reserved - quantity) < 1e-10;
  checks.activeRowVisible = await page.locator(`.advanced-oco-row[data-oco-id="${first.id}"]`).isVisible();

  await fillOco(quantity, takeProfit, stopTrigger, 'gtc');
  await page.locator('#createOcoOrder').click();
  await page.waitForTimeout(180);
  const duplicateState = await readAdvanced();
  checks.duplicateBlocked = duplicateState.orders.filter(order => order.status === 'active').length === 1
    && (await page.locator('#advancedOcoStatus').innerText()).includes('重复');

  await page.evaluate(async price => {
    const element = document.querySelector('#lastPrice');
    if (element) element.textContent = Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await window.AtlasAdvancedOco?.evaluateNow?.();
  }, stopTrigger - Math.max(1, current * 0.002));
  await page.waitForFunction(id => {
    const stored = JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}');
    return stored.orders?.find(order => order.id === id)?.status === 'completed_stop';
  }, first.id, { timeout: 12000 });
  const afterStopCore = await readCore();
  const afterStopAdvanced = await readAdvanced();
  const stopped = afterStopAdvanced.orders.find(order => order.id === first.id);
  checks.stopCancelsTakeProfit = !afterStopCore.orders?.some(order => order.id === first.tpOrderId);
  checks.stopExecutesCoreFill = afterStopCore.history?.some(history => history.side === 'sell' && Math.abs(Number(history.qty) - quantity) < 1e-10);
  checks.stopReducesPosition = Math.abs(Number(afterStopCore.positions?.find(position => position.symbol === 'BTCUSDT')?.qty) - 0.45) < 1e-8;
  checks.stopStatusAudited = stopped?.status === 'completed_stop' && Number(stopped.completedAt) > Number(stopped.createdAt);

  const expiringDraft = await createRelativeOco(0.03, 1.03, 0.97, '15m');
  const expiring = expiringDraft.order;
  checks.expiryDraftValidAtSubmit = expiringDraft.takeProfit > expiringDraft.current
    && expiringDraft.stopTrigger < expiringDraft.current;
  await page.evaluate(id => {
    const stored = JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}');
    const order = stored.orders?.find(item => item.id === id);
    if (order) order.expiresAt = Date.now() - 1;
    localStorage.setItem('atlasX.pro.advancedOrders.v1', JSON.stringify(stored));
    window.AtlasAdvancedOco?.evaluateNow?.();
  }, expiring.id);
  await page.waitForFunction(id => {
    const stored = JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}');
    return stored.orders?.find(order => order.id === id)?.status === 'expired';
  }, expiring.id);
  const afterExpiryCore = await readCore();
  checks.expiryCancelsCoreLeg = !afterExpiryCore.orders?.some(order => order.id === expiring.tpOrderId);

  const takingProfitDraft = await createRelativeOco(0.02, 1.025, 0.975, 'gtc');
  const takingProfit = takingProfitDraft.order;
  const tpPrice = takingProfitDraft.takeProfit;
  await page.evaluate(async ({ id, orderId, price, quantity: qty }) => {
    const core = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
    core.orders = (core.orders || []).filter(order => order.id !== orderId);
    core.history = [{
      id: `qa-tp-${Date.now()}`,
      symbol: 'BTCUSDT',
      side: 'sell',
      price,
      qty,
      fee: price * qty * 0.0008,
      status: '已成交',
      createdAt: Date.now(),
    }, ...(core.history || [])];
    const position = core.positions?.find(item => item.symbol === 'BTCUSDT');
    if (position) position.qty = Math.max(0, Number(position.qty) - qty);
    localStorage.setItem('atlasX.pro.v1', JSON.stringify(core));
    const advanced = JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}');
    const record = advanced.orders?.find(order => order.id === id);
    if (record) record.status = 'active';
    localStorage.setItem('atlasX.pro.advancedOrders.v1', JSON.stringify(advanced));
    await window.AtlasAdvancedOco?.evaluateNow?.();
  }, { id: takingProfit.id, orderId: takingProfit.tpOrderId, price: tpPrice, quantity: 0.02 });
  await page.waitForFunction(id => {
    const stored = JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}');
    return stored.orders?.find(order => order.id === id)?.status === 'completed_take_profit';
  }, takingProfit.id);
  const finalAdvanced = await readAdvanced();
  checks.takeProfitCompletionDetected = finalAdvanced.orders.find(order => order.id === takingProfit.id)?.status === 'completed_take_profit';

  await openOcoPanel();
  checks.currentPairHistoryVisible = await page.locator('.advanced-oco-row').count() >= 3;
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.mobileTouchTargets = viewport.mobile
    ? await page.locator('#createOcoOrder').evaluate(element => element.getBoundingClientRect().height >= 38)
    : true;
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-advanced-order-oco.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-advanced-order-oco-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/advanced-order-oco-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro OCO advanced order failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro OCO advanced order passed for ${name}`);
