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
  positions: [
    { id: 'chart-pos', symbol: 'BTCUSDT', qty: 0.25, entry: 64400, fees: 12.88, createdAt: now - 200000 },
  ],
  orders: [
    {
      id: 'chart-order', symbol: 'BTCUSDT', side: 'buy', type: 'limit', price: 64600,
      qty: 0.1, total: 6460, filled: 0, estimatedFee: 5.168, createdAt: now - 100000,
      postOnly: false, reduceOnly: false,
    },
  ],
  history: [],
  nextId: 20,
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
  localStorage.setItem('atlasX.pro.riskPlans.v1', JSON.stringify({
    BTCUSDT: { riskPercent: 1, stopPrice: '', targetPrice: '' },
  }));
}, seedState);
const page = await context.newPage();
page.setDefaultTimeout(10000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

async function clickChartAtRatio(ratio, mode) {
  const canvas = page.locator('#chartCanvas');
  const metrics = await canvas.evaluate(element => ({
    top: Number(element.dataset.top),
    height: Number(element.dataset.priceHeight),
  }));
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Chart canvas has no bounding box');
  await page.locator('#chartStage').evaluate(element => {
    delete element.dataset.lastPickMode;
    delete element.dataset.lastPickPrice;
  });
  const localY = metrics.top + metrics.height * ratio;
  await page.mouse.click(box.x + box.width * 0.55, box.y + localY);
  await page.waitForFunction(expectedMode => document.querySelector('#chartStage')?.dataset.lastPickMode === expectedMode, mode);
  return page.locator('#chartStage').evaluate(element => {
    const snapshot = {
      mode: element.dataset.lastPickMode || '',
      price: Number(element.dataset.lastPickPrice),
      ratio: Number(element.dataset.lastPickRatio),
      max: Number(element.dataset.lastPickMax),
      min: Number(element.dataset.lastPickMin),
    };
    snapshot.expectedPrice = snapshot.max - snapshot.ratio * (snapshot.max - snapshot.min);
    snapshot.mathCorrect = Number.isFinite(snapshot.price)
      && Number.isFinite(snapshot.expectedPrice)
      && Math.abs(snapshot.price - snapshot.expectedPrice) < 1e-7;
    return snapshot;
  });
}

async function ensureRiskPlanOpen() {
  if (viewport.mobile && !await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))) {
    await page.locator('[data-mobile-side="buy"]').click();
  }
  await page.waitForSelector('.risk-sizing-panel', { state: 'visible' });
  const toggle = page.locator('.risk-sizing-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.waitForSelector('.risk-sizing-body', { state: 'visible' });
}

async function closeMobileSheet() {
  if (viewport.mobile && await page.locator('body').evaluate(body => body.classList.contains('order-sheet-open'))) {
    await page.locator('#orderSheetClose').click();
    await page.waitForFunction(() => !document.body.classList.contains('order-sheet-open'));
  }
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForSelector('#chartCanvas', { state: 'visible', timeout: 12000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#chartCanvas');
    return Number(canvas?.dataset.max) > Number(canvas?.dataset.min)
      && Number(canvas?.dataset.priceHeight) > 100;
  }, null, { timeout: 12000 });
  await page.waitForFunction(() => document.documentElement.dataset.chartTradingLayer === 'ready', null, { timeout: 12000 });

  const chartMetrics = await page.locator('#chartCanvas').evaluate(element => ({
    max: Number(element.dataset.max),
    min: Number(element.dataset.min),
  }));
  const stopPrice = chartMetrics.min + (chartMetrics.max - chartMetrics.min) * 0.28;
  const targetPrice = chartMetrics.min + (chartMetrics.max - chartMetrics.min) * 0.72;

  await ensureRiskPlanOpen();
  await page.locator('#riskStopPrice').fill(stopPrice.toFixed(2));
  await page.locator('#riskStopPrice').dispatchEvent('input');
  await page.locator('#riskTargetPrice').fill(targetPrice.toFixed(2));
  await page.locator('#riskTargetPrice').dispatchEvent('input');
  await closeMobileSheet();

  await page.waitForFunction(() => document.querySelectorAll('.chart-trade-layer .chart-price-line').length >= 4);
  checks.positionLineVisible = await page.locator('.chart-trade-layer .position-line').count() === 1;
  checks.orderLineVisible = await page.locator('.chart-trade-layer .buy-order-line').count() === 1;
  checks.stopLineVisible = await page.locator('.chart-trade-layer .plan-stop-line').count() === 1;
  checks.targetLineVisible = await page.locator('.chart-trade-layer .plan-target-line').count() === 1;

  const positionCopy = await page.locator('.chart-trade-layer .position-line').innerText();
  const orderCopy = await page.locator('.chart-trade-layer .buy-order-line').innerText();
  checks.positionLabelDetailed = positionCopy.includes('持仓成本') && positionCopy.includes('0.25');
  checks.orderLabelDetailed = orderCopy.includes('买入') && orderCopy.includes('限价') && orderCopy.includes('0.1');

  checks.threePickToolsPresent = await page.locator('[data-chart-tool="order-price"], [data-chart-tool="plan-stop"], [data-chart-tool="plan-target"]').count() === 3;

  await page.locator('[data-chart-tool="order-price"]').click();
  const orderPick = await clickChartAtRatio(0.56, 'order-price');
  if (viewport.mobile) await page.waitForFunction(() => document.body.classList.contains('order-sheet-open'));
  await page.waitForFunction(() => document.querySelector('[data-order-type="limit"]')?.classList.contains('active'));
  const pickedOrderPrice = Number(await page.locator('#orderPrice').inputValue());
  checks.orderPickMathCorrect = orderPick.mathCorrect;
  checks.orderPricePickerWorks = Math.abs(pickedOrderPrice - orderPick.price) < 0.011;
  checks.orderPickerDoesNotSubmit = await page.locator('#historyBody [data-label="状态"]').count() === 0;
  await closeMobileSheet();

  await page.locator('[data-chart-tool="plan-stop"]').click();
  const stopPick = await clickChartAtRatio(0.78, 'plan-stop');
  if (viewport.mobile) await page.waitForFunction(() => document.body.classList.contains('order-sheet-open'));
  await page.waitForSelector('.risk-sizing-body', { state: 'visible' });
  const pickedStop = Number(await page.locator('#riskStopPrice').inputValue());
  checks.stopPickMathCorrect = stopPick.mathCorrect;
  checks.stopPickerWorks = Math.abs(pickedStop - stopPick.price) < 0.011;
  await closeMobileSheet();

  await page.locator('[data-chart-tool="plan-target"]').click();
  const targetPick = await clickChartAtRatio(0.22, 'plan-target');
  if (viewport.mobile) await page.waitForFunction(() => document.body.classList.contains('order-sheet-open'));
  await page.waitForSelector('.risk-sizing-body', { state: 'visible' });
  const pickedTarget = Number(await page.locator('#riskTargetPrice').inputValue());
  checks.targetPickMathCorrect = targetPick.mathCorrect;
  checks.targetPickerWorks = Math.abs(pickedTarget - targetPick.price) < 0.011;
  const storedPlans = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.riskPlans.v1') || '{}'));
  checks.planPickerPersists = Math.abs(Number(storedPlans.BTCUSDT?.stopPrice) - pickedStop) < 0.02
    && Math.abs(Number(storedPlans.BTCUSDT?.targetPrice) - pickedTarget) < 0.02;
  await closeMobileSheet();

  await page.evaluate(() => document.querySelector('#marketList [data-symbol="ETHUSDT"]')?.click());
  await page.waitForFunction(() => document.querySelector('#activePair')?.textContent?.includes('ETH/USDT'));
  await page.waitForFunction(() => document.querySelector('.chart-trade-layer')?.dataset.chartSymbol === 'ETHUSDT');
  checks.symbolIsolation = await page.locator('.chart-trade-layer .position-line, .chart-trade-layer .buy-order-line, .chart-trade-layer .sell-order-line, .chart-trade-layer .plan-stop-line, .chart-trade-layer .plan-target-line').count() === 0;

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-chart-trading-layer.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-chart-trading-layer-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/chart-trading-layer-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro chart trading layer failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro chart trading layer passed for ${name}`);
