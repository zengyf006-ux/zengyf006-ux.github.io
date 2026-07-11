import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const target = 'http://127.0.0.1:4173/atlas-x/client.html';
const viewports = [
  { name: 'iphone-390x844', width: 390, height: 844 },
  { name: 'iphone-430x932', width: 430, height: 932 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
];

await fs.mkdir('qa-artifacts/screenshots', { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { target, generatedAt: new Date().toISOString(), results: [] };
let failed = false;

for (const viewport of viewports) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);

    const enter = page.locator('#enter');
    if (await enter.count()) {
      await enter.click({ timeout: 15000 });
      await page.waitForTimeout(2500);
    }

    const metrics = await page.evaluate(() => ({
      title: document.title,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyHeight: document.body.scrollHeight,
      visibleTextLength: (document.body.innerText || '').trim().length,
    }));

    const overflow = metrics.bodyWidth > metrics.viewportWidth + 1;
    const blank = metrics.visibleTextLength < 20;
    const badStatus = !response || response.status() >= 400;
    const resultFailed = overflow || blank || badStatus || pageErrors.length > 0;
    failed ||= resultFailed;

    await page.screenshot({
      path: `qa-artifacts/screenshots/${viewport.name}.png`,
      fullPage: true,
    });

    report.results.push({
      viewport,
      httpStatus: response?.status() ?? null,
      overflow,
      blank,
      metrics,
      consoleErrors,
      pageErrors,
      passed: !resultFailed,
    });
  } catch (error) {
    failed = true;
    report.results.push({ viewport, passed: false, fatalError: String(error), consoleErrors, pageErrors });
  } finally {
    await page.close();
  }
}

await browser.close();
await fs.writeFile('qa-artifacts/report.json', JSON.stringify(report, null, 2));

if (failed) {
  console.error('Visual QA proof completed with failures. See report.json.');
  process.exit(1);
}

console.log('Visual QA proof completed successfully.');
