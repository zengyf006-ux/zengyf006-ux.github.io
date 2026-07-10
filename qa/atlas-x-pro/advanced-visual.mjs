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
page.setDefaultTimeout(8000);
const target = 'http://127.0.0.1:4173/atlas-x-pro/?qa=1';

await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/400.css', timeout: 6000 });
await page.addStyleTag({ url: 'http://127.0.0.1:4173/node_modules/@fontsource/noto-sans-sc/700.css', timeout: 6000 });
await page.addStyleTag({ content: 'html,body,button,input,select{font-family:"Noto Sans SC",sans-serif!important}' });
await page.waitForFunction(() => document.documentElement.dataset.tradingAdvanced === 'ready', null, { timeout: 12000 });
await page.waitForTimeout(600);

if (viewport.mobile) await page.locator('[data-mobile-view="book"]').click();
await page.locator('[data-book-view="depth"]').click();
await page.waitForFunction(() => document.querySelector('#depthChartCanvas')?.dataset.rendered === 'true', null, { timeout: 6000 });
await page.screenshot({
  path: `qa-artifacts-pro/screenshots/${viewport.name}-depth.png`,
  fullPage: false,
  timeout: 12000,
});

if (viewport.mobile) await page.locator('[data-mobile-view="chart"]').click();
else await page.locator('[data-book-view="book"]').click();
const alertScope = viewport.mobile ? 'mobile' : 'desktop';
await page.locator(`[data-open-price-alert="${alertScope}"]`).click();
await page.waitForSelector('#priceAlertPanel', { state: 'visible' });
await page.screenshot({
  path: `qa-artifacts-pro/screenshots/${viewport.name}-price-alert.png`,
  fullPage: false,
  timeout: 12000,
});

const result = {
  viewport,
  depthRendered: await page.locator('#depthChartCanvas').evaluate(canvas => canvas.dataset.rendered === 'true'),
  alertVisible: await page.locator('#priceAlertPanel').isVisible(),
  generatedAt: new Date().toISOString(),
};
await fs.writeFile('qa-artifacts-pro/advanced-visual-report.json', JSON.stringify(result, null, 2));
await context.close();
await browser.close();
console.log(`ATLAS X Pro advanced visual states captured for ${name}`);
