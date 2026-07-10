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
const page = await context.newPage();
page.setDefaultTimeout(9000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';
const checks = {};
const consoleErrors = [];
const pageErrors = [];
let fatalError = null;
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
  await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
  await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
  await page.waitForFunction(() => document.documentElement.dataset.dataHealth === 'ready', null, { timeout: 12000 });
  await page.waitForFunction(() => {
    const router = window.__ATLAS_DATA_ROUTER__;
    const snapshot = router?.snapshot?.();
    return snapshot?.rest?.status === 'qa-demo' && snapshot?.websocket?.status === 'qa-offline';
  }, null, { timeout: 12000 });

  const routerResult = await page.evaluate(async () => {
    const router = window.__ATLAS_DATA_ROUTER__;
    return {
      qaMode: router?.qaMode,
      restHosts: router?.restHosts,
      websocketHosts: router?.websocketHosts,
      selfTest: await router?.selfTest?.(),
      snapshot: router?.snapshot?.(),
      wsCandidates: router?.websocketCandidates?.('wss://stream.binance.com:443/stream?streams=btcusdt@ticker'),
    };
  });

  checks.qaModeDeclared = routerResult.qaMode === true;
  checks.sevenOfficialRestHosts = Array.isArray(routerResult.restHosts)
    && routerResult.restHosts.length === 7
    && routerResult.restHosts[0] === 'https://data-api.binance.vision'
    && routerResult.restHosts.includes('https://api-gcp.binance.com')
    && routerResult.restHosts.includes('https://api4.binance.com');
  checks.twoOfficialWebSocketPorts = Array.isArray(routerResult.websocketHosts)
    && routerResult.websocketHosts.length === 2
    && routerResult.websocketHosts[0] === 'wss://stream.binance.com:9443'
    && routerResult.websocketHosts[1] === 'wss://stream.binance.com:443';
  checks.websocketPathPreserved = Array.isArray(routerResult.wsCandidates)
    && routerResult.wsCandidates.every(value => value.endsWith('/stream?streams=btcusdt@ticker'));
  checks.routerSelfTestPassed = Boolean(routerResult.selfTest?.restHostsOfficial
    && routerResult.selfTest?.websocketPortsOfficial
    && routerResult.selfTest?.deterministicFailover);
  checks.qaRestRouteRecorded = routerResult.snapshot?.rest?.status === 'qa-demo';
  checks.qaWebSocketRouteRecorded = routerResult.snapshot?.websocket?.status === 'qa-offline';

  const scope = viewport.mobile ? 'mobile' : 'desktop';
  const openButton = page.locator(`[data-open-data-health="${scope}"]`);
  checks.healthButtonVisible = await openButton.isVisible();
  await openButton.click();
  checks.healthPanelVisible = await page.locator('#dataHealthPanel').isVisible();
  const panelText = await page.locator('#dataHealthPanel').innerText();
  checks.demoSourceDisclosed = panelText.includes('演示行情') && panelText.includes('本地可重复演示源');
  checks.noKeyDisclosurePresent = panelText.includes('不使用API密钥') && panelText.includes('不读取真实账户');
  checks.panelHasSeparateRoutes = panelText.includes('REST') && panelText.includes('WS');
  checks.noHorizontalOverflow = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
  checks.noConsoleErrors = consoleErrors.length === 0;
  checks.noPageErrors = pageErrors.length === 0;

  await page.screenshot({
    path: `qa-artifacts-pro/screenshots/${name}-data-health.png`,
    fullPage: false,
    timeout: 12000,
  });
} catch (error) {
  fatalError = String(error);
  try {
    await page.screenshot({
      path: `qa-artifacts-pro/screenshots/${name}-data-health-fatal.png`,
      fullPage: false,
      timeout: 12000,
    });
  } catch {}
}

const passed = !fatalError && Object.values(checks).every(Boolean);
await fs.writeFile('qa-artifacts-pro/market-data-router-report.json', JSON.stringify({
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
  console.error(`ATLAS X Pro market data router failed for ${name}`);
  process.exit(1);
}
console.log(`ATLAS X Pro market data router passed for ${name}`);
