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
page.setDefaultTimeout(10000);
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
  await page.waitForFunction(() => document.documentElement.dataset.stage1DataHealth === 'ready', null, { timeout: 12000 });
  await page.waitForFunction(() => {
    const state = window.AtlasMarketDataEngine?.getState?.();
    return document.documentElement.dataset.marketDataEngine === 'ready'
      && state?.connectionState === 'live'
      && state?.source === 'fixture'
      && state?.provider === 'fixture'
      && state?.ticker?.price > 0
      && state?.book?.bids?.length > 0
      && state?.book?.asks?.length > 0
      && state?.trades?.length > 0
      && state?.candles?.length >= 20;
  }, null, { timeout: 12000 });

  const result = await page.evaluate(async () => {
    const router = window.__ATLAS_DATA_ROUTER__;
    const engine = window.AtlasMarketDataEngine;
    const state = engine?.getState?.();
    const spacing = state?.candles?.length > 1 ? state.candles[1].time - state.candles[0].time : 0;
    return {
      stageRouter: document.documentElement.dataset.marketRouter || '',
      qaMode: router?.qaMode,
      restHosts: router?.restHosts,
      websocketHosts: router?.websocketHosts,
      selfTest: await router?.selfTest?.(),
      wsCandidates: router?.websocketCandidates?.('wss://stream.binance.com:443/stream?streams=btcusdt@ticker'),
      state,
      spacing,
      expectedSpacing: engine?.intervalMs?.(state?.interval),
      gatewayBase: engine?.gatewayBase,
      engineVersion: engine?.version,
    };
  });

  checks.stageRouterActive = result.stageRouter === 'stage1';
  checks.qaModeDeclared = result.qaMode === true;
  checks.engineVersionCorrect = result.engineVersion === 'atlas.market.client.v1';
  checks.publicGatewayDeclared = String(result.gatewayBase || '').includes('/functions/v1/atlas-market-gateway');
  checks.engineSessionUnified = Boolean(result.state?.sessionId
    && result.state?.requestGeneration >= 1
    && result.state?.source === 'fixture'
    && result.state?.provider === 'fixture'
    && result.state?.ticker?.price > 0
    && result.state?.book?.bids?.length
    && result.state?.book?.asks?.length
    && result.state?.trades?.length
    && result.state?.candles?.length >= 20);
  checks.engineTimestampsPresent = Number(result.state?.lastServerTime) > 0
    && Number(result.state?.lastReceivedAt) >= Number(result.state?.lastServerTime);
  checks.engineIntervalCorrect = Number(result.spacing) > 0
    && Number(result.spacing) === Number(result.expectedSpacing);
  checks.engineFreshnessDeclared = result.state?.connectionState === 'live'
    && Number.isFinite(Number(result.state?.latencyMs))
    && Number(result.state?.staleForMs) >= 0;

  checks.rollbackRestHostsPreserved = Array.isArray(result.restHosts)
    && result.restHosts.length === 7
    && result.restHosts[0] === 'https://data-api.binance.vision'
    && result.restHosts.includes('https://api-gcp.binance.com')
    && result.restHosts.includes('https://api4.binance.com');
  checks.rollbackWebSocketHostsPreserved = Array.isArray(result.websocketHosts)
    && result.websocketHosts.length === 2
    && result.websocketHosts[0] === 'wss://stream.binance.com:9443'
    && result.websocketHosts[1] === 'wss://stream.binance.com:443';
  checks.websocketPathPreserved = Array.isArray(result.wsCandidates)
    && result.wsCandidates.every(value => value.endsWith('/stream?streams=btcusdt@ticker'));
  checks.rollbackRouterSelfTestPassed = Boolean(result.selfTest?.restHostsOfficial
    && result.selfTest?.websocketPortsOfficial
    && result.selfTest?.deterministicFailover);

  const scope = viewport.mobile ? 'mobile' : 'desktop';
  const openButton = page.locator(`[data-open-data-health="${scope}"]`);
  checks.healthButtonVisible = await openButton.isVisible();
  await openButton.click();
  await page.waitForSelector('#dataHealthPanel', { state: 'visible' });
  checks.healthPanelVisible = await page.locator('#dataHealthPanel').isVisible();
  const panelText = await page.locator('#dataHealthPanel').innerText();
  checks.stageEngineDisclosed = panelText.includes('统一行情内核') || panelText.includes('统一实时流');
  checks.demoSourceDisclosed = (panelText.includes('演示行情') || panelText.includes('确定性测试行情'))
    && (panelText.includes('本地可重复演示源') || panelText.includes('本地确定性测试源'));
  checks.noKeyDisclosurePresent = panelText.includes('不使用API密钥') && panelText.includes('不读取真实账户');
  checks.panelHasSeparateRoutes = panelText.includes('REST') && (panelText.includes('WS') || panelText.includes('流'));
  checks.providerAndIntervalVisible = panelText.includes(String(result.state?.provider || '').toUpperCase())
    && panelText.includes(String(result.state?.interval || ''));
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