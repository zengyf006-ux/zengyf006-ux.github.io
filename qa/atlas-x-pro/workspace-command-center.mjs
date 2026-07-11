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
  orderType: 'market',
  accountTab: 'positions',
  mobileView: 'chart',
  marketFilter: 'all',
  bookMode: 'all',
  favorites: ['BTCUSDT', 'ETHUSDT'],
  cash: 50000,
  positions: [{ id: 'workspace-position', symbol: 'BTCUSDT', qty: 0.6, entry: 60000, fees: 28.8, createdAt: Date.now() - 600000 }],
  orders: [],
  history: [],
  nextId: 200,
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
  if (sessionStorage.getItem('atlas-workspace-seeded') === '1') return;
  localStorage.clear();
  localStorage.setItem('atlasX.pro.v1', JSON.stringify(state));
  sessionStorage.setItem('atlas-workspace-seeded', '1');
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
const readOco = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.advancedOrders.v1') || '{"orders":[]}'));
const readExits = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.exitStrategies.v1') || '{"strategies":[]}'));

async function waitReady() {
  await page.waitForSelector('.pro-shell', { state: 'visible' });
  await page.waitForFunction(() => document.documentElement.dataset.workspaceCenter === 'ready');
}

async function openCommand() {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.waitForSelector('#workspaceCommandDialog', { state: 'visible' });
}

async function setCommandQuery(query) {
  const input = page.locator('#workspaceCommandInput');
  await input.fill(query);
  await page.waitForTimeout(80);
}

async function clickById(id) {
  await page.evaluate(buttonId => {
    const element = document.getElementById(buttonId);
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }, id);
  await page.waitForTimeout(80);
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await waitReady();

  checks.workspaceReady = await page.evaluate(() => document.documentElement.dataset.workspaceCenter === 'ready');

  await page.evaluate(() => document.querySelector('#quickSearchButton')?.click());
  await page.waitForSelector('#workspaceCommandDialog', { state: 'visible' });
  checks.quickSearchOpensCommand = await page.locator('#workspaceCommandDialog').isVisible();

  await setCommandQuery('ETH');
  const ethResult = page.locator('[data-workspace-market="ETHUSDT"]');
  checks.marketSearchResultVisible = await ethResult.isVisible();
  await ethResult.click();
  await page.waitForFunction(() => document.querySelector('#activePair')?.textContent?.trim() === 'ETH/USDT');
  checks.marketCommandSwitchesPair = (await page.locator('#activePair').innerText()).trim() === 'ETH/USDT';

  await openCommand();
  await setCommandQuery('风险复核');
  const riskCommand = page.locator('[data-workspace-command="mode-risk"]');
  checks.actionSearchResultVisible = await riskCommand.isVisible();
  await riskCommand.click();
  await page.waitForFunction(() => document.documentElement.dataset.workspaceMode === 'risk');
  checks.riskModeApplied = await page.evaluate(() => document.documentElement.dataset.workspaceMode === 'risk');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady();
  checks.modePersistsAfterReload = await page.evaluate(() => document.documentElement.dataset.workspaceMode === 'risk');

  await page.evaluate(() => document.querySelector('[data-symbol="BTCUSDT"]')?.click());
  await page.waitForFunction(() => document.querySelector('#activePair')?.textContent?.trim() === 'BTC/USDT');

  await page.evaluate(() => document.querySelector('#layoutButton')?.click());
  await page.waitForSelector('#workspacePanel', { state: 'visible' });
  checks.layoutButtonOpensPanel = await page.locator('#workspacePanel').isVisible();

  const beforePreset = await readCore();
  await page.locator('[data-workspace-preset="balanced"]').click();
  await page.waitForTimeout(100);
  const afterPreset = await readCore();
  checks.balancedPresetApplies = await page.evaluate(() => {
    const orderType = document.querySelector('[data-order-type].active')?.dataset.orderType;
    const postOnly = document.querySelector('#postOnly')?.checked;
    const risk = Number(document.querySelector('#riskPercent')?.value);
    return orderType === 'limit' && postOnly === false && Math.abs(risk - 1) < 0.0001;
  });
  checks.presetDoesNotSubmit = (afterPreset.orders?.length || 0) === (beforePreset.orders?.length || 0)
    && (afterPreset.history?.length || 0) === (beforePreset.history?.length || 0);

  await page.evaluate(() => document.querySelector('[data-side="buy"]')?.click());
  const sideBeforeInputShortcut = await page.locator('.side-selector [data-side].active').getAttribute('data-side');
  await page.locator('#orderQuantity').focus();
  await page.keyboard.press('s');
  const sideAfterInputShortcut = await page.locator('.side-selector [data-side].active').getAttribute('data-side');
  checks.inputShortcutIsolation = sideBeforeInputShortcut === sideAfterInputShortcut;

  await page.locator('#orderQuantity').blur();
  await page.locator('body').press('s');
  await page.waitForTimeout(80);
  checks.sellShortcutWorks = await page.locator('.side-selector [data-side="sell"]').evaluate(element => element.classList.contains('active'));
  await page.locator('body').press('m');
  checks.marketShortcutWorks = await page.locator('[data-order-type="market"]').evaluate(element => element.classList.contains('active'));
  await page.locator('body').press('Alt+h');
  checks.timeframeShortcutWorks = await page.locator('[data-timeframe="1h"]').evaluate(element => element.classList.contains('active'));

  await page.evaluate(() => document.querySelector('#layoutButton')?.click());
  if (!await page.locator('#workspacePanel').isVisible()) await page.evaluate(() => document.querySelector('#layoutButton')?.click());
  await page.locator('#workspaceLockButton').click();
  await page.waitForFunction(() => document.documentElement.dataset.tradingLocked === 'true');
  checks.lockActivates = await page.evaluate(() => document.documentElement.dataset.tradingLocked === 'true');

  const lockedCoreBefore = await readCore();
  const lockedOcoBefore = await readOco();
  const lockedExitBefore = await readExits();

  await page.locator('#orderTotal').fill('1000');
  await clickById('submitOrder');
  checks.normalOrderBlocked = await page.evaluate(() => document.documentElement.dataset.lastBlockedTrade === 'submitOrder');

  await clickById('createOcoOrder');
  checks.ocoBlocked = await page.evaluate(() => document.documentElement.dataset.lastBlockedTrade === 'createOcoOrder');

  await clickById('createTrailingStop');
  checks.trailingBlocked = await page.evaluate(() => document.documentElement.dataset.lastBlockedTrade === 'createTrailingStop');

  await clickById('createScaledExit');
  checks.scaledBlocked = await page.evaluate(() => document.documentElement.dataset.lastBlockedTrade === 'createScaledExit');

  const lockedCoreAfter = await readCore();
  const lockedOcoAfter = await readOco();
  const lockedExitAfter = await readExits();
  checks.lockLeavesLedgersUntouched = (lockedCoreAfter.orders?.length || 0) === (lockedCoreBefore.orders?.length || 0)
    && (lockedCoreAfter.history?.length || 0) === (lockedCoreBefore.history?.length || 0)
    && (lockedOcoAfter.orders?.length || 0) === (lockedOcoBefore.orders?.length || 0)
    && (lockedExitAfter.strategies?.length || 0) === (lockedExitBefore.strategies?.length || 0);
  checks.lockStatusExplainsBlock = (await page.locator('#workspaceLockStatus').innerText()).includes('已阻止');

  await page.locator('#workspaceLockButton').click();
  checks.singleUnlockClickDoesNotUnlock = await page.evaluate(() => document.documentElement.dataset.tradingLocked === 'true'
    && document.documentElement.dataset.unlockPending === 'true');
  await page.locator('#workspaceLockButton').click();
  await page.waitForFunction(() => document.documentElement.dataset.tradingLocked === 'false');
  checks.doubleUnlockConfirms = await page.evaluate(() => document.documentElement.dataset.tradingLocked === 'false');

  await page.evaluate(() => document.querySelector('#layoutButton')?.click());
  if (!await page.locator('#workspacePanel').isVisible()) await page.evaluate(() => document.querySelector('#layoutButton')?.click());
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.mobileTouchTargets = viewport.mobile
    ? await page.locator('[data-workspace-mode-option="standard"]').evaluate(element => element.getBoundingClientRect().height >= 38)
      && await page.locator('[data-workspace-preset="balanced"]').evaluate(element => element.getBoundingClientRect().height >= 38)
      && await page.locator('#workspaceLockButton').evaluate(element => element.getBoundingClientRect().height >= 38)
    : true;

  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-workspace-command-center.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-workspace-command-center-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/workspace-command-center-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro workspace command center failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro workspace command center passed for ${name}`);
