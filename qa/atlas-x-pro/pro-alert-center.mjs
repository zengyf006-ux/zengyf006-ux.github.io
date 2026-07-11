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
  positions: [{ id: 'alert-position', symbol: 'BTCUSDT', qty: 0.5, entry: 60000, fees: 24, createdAt: now - 600000 }],
  orders: [],
  history: [],
  nextId: 500,
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
  localStorage.setItem('atlasX.pro.advancedOrders.v1', JSON.stringify({ version: 1, orders: [] }));
  localStorage.setItem('atlasX.pro.exitStrategies.v1', JSON.stringify({ version: 1, strategies: [] }));
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

const readAlerts = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{}'));
const alertEntrySelector = viewport.mobile ? '.mobile-alert-button' : '.notification-button';
const alertBadgeSelector = viewport.mobile ? '.mobile-alert-button .alert-center-badge' : '.notification-button .alert-center-badge';

async function openAlertCenter() {
  if (viewport.mobile) {
    await page.waitForFunction(() => document.documentElement.dataset.mobileAlertEntry === 'ready');
  }
  await page.locator(alertEntrySelector).click();
  await page.waitForSelector('#controlPopover', { state: 'visible' });
  await page.waitForSelector('.alert-center-shell', { state: 'visible' });
}

async function evaluateAt(price) {
  await page.evaluate(value => {
    const lastPrice = document.querySelector('#lastPrice');
    if (lastPrice) lastPrice.textContent = Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    window.AtlasAlertCenter?.evaluateNow?.({ symbol: 'BTCUSDT', price: value });
  }, price);
  await page.waitForTimeout(90);
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForSelector('.pro-shell', { state: 'visible' });
  await page.waitForFunction(() => document.documentElement.dataset.alertCenter === 'ready');

  checks.alertCenterReady = await page.evaluate(() => document.documentElement.dataset.alertCenter === 'ready');
  checks.mobileEntryVisible = viewport.mobile ? await page.locator('.mobile-alert-button').isVisible() : true;
  await openAlertCenter();
  checks.reusesControlPopover = await page.locator('#controlPopover').isVisible();
  checks.professionalTitleVisible = (await page.locator('#popoverTitle').innerText()).includes('专业预警中心');
  checks.oldStaticNotificationsReplaced = !(await page.locator('#popoverBody').innerText()).includes('模拟交易环境运行正常');

  await page.locator('[data-alert-tab="rules"]').click();
  const current = Number((await page.locator('#lastPrice').innerText()).replace(/,/g, ''));
  const threshold = Number((current * 1.01).toFixed(2));
  await page.locator('#alertRuleDirection').selectOption('price_above');
  await page.locator('#alertRuleThreshold').fill(String(threshold));
  await page.locator('#alertRuleCreate').click();
  await page.waitForFunction(expectedThreshold => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"rules":[]}');
    return store.rules?.some(rule => rule.symbol === 'BTCUSDT'
      && rule.type === 'price_above'
      && Math.abs(Number(rule.threshold) - expectedThreshold) < 0.02);
  }, threshold);
  const afterCreate = await readAlerts();
  const rule = afterCreate.rules.find(item => item.symbol === 'BTCUSDT'
    && item.type === 'price_above'
    && Math.abs(Number(item.threshold) - threshold) < 0.02);
  checks.priceRulePersisted = Boolean(rule?.id) && rule?.enabled === true;
  checks.ruleCardVisible = await page.locator(`[data-alert-rule-id="${rule.id}"]`).isVisible();

  await evaluateAt(threshold - Math.max(10, threshold * 0.002));
  await evaluateAt(threshold + Math.max(2, threshold * 0.0002));
  await page.waitForFunction(id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"events":[]}');
    return store.events?.some(event => event.kind === 'price' && event.ruleId === id && event.read === false);
  }, rule.id);
  const afterTrigger = await readAlerts();
  checks.crossingCreatesUnread = afterTrigger.events.filter(event => event.kind === 'price' && event.ruleId === rule.id).length === 1;
  checks.unreadBadgeShowsOne = await page.locator(alertBadgeSelector).isVisible()
    && (await page.locator(alertBadgeSelector).innerText()).trim() === '1';

  await evaluateAt(threshold + Math.max(20, threshold * 0.003));
  const afterStayedAbove = await readAlerts();
  checks.stayingAboveDoesNotDuplicate = afterStayedAbove.events.filter(event => event.kind === 'price' && event.ruleId === rule.id).length === 1;

  await evaluateAt(threshold - Math.max(20, threshold * 0.003));
  await evaluateAt(threshold + Math.max(20, threshold * 0.003));
  const afterCooldownCross = await readAlerts();
  checks.cooldownPreventsDuplicate = afterCooldownCross.events.filter(event => event.kind === 'price' && event.ruleId === rule.id).length === 1;

  await page.locator('#alertCenterMarkAllRead').click();
  await page.waitForFunction(() => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"events":[]}');
    return (store.events || []).every(event => event.read === true);
  });
  checks.markAllReadClearsBadge = await page.locator(alertBadgeSelector).isHidden();

  await page.evaluate(() => {
    const core = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
    core.history = [{
      id: 'alert-fill-1', symbol: 'BTCUSDT', side: 'buy', price: 64000, qty: 0.02,
      fee: 1.024, status: '已成交', createdAt: Date.now(),
    }, ...(core.history || [])];
    localStorage.setItem('atlasX.pro.v1', JSON.stringify(core));
    window.AtlasAlertCenter?.evaluateNow?.();
  });
  await page.waitForFunction(() => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"events":[]}');
    return store.events?.some(event => event.sourceKey === 'core-fill:alert-fill-1');
  });
  await page.evaluate(() => window.AtlasAlertCenter?.evaluateNow?.());
  const afterFill = await readAlerts();
  checks.coreFillCapturedOnce = afterFill.events.filter(event => event.sourceKey === 'core-fill:alert-fill-1').length === 1;

  await page.evaluate(() => {
    localStorage.setItem('atlasX.pro.advancedOrders.v1', JSON.stringify({
      version: 1,
      orders: [{
        id: 'alert-oco-1', symbol: 'BTCUSDT', quantity: 0.03, takeProfit: 68000,
        stopTrigger: 62000, status: 'completed_stop', createdAt: Date.now() - 1000, completedAt: Date.now(),
      }],
    }));
    localStorage.setItem('atlasX.pro.exitStrategies.v1', JSON.stringify({
      version: 1,
      strategies: [{
        id: 'alert-exit-1', kind: 'trailing_stop', symbol: 'BTCUSDT', quantity: 0.04,
        trailPercent: 2, triggerPrice: 62500, status: 'completed', createdAt: Date.now() - 1200, completedAt: Date.now(),
      }],
    }));
    window.AtlasAlertCenter?.evaluateNow?.();
  });
  await page.waitForFunction(() => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"events":[]}');
    return store.events?.some(event => event.sourceKey === 'oco:alert-oco-1:completed_stop')
      && store.events?.some(event => event.sourceKey === 'exit:alert-exit-1:completed');
  });
  const afterStrategies = await readAlerts();
  const ocoEvent = afterStrategies.events.find(event => event.sourceKey === 'oco:alert-oco-1:completed_stop');
  const exitEvent = afterStrategies.events.find(event => event.sourceKey === 'exit:alert-exit-1:completed');
  checks.ocoStopCapturedCritical = ocoEvent?.severity === 'critical';
  checks.trailingCompletionCapturedCritical = exitEvent?.severity === 'critical';

  await page.locator('[data-alert-tab="rules"]').click();
  const ruleCard = page.locator(`[data-alert-rule-id="${rule.id}"]`);
  await ruleCard.locator('[data-alert-rule-toggle]').click();
  await page.waitForFunction(id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"rules":[]}');
    return store.rules?.find(rule => rule.id === id)?.enabled === false;
  }, rule.id);
  checks.ruleCanBeDisabled = (await readAlerts()).rules.find(item => item.id === rule.id)?.enabled === false;

  await ruleCard.locator('[data-alert-rule-toggle]').click();
  await page.waitForFunction(id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"rules":[]}');
    return store.rules?.find(rule => rule.id === id)?.enabled === true;
  }, rule.id);
  checks.ruleCanBeReenabled = (await readAlerts()).rules.find(item => item.id === rule.id)?.enabled === true;

  await ruleCard.locator('[data-alert-rule-delete]').click();
  await page.waitForFunction(id => {
    const store = JSON.parse(localStorage.getItem('atlasX.pro.alertCenter.v1') || '{"rules":[]}');
    return !store.rules?.some(rule => rule.id === id);
  }, rule.id);
  checks.ruleCanBeDeleted = !(await readAlerts()).rules.some(item => item.id === rule.id);

  checks.boundedStorage = (await readAlerts()).events.length <= 100 && (await readAlerts()).rules.length <= 30;
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.mobileTouchTargets = viewport.mobile
    ? await page.locator('[data-alert-tab="all"]').evaluate(element => element.getBoundingClientRect().height >= 38)
      && await page.locator('#alertRuleCreate').evaluate(element => element.getBoundingClientRect().height >= 38)
      && await page.locator('#alertCenterMarkAllRead').evaluate(element => element.getBoundingClientRect().height >= 38)
      && await page.locator('.mobile-alert-button').evaluate(element => element.getBoundingClientRect().height >= 27)
    : true;
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-professional-alert-center.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-professional-alert-center-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/pro-alert-center-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro professional alert center failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro professional alert center passed for ${name}`);
