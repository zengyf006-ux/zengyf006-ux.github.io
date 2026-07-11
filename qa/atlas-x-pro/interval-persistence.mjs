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
await context.addInitScript(() => {
  if (sessionStorage.getItem('atlas-interval-seeded')) return;
  sessionStorage.setItem('atlas-interval-seeded', 'true');
  localStorage.clear();
  localStorage.setItem('atlasX.pro.v1', JSON.stringify({
    activeSymbol: 'BTCUSDT', timeframe: '1h', indicator: 'ema', side: 'buy', orderType: 'market',
    accountTab: 'positions', mobileView: 'chart', marketFilter: 'all', bookMode: 'all',
    favorites: ['BTCUSDT'], cash: 100000, positions: [], orders: [], history: [], nextId: 1,
  }));
});

const page = await context.newPage();
page.setDefaultTimeout(12_000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

async function waitInterval(interval, spacing) {
  await page.waitForFunction(({ interval, spacing }) => {
    const state = window.AtlasMarketDataEngine?.getState?.();
    const candles = state?.candles || [];
    const stored = JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}');
    return document.documentElement.dataset.intervalPersistence === 'ready'
      && state?.interval === interval
      && state?.loading === false
      && candles.length >= 100
      && Number(candles[1]?.time) - Number(candles[0]?.time) === spacing
      && stored.timeframe === interval
      && document.querySelector(`[data-timeframe="${interval}"]`)?.classList.contains('active');
  }, { interval, spacing });
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18_000 });
  await page.waitForFunction(() => window.AtlasMarketDataEngine?.getState?.().connectionState === 'live');
  checks.compatLayerReady = await page.evaluate(() => document.documentElement.dataset.intervalPersistence === 'ready');

  const scenarios = [
    ['30m', 1_800_000],
    ['2h', 7_200_000],
    ['1w', 604_800_000],
  ];

  for (const [interval, spacing] of scenarios) {
    await page.locator(`[data-timeframe="${interval}"]`).click();
    await waitInterval(interval, spacing);
    checks[`beforeReload_${interval}`] = true;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitInterval(interval, spacing);
    checks[`afterReload_${interval}`] = true;
  }

  checks.finalStoredInterval = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasX.pro.v1') || '{}').timeframe === '1w');
  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-interval-persistence.png`,
    fullPage: false,
    timeout: 12_000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-interval-persistence-fatal.png`,
      fullPage: false,
      timeout: 12_000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/interval-persistence-report.json', JSON.stringify({
  target, viewport, checks, consoleErrors, pageErrors, fatalError, passed,
  generatedAt: new Date().toISOString(),
}, null, 2));

await context.close().catch(() => {});
await browser.close().catch(() => {});

if (!passed) {
  console.error(`ATLAS X Pro interval persistence failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro interval persistence passed for ${name}`);
