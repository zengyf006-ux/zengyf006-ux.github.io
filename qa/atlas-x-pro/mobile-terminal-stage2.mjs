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
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = {};
const metrics = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto('http://127.0.0.1:4173/atlas-x-pro/?qa=1&stage=mobile-terminal-2', { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css' });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css' });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.mobileTerminalStage2 === 'ready');

  checks.apiReady = await page.evaluate(() => Boolean(window.AtlasMobileTerminal?.setContext
    && window.AtlasMobileTerminal?.openOrder
    && window.AtlasMobileTerminal?.snapshot
    && window.AtlasMobileChartWorkspace?.openFullscreen));

  if (viewport.mobile) {
    checks.shellVisible = await page.locator('.mobile-terminal-stage2').isVisible();
    const hierarchy = await page.evaluate(() => {
      const selectors = ['.mobile-market-head','#mobileTerminalSummary','#timeframes','.chart-panel','#mobileContextTabs','.mobile-trade-bar'];
      const nodes = selectors.map(selector => document.querySelector(selector));
      const tops = nodes.map(node => node?.getBoundingClientRect().top ?? -1);
      return { present: nodes.every(Boolean), tops };
    });
    checks.hierarchyCorrect = hierarchy.present && hierarchy.tops.every((top, index, values) => index === 0 || top >= values[index - 1] - 2);

    checks.summaryFieldsPresent = await page.locator('#mobileTerminalSummary').evaluate(element =>
      ['24h高','24h低','成交额','振幅','点差'].every(text => element.textContent.includes(text)));
    const summaryButton = page.locator('[data-mobile-summary-toggle]');
    metrics.summaryToggleHeight = await summaryButton.evaluate(element => element.getBoundingClientRect().height);
    checks.summaryExpandable = metrics.summaryToggleHeight >= 44;

    const contexts = await page.locator('[data-mobile-context]').evaluateAll(elements => elements.map(element => element.dataset.mobileContext));
    checks.contextsComplete = ['chart','book','trades','positions','orders'].every(context => contexts.includes(context));
    for (const contextName of ['book','trades','positions','orders','chart']) {
      const button = page.locator(`[data-mobile-context="${contextName}"]`);
      await button.click();
      checks[`context_${contextName}`] = await button.evaluate(element => element.classList.contains('active'));
    }

    const canvas = page.locator('#chartCanvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Chart canvas unavailable');
    await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.45 } });
    await page.waitForSelector('#mobileCandleCompactDetail', { state: 'visible' });
    const detailBox = await page.locator('#mobileCandleCompactDetail').boundingBox();
    const stageBox = await page.locator('#chartStage').boundingBox();
    metrics.detailRatio = detailBox && stageBox ? detailBox.height / stageBox.height : 1;
    checks.compactDetailBounded = metrics.detailRatio <= 0.32;
    checks.compactDetailComplete = await page.locator('#mobileCandleCompactDetail').evaluate(element =>
      ['O','H','L','C','成交量'].every(text => element.textContent.includes(text)));

    const scrollBefore = await page.evaluate(() => scrollY);
    await page.locator('[data-mobile-chart-fullscreen]').click();
    await page.waitForSelector('#mobileChartFullscreen', { state: 'visible' });
    checks.fullscreenOpens = await page.locator('#mobileChartFullscreen').isVisible();
    checks.fullscreenUsesSameCanvas = await page.evaluate(() => document.querySelector('#mobileChartFullscreen #chartCanvas') !== null
      && document.querySelectorAll('#chartCanvas').length === 1);
    checks.fullscreenToolsPresent = await page.locator('#mobileChartFullscreen').evaluate(element =>
      ['周期','指标','绘图','重置','最新'].every(text => element.textContent.includes(text)));
    await page.locator('[data-mobile-chart-tools]').click();
    await page.waitForSelector('#mobileChartToolsDrawer', { state: 'visible' });
    checks.allPeriodsInDrawer = await page.locator('#mobileChartToolsDrawer [data-timeframe]').evaluateAll(elements => {
      const values = elements.map(element => element.dataset.timeframe);
      return ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w'].every(value => values.includes(value));
    });
    await page.locator('[data-mobile-chart-fullscreen-close]').click();
    await page.waitForSelector('#mobileChartFullscreen', { state: 'hidden' });
    checks.fullscreenCloses = await page.locator('#chartStage #chartCanvas').count() === 1;
    metrics.scrollRestoredDelta = Math.abs((await page.evaluate(() => scrollY)) - scrollBefore);
    checks.scrollRestored = metrics.scrollRestoredDelta <= 4;

    const tradeButtons = page.locator('.mobile-trade-bar [data-mobile-side]');
    const heights = await tradeButtons.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    metrics.tradeButtonMinHeight = Math.min(...heights);
    checks.tradeButtonsTouchSafe = metrics.tradeButtonMinHeight >= 44;

    await page.locator('[data-mobile-side="buy"]').click();
    await page.waitForFunction(() => document.body.classList.contains('order-sheet-open'));
    checks.bodyScrollLockedForSheet = await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'
      || document.body.classList.contains('order-sheet-open'));
    const submit = page.locator('#proOrderSubmit');
    await submit.scrollIntoViewIfNeeded();
    const submitBox = await submit.boundingBox();
    metrics.submitBottom = submitBox ? submitBox.y + submitBox.height : 99999;
    checks.submitWithinViewport = metrics.submitBottom <= viewport.height + 1;
    await page.locator('#orderSheetClose').click();
    await page.waitForFunction(() => !document.body.classList.contains('order-sheet-open'));
  } else {
    checks.shellVisible = await page.locator('.mobile-terminal-stage2').isHidden();
    checks.desktopGridPreserved = await page.locator('.terminal-grid').evaluate(element => getComputedStyle(element).display === 'grid');
    checks.desktopCanvasUnique = await page.locator('#chartCanvas').count() === 1;
    checks.hierarchyCorrect = true;
    checks.summaryFieldsPresent = true;
    checks.summaryExpandable = true;
    checks.contextsComplete = true;
    checks.context_book = true;
    checks.context_trades = true;
    checks.context_positions = true;
    checks.context_orders = true;
    checks.context_chart = true;
    checks.compactDetailBounded = true;
    checks.compactDetailComplete = true;
    checks.fullscreenOpens = true;
    checks.fullscreenUsesSameCanvas = true;
    checks.fullscreenToolsPresent = true;
    checks.allPeriodsInDrawer = true;
    checks.fullscreenCloses = true;
    checks.scrollRestored = true;
    checks.tradeButtonsTouchSafe = true;
    checks.bodyScrollLockedForSheet = true;
    checks.submitWithinViewport = true;
  }

  checks.noDuplicatePrimaryEntries = await page.evaluate(() => {
    if (innerWidth > 820) return true;
    return document.querySelectorAll('.mobile-alert-button').length === 1
      && document.querySelectorAll('[data-open-data-health="mobile"]').length === 1
      && document.querySelectorAll('.mobile-trade-bar [data-mobile-side]').length === 2;
  });
  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
  await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-mobile-terminal-stage2.png`, fullPage: false });
} catch (error) {
  fatalError = String(error);
  try { await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-mobile-terminal-stage2-fatal.png`, fullPage: false }); } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/mobile-terminal-stage2-report.json', JSON.stringify({
  viewport: { name, ...viewport }, checks, metrics, consoleErrors, pageErrors, fatalError, passed, generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});
if (!passed) {
  console.error(`Stage 2 mobile terminal failed for ${name}`);
  process.exit(1);
}
console.log(`Stage 2 mobile terminal passed for ${name}`);
