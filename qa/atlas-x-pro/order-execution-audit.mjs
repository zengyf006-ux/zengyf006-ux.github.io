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
const seedCore = {
  activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'limit',
  accountTab: 'history', mobileView: 'account', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 48700,
  positions: [{ id: 'audit-position', symbol: 'BTCUSDT', qty: 0.48, entry: 60000, fees: 24, createdAt: now - 900000 }],
  orders: [{
    id: 'audit-order-active', symbol: 'BTCUSDT', side: 'buy', type: 'limit', price: 63000,
    referencePrice: 64000, qty: 0.01, total: 630, filled: 0, estimatedFee: 0.504,
    createdAt: now - 180000, postOnly: true, reduceOnly: false,
  }],
  history: [
    {
      id: 'audit-fill-buy', orderId: 'audit-market-buy', symbol: 'BTCUSDT', side: 'buy', orderType: 'market',
      referencePrice: 64000, price: 64200, qty: 0.02, fee: 1.0272, status: '已成交',
      submittedAt: now - 125000, createdAt: now - 120000, executionReason: 'market_execution',
    },
    {
      id: 'audit-fill-no-reference', symbol: 'BTCUSDT', side: 'sell', price: 65000, qty: 0.01,
      fee: 0.52, status: '已成交', createdAt: now - 60000,
    },
  ],
  nextId: 700,
};
const seedOco = {
  version: 1,
  orders: [{
    id: 'audit-oco', symbol: 'BTCUSDT', quantity: 0.03, takeProfit: 68000, stopTrigger: 62000,
    tpOrderId: 'audit-oco-tp', status: 'completed_stop', createdAt: now - 500000, completedAt: now - 450000,
  }],
};
const seedExits = {
  version: 1,
  strategies: [{
    id: 'audit-exit', kind: 'trailing_stop', symbol: 'BTCUSDT', quantity: 0.04,
    trailPercent: 2, triggerPrice: 62500, status: 'completed', createdAt: now - 400000, completedAt: now - 350000,
  }],
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
await context.addInitScript(({ core, oco, exits }) => {
  localStorage.clear();
  localStorage.setItem('atlasX.pro.v1', JSON.stringify(core));
  localStorage.setItem('atlasX.pro.advancedOrders.v1', JSON.stringify(oco));
  localStorage.setItem('atlasX.pro.exitStrategies.v1', JSON.stringify(exits));
}, { core: seedCore, oco: seedOco, exits: seedExits });

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
const getRecords = () => page.evaluate(() => window.AtlasExecutionAudit?.getRecords?.() || []);

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForSelector('.pro-shell', { state: 'visible' });
  await page.waitForFunction(() => document.documentElement.dataset.executionAudit === 'ready');

  checks.auditReady = await page.evaluate(() => document.documentElement.dataset.executionAudit === 'ready');
  checks.auditTabMounted = await page.locator('[data-account-tab="audit"]').isVisible();
  checks.auditViewMounted = await page.locator('[data-account-view="audit"]').count() === 1;

  const records = await getRecords();
  const types = new Set(records.map(record => record.sourceType));
  checks.allSourcesProjected = ['core_order', 'core_fill', 'oco', 'exit_strategy'].every(type => types.has(type));
  checks.recordIdsStable = records.every(record => typeof record.id === 'string' && record.id.length > 4);

  const buyFill = records.find(record => record.sourceId === 'audit-fill-buy');
  checks.buySlippageCorrect = Math.abs(Number(buyFill?.slippageBps) - 31.25) < 0.001;
  checks.feeBreakdownCorrect = Math.abs(Number(buyFill?.fee) - 1.0272) < 0.000001
    && Math.abs(Number(buyFill?.slippageCost) - 4.0125) < 0.001
    && Math.abs(Number(buyFill?.totalExecutionCost) - 5.0397) < 0.001;
  checks.fillTimelineComplete = Array.isArray(buyFill?.timeline)
    && buyFill.timeline.some(item => item.code === 'submitted')
    && buyFill.timeline.some(item => item.code === 'filled');

  const noReference = records.find(record => record.sourceId === 'audit-fill-no-reference');
  checks.missingReferenceNotInvented = noReference?.slippageBps === null && noReference?.slippageCost === null;
  checks.strategyTimelineProjected = records.find(record => record.sourceId === 'audit-oco')?.timeline?.some(item => item.code === 'completed_stop')
    && records.find(record => record.sourceId === 'audit-exit')?.timeline?.some(item => item.code === 'completed');

  if (viewport.mobile) {
    await page.locator('[data-mobile-view="account"]').click();
  }
  await page.locator('[data-account-tab="audit"]').click();
  await page.waitForFunction(() => document.querySelector('[data-account-view="audit"]')?.classList.contains('active'));
  checks.auditTabOpens = await page.locator('[data-account-view="audit"]').isVisible();
  checks.summaryVisible = await page.locator('.execution-audit-summary').isVisible();
  checks.filtersVisible = await page.locator('[data-audit-filter="all"]').isVisible()
    && await page.locator('[data-audit-filter="strategy"]').isVisible();
  checks.recordRowsVisible = await page.locator('[data-audit-record-id]').count() >= 4;

  await page.locator('[data-audit-filter="strategy"]').click();
  checks.strategyFilterWorks = await page.locator('[data-audit-record-id]').count() === 2;
  await page.locator('[data-audit-filter="all"]').click();

  await page.locator('[data-account-tab="history"]').click();
  const historyAuditButton = page.locator('#historyBody [data-open-audit]').first();
  await page.waitForFunction(() => document.querySelectorAll('#historyBody [data-open-audit]').length >= 1);
  checks.historyEntryInjected = await historyAuditButton.isVisible();
  await historyAuditButton.click();
  await page.waitForSelector('.execution-audit-detail[data-open="true"]', { state: 'visible' });
  checks.historyEntryOpensMatchingDetail = (await page.locator('.execution-audit-detail').getAttribute('data-record-id')) === 'core-fill:audit-fill-buy';
  checks.detailShowsCosts = (await page.locator('.execution-audit-detail').innerText()).includes('滑点成本')
    && (await page.locator('.execution-audit-detail').innerText()).includes('手续费');

  await page.locator('[data-audit-detail-close]').click();
  await page.locator('[data-account-tab="orders"]').click();
  const beforeCancel = await readCore();
  await page.locator('#ordersBody [data-cancel-order="audit-order-active"]').click();
  await page.waitForFunction(() => {
    const core = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
    return !(core.orders || []).some(order => order.id === 'audit-order-active');
  });
  await page.waitForFunction(() => window.AtlasExecutionAudit?.getRecords?.().some(record => record.sourceType === 'canceled_order' && record.sourceId === 'audit-order-active'));
  const afterCancel = await readCore();
  checks.canceledOrderArchived = (await getRecords()).some(record => record.sourceType === 'canceled_order' && record.sourceId === 'audit-order-active');
  checks.auditDoesNotMutateFinancialLedgers = afterCancel.cash === beforeCancel.cash
    && JSON.stringify(afterCancel.positions) === JSON.stringify(beforeCancel.positions)
    && JSON.stringify(afterCancel.history) === JSON.stringify(beforeCancel.history);

  await page.locator('[data-account-tab="audit"]').click();
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.mobileTouchTargets = viewport.mobile
    ? await page.locator('[data-account-tab="audit"]').evaluate(element => element.getBoundingClientRect().height >= 38)
      && await page.locator('[data-audit-filter="all"]').evaluate(element => element.getBoundingClientRect().height >= 38)
      && await page.locator('[data-audit-record-id]').first().evaluate(element => element.getBoundingClientRect().height >= 52)
    : true;
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-order-execution-audit.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-order-execution-audit-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/order-execution-audit-report.json', JSON.stringify({
  target, viewport, checks, consoleErrors, pageErrors, fatalError, passed, generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro order execution audit failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro order execution audit passed for ${name}`);
