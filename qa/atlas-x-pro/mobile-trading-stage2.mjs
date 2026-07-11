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
  accountTab: 'positions', mobileView: 'chart', marketFilter: 'all', bookMode: 'all', favorites: ['BTCUSDT'],
  cash: 50000,
  positions: [{ id: 'mobile-stage2-position', symbol: 'BTCUSDT', qty: 0.2, entry: 60000, fees: 9.6, createdAt: Date.now() - 400000 }],
  orders: [], history: [], nextId: 900,
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
page.setDefaultTimeout(15000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const evidence = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.mobileTerminalStage2 === 'ready'
    && document.documentElement.dataset.mobileTradingStage2 === 'ready');

  checks.apiReady = await page.evaluate(() => Boolean(window.AtlasMobileStage2?.openFullscreenChart));
  if (!viewport.mobile) {
    checks.desktopStage2Hidden = await page.locator('.stage2-mobile-context').isHidden()
      && await page.locator('.stage2-candle-strip').isHidden()
      && await page.locator('.stage2-chart-tools-sheet').isHidden();
    checks.desktopLayoutUnchanged = await page.evaluate(() => {
      const shell = document.querySelector('.pro-shell')?.getBoundingClientRect();
      const chart = document.querySelector('.chart-panel')?.getBoundingClientRect();
      return shell?.width > 1000 && chart?.width > 400 && !document.body.classList.contains('mobile-chart-fullscreen');
    });
    checks.hierarchyCorrect = true;
    checks.chartMeaningfulHeight = true;
    checks.toolsSheetWorks = true;
    checks.fullscreenWorks = true;
    checks.fullscreenRestores = true;
    checks.compactCandleWorks = true;
    checks.candleLayoutStable = true;
    checks.detailOnDemandWorks = true;
    checks.detailLayoutStable = true;
    checks.contextNavigationWorks = true;
    checks.primaryTouchTargets = true;
    checks.tradeBarClear = true;
  } else {
    await page.locator('[data-mobile-view="chart"]').click();
    await page.waitForSelector('.chart-panel.mobile-active', { state: 'visible' });
    const geometry = await page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector)?.getBoundingClientRect();
        return value ? { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width, height: value.height } : null;
      };
      return {
        market: rect('.mobile-market-head'),
        stats: rect('.mobile-quick-stats'),
        toolbar: rect('.chart-panel .chart-toolbar'),
        chart: rect('#chartStage'),
        context: rect('.stage2-mobile-context'),
        tradeBar: rect('.mobile-trade-bar'),
        nav: rect('.mobile-nav'),
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    evidence.geometry = geometry;
    checks.hierarchyCorrect = geometry.market.bottom <= geometry.stats.top + 1
      && geometry.stats.bottom <= geometry.toolbar.top + 2
      && geometry.toolbar.bottom <= geometry.chart.top + 80
      && geometry.chart.bottom <= geometry.context.bottom + 1;
    checks.chartMeaningfulHeight = geometry.chart.height >= 250;
    checks.tradeBarClear = geometry.tradeBar.bottom <= geometry.viewport.height + 1
      && geometry.tradeBar.top >= geometry.nav.top - 1;

    await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-mobile-stage2-main.png`, fullPage: false, timeout: 12000 });

    await page.locator('[data-stage2-tools-open]').click();
    await page.waitForSelector('#stage2ChartToolsSheet[data-open="true"]', { state: 'visible' });
    checks.toolsSheetWorks = await page.locator('[data-stage2-tools-group="timeframe"] button').count() >= 8
      && await page.locator('[data-stage2-action="fullscreen"]').isVisible();
    await page.locator('[data-stage2-tools-close]').click();
    await page.waitForFunction(() => {
      const sheet = document.querySelector('#stage2ChartToolsSheet');
      return sheet?.dataset.open === 'false'
        && sheet.getBoundingClientRect().top >= innerHeight - 1;
    });

    const initialScroll = await page.evaluate(() => scrollY);
    await page.evaluate(() => window.AtlasMobileStage2.openFullscreenChart());
    await page.waitForFunction(() => document.body.classList.contains('mobile-chart-fullscreen'));
    const fullscreenGeometry = await page.locator('.chart-panel').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bodyPosition: document.body.style.position };
    });
    evidence.fullscreen = fullscreenGeometry;
    checks.fullscreenWorks = fullscreenGeometry.top === 0
      && fullscreenGeometry.left === 0
      && Math.abs(fullscreenGeometry.width - viewport.width) <= 1
      && Math.abs(fullscreenGeometry.height - viewport.height) <= 1
      && fullscreenGeometry.bodyPosition === 'fixed';
    await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-mobile-stage2-fullscreen.png`, fullPage: false, timeout: 12000 });
    await page.locator('[data-stage2-fullscreen-close]').click();
    await page.waitForFunction(() => !document.body.classList.contains('mobile-chart-fullscreen'));
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }));
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#chartCanvas');
      const stage = document.querySelector('#chartStage');
      if (!canvas || !stage) return false;
      const rect = stage.getBoundingClientRect();
      const ratio = devicePixelRatio || 1;
      return rect.height >= 250
        && Math.abs(canvas.width - Math.round(rect.width * ratio)) <= 2
        && Math.abs(canvas.height - Math.round(rect.height * ratio)) <= 2;
    });
    checks.fullscreenRestores = await page.evaluate(expected => document.body.style.position === '' && Math.abs(scrollY - expected) <= 1, initialScroll);

    await page.evaluate(() => {
      const state = window.AtlasMarketDataEngine?.getState?.();
      const index = Math.max(0, (state?.candles?.length || 1) - 4);
      window.AtlasChartExperience?.select?.(index, 'stage2-shell-qa');
    });
    await page.waitForFunction(() => {
      const detail = document.querySelector('#chartCandleDetail');
      const strip = document.querySelector('.stage2-candle-strip');
      if (!detail || strip?.dataset.open !== 'true') return false;
      const mapping = {
        open: '#detailOpen', high: '#detailHigh', low: '#detailLow', close: '#detailClose',
        time: '#detailTime', change: '#detailChangePercent', volume: '#detailVolume', interval: '#detailInterval',
      };
      return Object.entries(mapping).every(([key, selector]) => {
        const detailValue = document.querySelector(selector)?.textContent?.trim() || '';
        const stripValue = strip.querySelector(`[data-stage2-candle="${key}"]`)?.textContent?.trim() || '';
        return detailValue && detailValue !== '--' && stripValue === detailValue;
      });
    });
    const compactCandle = await page.evaluate(() => {
      const detail = document.querySelector('#chartCandleDetail');
      const strip = document.querySelector('.stage2-candle-strip');
      const stage = document.querySelector('#chartStage');
      const canvas = document.querySelector('#chartCanvas');
      const mapping = {
        open: '#detailOpen', high: '#detailHigh', low: '#detailLow', close: '#detailClose',
        time: '#detailTime', change: '#detailChangePercent', volume: '#detailVolume', interval: '#detailInterval',
      };
      const values = Object.fromEntries(Object.entries(mapping).map(([key, selector]) => {
        const detailValue = document.querySelector(selector)?.textContent?.trim() || '';
        const stripValue = strip?.querySelector(`[data-stage2-candle="${key}"]`)?.textContent?.trim() || '';
        return [key, { detail: detailValue, strip: stripValue }];
      }));
      const stripRect = strip?.getBoundingClientRect();
      const stageRect = stage?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      return {
        values,
        allComplete: Object.values(values).every(value => value.detail && value.detail !== '--' && value.strip === value.detail),
        detailCollapsed: getComputedStyle(detail).display === 'none'
          && !document.body.classList.contains('stage2-candle-detail-open'),
        geometry: {
          strip: stripRect ? { top: stripRect.top, bottom: stripRect.bottom, height: stripRect.height } : null,
          stage: stageRect ? { top: stageRect.top, bottom: stageRect.bottom, width: stageRect.width, height: stageRect.height } : null,
          canvas: canvasRect ? { top: canvasRect.top, bottom: canvasRect.bottom, width: canvasRect.width, height: canvasRect.height } : null,
        },
        layoutStable: Boolean(stripRect && stageRect && canvasRect
          && Math.abs(stageRect.top - stripRect.bottom) <= 2
          && stageRect.height >= 250
          && Math.abs(canvasRect.top - stageRect.top) <= 1
          && Math.abs(canvasRect.width - stageRect.width) <= 2
          && Math.abs(canvasRect.height - stageRect.height) <= 2),
      };
    });
    evidence.compactCandle = compactCandle;
    checks.compactCandleWorks = compactCandle.allComplete && compactCandle.detailCollapsed;
    checks.candleLayoutStable = compactCandle.layoutStable;
    await page.locator('[data-stage2-candle-more]').click();
    await page.waitForFunction(() => document.body.classList.contains('stage2-candle-detail-open'));
    const detailState = await page.evaluate(() => {
      const strip = document.querySelector('.stage2-candle-strip')?.getBoundingClientRect();
      const stage = document.querySelector('#chartStage')?.getBoundingClientRect();
      const canvas = document.querySelector('#chartCanvas')?.getBoundingClientRect();
      return {
        geometry: {
          strip: strip ? { top: strip.top, bottom: strip.bottom, height: strip.height } : null,
          stage: stage ? { top: stage.top, bottom: stage.bottom, width: stage.width, height: stage.height } : null,
          canvas: canvas ? { top: canvas.top, bottom: canvas.bottom, width: canvas.width, height: canvas.height } : null,
        },
        layoutStable: Boolean(strip && stage && canvas
          && Math.abs(stage.top - strip.bottom) <= 2
          && stage.height >= 250
          && Math.abs(canvas.top - stage.top) <= 1
          && Math.abs(canvas.width - stage.width) <= 2
          && Math.abs(canvas.height - stage.height) <= 2),
      };
    });
    evidence.detailLayout = detailState;
    checks.detailOnDemandWorks = await page.locator('#chartCandleDetail').isVisible()
      && await page.locator('#chartCandleDetail [data-clear-candle-selection]').isVisible();
    checks.detailLayoutStable = detailState.layoutStable;
    await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-mobile-stage2-candle-detail.png`, fullPage: false, timeout: 12000 });
    await page.locator('#chartCandleDetail [data-clear-candle-selection]').click();
    await page.waitForFunction(() => !document.body.classList.contains('stage2-candle-detail-open'));

    await page.locator('[data-stage2-context="book"]').click();
    await page.waitForSelector('.orderbook-panel.mobile-active', { state: 'visible' });
    const bookOpen = await page.locator('.orderbook-panel.mobile-active').isVisible();
    await page.locator('[data-mobile-view="chart"]').click();
    await page.waitForSelector('.chart-panel.mobile-active', { state: 'visible' });
    await page.locator('[data-stage2-context="trades"]').click();
    await page.waitForSelector('.orderbook-panel.mobile-active', { state: 'visible' });
    const tradesActive = await page.locator('[data-book-content="trades"].active').isVisible();
    await page.locator('[data-mobile-view="chart"]').click();
    await page.waitForSelector('.chart-panel.mobile-active', { state: 'visible' });
    await page.locator('[data-stage2-context="account"]').click();
    await page.waitForSelector('.account-workspace.mobile-active', { state: 'visible' });
    const accountOpen = await page.locator('.account-workspace.mobile-active').isVisible();
    checks.contextNavigationWorks = bookOpen && tradesActive && accountOpen;

    await page.locator('[data-mobile-view="chart"]').click();
    await page.waitForSelector('.chart-panel.mobile-active', { state: 'visible' });
    checks.primaryTouchTargets = await page.evaluate(() => {
      const selectors = '[data-stage2-tools-open], #chartFullscreen, .stage2-mobile-context button, .mobile-trade-bar button';
      const targets = [...document.querySelectorAll(selectors)].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      return targets.length >= 7 && targets.every(element => element.getBoundingClientRect().height >= 40);
    });
    checks.desktopStage2Hidden = true;
    checks.desktopLayoutUnchanged = true;
  }

  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;
} catch (error) {
  fatalError = String(error);
  try { await page.screenshot({ path: `qa-artifacts-pro/screenshots/${name}-mobile-stage2-fatal.png`, fullPage: false }); } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/mobile-trading-stage2-report.json', JSON.stringify({
  target, viewport, checks, evidence, consoleErrors, pageErrors, fatalError, passed, generatedAt: new Date().toISOString(),
}, null, 2));
await context.close().catch(() => {});
await browser.close().catch(() => {});
if (!passed) {
  console.error(`ATLAS X Pro Stage 2 mobile shell failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro Stage 2 mobile shell passed for ${name}`);
