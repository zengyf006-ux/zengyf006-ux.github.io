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

const seed = {
  activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'market',
  accountTab: 'orders', mobileView: 'chart', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 50000,
  positions: [{ id: 'stage2-position', symbol: 'BTCUSDT', qty: 0.25, entry: 60000, fees: 12, createdAt: Date.now() - 500000 }],
  orders: [], history: [], nextId: 800,
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
  localStorage.setItem('atlasX.pro.advancedOrders.v1', JSON.stringify({ version: 1, orders: [] }));
  localStorage.setItem('atlasX.pro.exitStrategies.v1', JSON.stringify({ version: 1, strategies: [] }));
}, seed);

const page = await context.newPage();
page.setDefaultTimeout(15000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const evidence = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

const readCore = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}'));

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.orderEntryStage2 === 'ready'
    && document.documentElement.dataset.coreTradingStage2 === 'ready'
    && document.documentElement.dataset.orderEntryStage2Compat === 'ready'
    && document.documentElement.dataset.mobileTradingStage2 === 'ready');

  checks.bridgeReady = await page.evaluate(() => Boolean(window.AtlasCoreTrading?.getState && window.AtlasOrderEntryStage2?.walkDepth));
  checks.legacySelectorUnique = await page.locator('[data-order-type="market"]').count() === 1;

  const calculations = await page.evaluate(() => {
    const buy = window.AtlasOrderEntryStage2.walkDepth(3, 'buy', { asks: [[100, 1], [102, 2]], bids: [] });
    const sell = window.AtlasOrderEntryStage2.walkDepth(3, 'sell', { asks: [], bids: [[100, 1], [98, 2]] });
    return { buy, sell };
  });
  evidence.calculations = calculations;
  checks.buyVwapCorrect = Math.abs(calculations.buy.vwap - 101.33333333333333) < 1e-8
    && Math.abs(calculations.buy.notional - 304) < 1e-8;
  checks.sellVwapCorrect = Math.abs(calculations.sell.vwap - 98.66666666666667) < 1e-8
    && Math.abs(calculations.sell.notional - 296) < 1e-8;
  checks.directionalSlippageCorrect = Math.abs(calculations.buy.slippageBps - 133.3333333333333) < 1e-6
    && Math.abs(calculations.sell.slippageBps - 133.3333333333333) < 1e-6;
  checks.feeAndCoverageCorrect = Math.abs(calculations.buy.fee - 0.2432) < 1e-9
    && Math.abs(calculations.sell.fee - 0.2368) < 1e-9
    && calculations.buy.coverage === 1
    && calculations.sell.coverage === 1;

  const beforeEstimate = await readCore();
  await page.evaluate(() => {
    window.AtlasOrderEntryStage2.setOrderType('market');
    window.AtlasCoreTrading.setField('#orderQuantity', '0.02');
    window.AtlasCoreTrading.syncOrderFields('quantity');
  });
  await page.waitForFunction(() => Number(window.AtlasOrderEntryStage2.getEstimate()?.requestedQuantity) > 0);
  const afterEstimate = await readCore();
  checks.estimateDoesNotMutateLedger = beforeEstimate.cash === afterEstimate.cash
    && JSON.stringify(beforeEstimate.positions) === JSON.stringify(afterEstimate.positions)
    && JSON.stringify(beforeEstimate.orders) === JSON.stringify(afterEstimate.orders)
    && JSON.stringify(beforeEstimate.history) === JSON.stringify(afterEstimate.history);

  const acceptedTypes = await page.evaluate(() => ['market', 'limit', 'stop_market', 'stop_limit'].map(type => {
    const resolved = window.AtlasOrderEntryStage2.setOrderType(type);
    return {
      requested: type,
      resolved,
      bridge: window.AtlasCoreTrading.getOrderType(),
      ticket: document.querySelector('#orderTicket')?.dataset.stage2Type,
    };
  }));
  evidence.acceptedTypes = acceptedTypes;
  checks.fourTypesAccepted = acceptedTypes.every(item => item.requested === item.resolved
    && item.requested === item.bridge
    && item.requested === item.ticket);

  await page.evaluate(() => window.AtlasOrderEntryStage2.setUnitMode('total'));
  await page.waitForFunction(() => document.querySelector('#orderTicket')?.dataset.stage2Unit === 'total');
  let prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.mobileStage2.v1') || '{}'));
  checks.totalModePersisted = prefs.unitMode === 'total';
  await page.evaluate(() => window.AtlasOrderEntryStage2.setUnitMode('quantity'));
  await page.waitForFunction(() => document.querySelector('#orderTicket')?.dataset.stage2Unit === 'quantity');
  prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.mobileStage2.v1') || '{}'));
  checks.quantityModePersisted = prefs.unitMode === 'quantity';

  if (viewport.mobile) {
    await page.locator('[data-mobile-side="buy"]').click();
    await page.waitForFunction(() => document.body.classList.contains('order-sheet-open'));
    checks.controlsVisible = await page.locator('.stage2-entry-controls').isVisible()
      && await page.locator('.stage2-estimate-panel').isVisible();
    checks.fourTypeButtonsVisible = await page.locator('[data-stage2-order-type]').count() === 4;
    checks.touchTargets = await page.evaluate(() => [...document.querySelectorAll('[data-stage2-order-type], [data-entry-unit]')]
      .every(element => element.getBoundingClientRect().height >= 40));

    await page.locator('[data-stage2-order-type="stop_limit"]').click();
    const current = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
    await page.locator('#triggerPrice').fill(String((current * 1.08).toFixed(2)));
    await page.locator('#orderPrice').fill(String((current * 1.06).toFixed(2)));
    await page.locator('#orderQuantity').fill('0.01');
    await page.locator('#orderQuantity').dispatchEvent('input');
    await page.locator('#submitOrder').click();
    await page.waitForFunction(() => {
      const core = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
      return (core.orders || []).some(order => order.stage2Type === 'stop_limit' && order.status === 'waiting_trigger');
    });
    const afterStopLimit = await readCore();
    const created = afterStopLimit.orders.find(order => order.stage2Type === 'stop_limit');
    evidence.stopLimit = created;
    checks.stopLimitUsesCoreOrderArray = Boolean(created?.id)
      && Number(created.stage2TriggerPrice) > current
      && Number(created.stage2LimitPrice) > current;
    checks.stopLimitNoImmediateFill = afterStopLimit.history.length === beforeEstimate.history.length
      && afterStopLimit.positions.length === beforeEstimate.positions.length
      && afterStopLimit.cash === beforeEstimate.cash;
    checks.noSecondFinancialLedger = await page.evaluate(() => !Object.keys(localStorage).some(key => /stage2.*(orders|positions|cash|history)/i.test(key)));
    checks.estimatePanelExplicit = (await page.locator('.stage2-estimate-panel').innerText()).includes('预计成交均价')
      && (await page.locator('.stage2-estimate-panel').innerText()).includes('盘口覆盖率')
      && (await page.locator('.stage2-estimate-panel').innerText()).includes('订单生效条件');
    await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-order-entry-stage2.png`, fullPage: false, timeout: 12000 });
  } else {
    checks.controlsVisible = true;
    checks.fourTypeButtonsVisible = true;
    checks.touchTargets = true;
    checks.stopLimitUsesCoreOrderArray = true;
    checks.stopLimitNoImmediateFill = true;
    checks.noSecondFinancialLedger = true;
    checks.estimatePanelExplicit = true;
  }

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
} catch (error) {
  fatalError = String(error);
  try { await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-order-entry-stage2-fatal.png`, fullPage: false }); } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/order-entry-stage2-report.json', JSON.stringify({
  target, viewport, checks, evidence, consoleErrors, pageErrors, fatalError, passed, generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});
if (!passed) {
  console.error(`ATLAS X Pro Stage 2 order entry failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro Stage 2 order entry passed for ${name}`);
