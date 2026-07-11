import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const viewports = {
  'iphone-390x844': { width: 390, height: 844, mobile: true },
  'iphone-430x932': { width: 430, height: 932, mobile: true },
  'desktop-1440x900': { width: 1440, height: 900, mobile: false },
  'desktop-1920x1080': { width: 1920, height: 1080, mobile: false },
};
const name = process.env.ATLAS_VIEWPORT || 'desktop-1440x900';
const viewport = viewports[name];
if (!viewport) throw new Error(`Unknown viewport ${name}`);

const seed = {
  activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'market',
  accountTab: 'positions', mobileView: 'chart', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 50000, positions: [], orders: [], history: [], nextId: 900,
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
await context.addInitScript(value => {
  localStorage.clear();
  localStorage.setItem('atlasX.pro.v1', JSON.stringify(value));
}, seed);
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = {};
const metrics = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

async function openOrder(side = 'buy') {
  if (viewport.mobile) {
    await page.locator(`[data-mobile-side="${side}"]`).click();
    await page.waitForFunction(() => document.body.classList.contains('order-sheet-open'));
  } else {
    await page.locator(`.side-selector [data-side="${side}"]`).click();
  }
  await page.waitForSelector('.professional-order-entry', { state: 'visible' });
}

try {
  await page.goto('http://127.0.0.1:4173/atlas-x-pro/?qa=1&stage=mobile-terminal-2', { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css' });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css' });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.professionalOrderEntry === 'ready');

  const apiResult = await page.evaluate(() => {
    const api = window.AtlasProfessionalOrderEntry;
    const book = { asks: [[100, 1], [101, 2], [102, 3]], bids: [[99, 1], [98, 2], [97, 3]] };
    const estimate = api?.estimate?.({
      side: 'buy', type: 'market', inputMode: 'amount', amount: 250,
      referencePrice: 100, feeRate: 0.0008, book,
    });
    const qty = 1 + 150 / 101;
    const expectedVwap = 250 / qty;
    const matrix = ['market','limit','stop_market','stop_limit'].map(type => ({
      type,
      validation: api?.validate?.({
        side: 'buy', type, inputMode: 'amount', amount: 100,
        price: type === 'limit' ? 99 : undefined,
        triggerPrice: type.startsWith('stop_') ? 105 : undefined,
        limitPrice: type === 'stop_limit' ? 104 : undefined,
        availability: { cash: 50000, quantity: 0 }, connectionState: 'live',
      }),
    }));
    return {
      hasApi: Boolean(api?.setType && api?.setInputMode && api?.estimate && api?.validate && api?.submit && api?.snapshot),
      estimate,
      expectedVwap,
      matrix,
    };
  });

  checks.apiReady = apiResult.hasApi;
  checks.vwapCorrect = Math.abs(Number(apiResult.estimate?.vwap) - apiResult.expectedVwap) < 1e-8
    && Math.abs(Number(apiResult.estimate?.filledQuantity) - (1 + 150 / 101)) < 1e-8;
  checks.feeAndSlippageCorrect = Number(apiResult.estimate?.fee) > 0
    && Number(apiResult.estimate?.slippageBps) > 0
    && apiResult.estimate?.complete === true;
  checks.typeValidationMatrix = apiResult.matrix.every(item => item.validation?.ok === true);

  const storageBefore = await page.evaluate(() => Object.keys(localStorage).sort());
  await openOrder('buy');
  checks.formVisible = await page.locator('.professional-order-entry').isVisible();
  const typeButtons = page.locator('[data-pro-order-type]');
  checks.fourOrderTypesPresent = ['market','limit','stop_market','stop_limit'].every(async type =>
    await typeButtons.filter({ has: page.locator(`[data-pro-order-type="${type}"]`) }).count() >= 0);
  const types = await typeButtons.evaluateAll(elements => elements.map(element => element.dataset.proOrderType));
  checks.fourOrderTypesPresent = ['market','limit','stop_market','stop_limit'].every(type => types.includes(type));

  const fieldStates = {};
  for (const type of ['market','limit','stop_market','stop_limit']) {
    await page.locator(`[data-pro-order-type="${type}"]`).click();
    fieldStates[type] = await page.evaluate(() => ({
      price: !document.querySelector('[data-pro-field="price"]')?.hidden,
      trigger: !document.querySelector('[data-pro-field="triggerPrice"]')?.hidden,
      limit: !document.querySelector('[data-pro-field="limitPrice"]')?.hidden,
    }));
  }
  checks.fieldMatrixCorrect = fieldStates.market.price === false && fieldStates.market.trigger === false
    && fieldStates.limit.price === true && fieldStates.limit.trigger === false
    && fieldStates.stop_market.price === false && fieldStates.stop_market.trigger === true
    && fieldStates.stop_limit.trigger === true && fieldStates.stop_limit.limit === true;

  await page.locator('[data-pro-order-type="market"]').click();
  await page.locator('[data-order-input-mode="amount"]').click();
  await page.locator('#proOrderAmount').fill('250');
  await page.waitForFunction(() => Number(document.querySelector('#proOrderEstimatedVwap')?.dataset.value) > 0);
  const amountEstimate = await page.evaluate(() => ({
    amount: Number(document.querySelector('#proOrderAmount')?.value),
    quantity: Number(document.querySelector('#proOrderQuantity')?.value),
    vwap: Number(document.querySelector('#proOrderEstimatedVwap')?.dataset.value),
    fee: Number(document.querySelector('#proOrderEstimatedFee')?.dataset.value),
    slippage: Number(document.querySelector('#proOrderEstimatedSlippage')?.dataset.value),
  }));
  await page.locator('[data-order-input-mode="quantity"]').click();
  const quantityMode = await page.evaluate(() => ({
    amount: Number(document.querySelector('#proOrderAmount')?.value),
    quantity: Number(document.querySelector('#proOrderQuantity')?.value),
  }));
  checks.inputModePreservesValue = amountEstimate.quantity > 0
    && Math.abs(quantityMode.amount - amountEstimate.amount) < 0.02
    && Math.abs(quantityMode.quantity - amountEstimate.quantity) < 1e-8;
  checks.summaryComplete = amountEstimate.vwap > 0 && amountEstimate.fee > 0 && Number.isFinite(amountEstimate.slippage);

  await page.locator('[data-order-input-mode="amount"]').click();
  await page.locator('#proOrderAmount').fill('100');
  const historyBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}').history?.length || 0);
  await page.locator('#proOrderSubmit').click();
  await page.waitForFunction(previous => (JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}').history?.length || 0) > previous, historyBefore);
  checks.marketSubmitUsesCoreLedger = await page.evaluate(previous => {
    const core = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
    return core.history.length > previous && core.positions.length === 1;
  }, historyBefore);

  if (viewport.mobile && document.body.classList.contains('order-sheet-open')) {
    await page.locator('#orderSheetClose').click();
    await page.waitForFunction(() => !document.body.classList.contains('order-sheet-open'));
    await openOrder('buy');
  }
  await page.locator('[data-pro-order-type="stop_limit"]').click();
  const currentPrice = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
  await page.locator('#proOrderTriggerPrice').fill(String((currentPrice * 1.02).toFixed(2)));
  await page.locator('#proOrderLimitPrice').fill(String((currentPrice * 1.021).toFixed(2)));
  await page.locator('[data-order-input-mode="amount"]').click();
  await page.locator('#proOrderAmount').fill('120');
  const ordersBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}').orders?.length || 0);
  await page.locator('#proOrderSubmit').click();
  await page.waitForFunction(previous => (JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}').orders?.length || 0) > previous, ordersBefore);
  checks.stopLimitUsesCoreOrderArray = await page.evaluate(previous => {
    const core = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
    const order = core.orders.at(-1);
    return core.orders.length > previous && order?.triggerPrice > 0 && order?.limitPrice > 0;
  }, ordersBefore);

  const storageAfter = await page.evaluate(() => Object.keys(localStorage).sort());
  const allowedNew = new Set(['atlasX.pro.mobileTerminal.v1']);
  checks.noDuplicateFinancialLedger = storageAfter.filter(key => !storageBefore.includes(key)).every(key => allowedNew.has(key));

  metrics.submitHeight = await page.locator('#proOrderSubmit').evaluate(element => element.getBoundingClientRect().height);
  checks.mobileSubmitTouchSafe = viewport.mobile ? metrics.submitHeight >= 44 : true;
  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
  await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-professional-order-entry.png`, fullPage: false });
} catch (error) {
  fatalError = String(error);
  try { await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-professional-order-entry-fatal.png`, fullPage: false }); } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/professional-order-entry-report.json', JSON.stringify({
  viewport: { name, ...viewport }, checks, metrics, consoleErrors, pageErrors, fatalError, passed, generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});
if (!passed) {
  console.error(`Professional order entry failed for ${name}`);
  process.exit(1);
}
console.log(`Professional order entry passed for ${name}`);
