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
  activeSymbol: 'BTCUSDT',
  timeframe: '1h',
  indicator: 'ema',
  side: 'buy',
  orderType: 'limit',
  accountTab: 'positions',
  mobileView: 'chart',
  marketFilter: 'all',
  bookMode: 'all',
  favorites: ['BTCUSDT'],
  cash: 100000,
  positions: [],
  orders: [],
  history: [],
  nextId: 10,
};

const entry = 64000;
const stop = 62000;
const targetPrice = 68000;
const riskPercent = 1;
const feeRate = 0.0008;
const equity = 100000;
const riskBudget = equity * riskPercent / 100;
const unitRisk = Math.abs(entry - stop) + entry * feeRate + stop * feeRate;
const rawQuantity = riskBudget / unitRisk;
const cashCapQuantity = equity / (entry * (1 + feeRate));
const expectedQuantity = Math.min(rawQuantity, cashCapQuantity);
const expectedMaxLoss = expectedQuantity * unitRisk;
const expectedReward = expectedQuantity * (targetPrice - entry)
  - expectedQuantity * (entry + targetPrice) * feeRate;
const expectedRiskReward = expectedReward / expectedMaxLoss;

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
page.setDefaultTimeout(9000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

const closeEnough = (actual, expected, tolerance) => Number.isFinite(actual)
  && Math.abs(actual - expected) <= tolerance;

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForSelector('.pro-shell', { state: 'visible', timeout: 12000 });
  await page.waitForFunction(() => document.documentElement.dataset.riskSizing === 'ready', null, { timeout: 12000 });

  if (viewport.mobile) {
    await page.locator('[data-mobile-side="buy"]').click();
    await page.waitForSelector('#orderTicket', { state: 'visible' });
  }

  await page.waitForSelector('.risk-sizing-panel', { state: 'visible', timeout: 7000 });
  checks.panelVisible = await page.locator('.risk-sizing-panel').isVisible();
  await page.locator('.risk-sizing-toggle').click();
  await page.waitForSelector('.risk-sizing-body', { state: 'visible' });

  await page.locator('[data-order-type="limit"]').click();
  await page.locator('#orderPrice').fill(String(entry));
  await page.locator('#orderPrice').dispatchEvent('input');
  await page.locator('#riskStopPrice').fill(String(stop));
  await page.locator('#riskTargetPrice').fill(String(targetPrice));
  await page.locator('#riskPercent').fill(String(riskPercent));
  await page.locator('#riskPercent').dispatchEvent('input');
  await page.waitForFunction(() => document.querySelector('.risk-sizing-panel')?.dataset.valid === 'true');

  const metrics = await page.locator('.risk-sizing-panel').evaluate(element => ({
    riskBudget: Number(element.dataset.riskBudget),
    quantity: Number(element.dataset.suggestedQuantity),
    maxLoss: Number(element.dataset.maxLoss),
    riskReward: Number(element.dataset.riskReward),
    valid: element.dataset.valid,
  }));
  checks.validCalculation = metrics.valid === 'true';
  checks.riskBudgetCorrect = closeEnough(metrics.riskBudget, riskBudget, 0.02);
  checks.quantityCorrect = closeEnough(metrics.quantity, expectedQuantity, 0.000002);
  checks.maxLossCorrect = closeEnough(metrics.maxLoss, expectedMaxLoss, 0.02);
  checks.riskRewardCorrect = closeEnough(metrics.riskReward, expectedRiskReward, 0.01);

  const applyButton = page.locator('[data-risk-sizing-apply]');
  checks.applyEnabled = await applyButton.isEnabled();
  await applyButton.click();
  const applied = await page.evaluate(() => ({
    quantity: Number(document.querySelector('#orderQuantity')?.value || 0),
    total: Number(document.querySelector('#orderTotal')?.value || 0),
    fee: Number((document.querySelector('#estimatedFee')?.textContent || '').replace(/[^0-9.-]/g, '')),
  }));
  checks.quantityApplied = closeEnough(applied.quantity, expectedQuantity, 0.000002);
  checks.totalSynchronized = closeEnough(applied.total, expectedQuantity * entry, 0.05);
  checks.feeSynchronized = closeEnough(applied.fee, applied.total * feeRate, 0.02);

  await page.locator('#riskStopPrice').fill('66000');
  await page.locator('#riskStopPrice').dispatchEvent('input');
  await page.waitForFunction(() => document.querySelector('.risk-sizing-panel')?.dataset.valid === 'false');
  checks.invalidStopBlocked = !(await applyButton.isEnabled());
  checks.invalidStopExplained = (await page.locator('#riskSizingStatus').innerText()).includes('低于入场价');

  await page.locator('#riskStopPrice').fill(String(stop));
  await page.locator('#riskStopPrice').dispatchEvent('input');
  await page.waitForFunction(() => document.querySelector('.risk-sizing-panel')?.dataset.valid === 'true');
  await page.evaluate(() => document.querySelector('#marketList [data-symbol="ETHUSDT"]')?.click());
  await page.waitForFunction(() => document.querySelector('#activePair')?.textContent?.includes('ETH/USDT'));
  await page.waitForFunction(expectedStop => {
    const panel = document.querySelector('.risk-sizing-panel');
    const stopInput = document.querySelector('#riskStopPrice');
    return panel?.dataset.symbol === 'ETHUSDT' && stopInput?.value !== expectedStop;
  }, String(stop));
  checks.planIsolatedBySymbol = await page.evaluate(expectedStop => {
    const panel = document.querySelector('.risk-sizing-panel');
    const stopInput = document.querySelector('#riskStopPrice');
    return panel?.dataset.symbol === 'ETHUSDT' && stopInput?.value !== expectedStop;
  }, String(stop));

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  if (viewport.mobile) {
    checks.submitStillReachable = await page.locator('#submitOrder').evaluate(element => {
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      return rect.width > 100 && rect.height >= 38;
    });
  } else {
    checks.submitStillReachable = true;
  }
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-risk-position-sizing.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-risk-position-sizing-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/risk-position-sizing-report.json', JSON.stringify({
  target,
  viewport,
  expected: {
    riskBudget,
    expectedQuantity,
    expectedMaxLoss,
    expectedRiskReward,
  },
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
  console.error(`ATLAS X Pro risk position sizing failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro risk position sizing passed for ${name}`);
