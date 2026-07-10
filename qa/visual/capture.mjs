import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const target = 'http://127.0.0.1:4173/atlas-x/client.html';
const viewports = [
  { name: 'iphone-390x844', width: 390, height: 844 },
  { name: 'iphone-430x932', width: 430, height: 932 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
];

const artifactRoot = 'qa-artifacts';
const screenshotRoot = `${artifactRoot}/screenshots`;
await fs.mkdir(screenshotRoot, { recursive: true });

const report = {
  target,
  generatedAt: new Date().toISOString(),
  completed: false,
  results: [],
  runnerErrors: [],
};

async function saveReport() {
  await fs.writeFile(`${artifactRoot}/report.json`, JSON.stringify(report, null, 2));
}

await saveReport();
let browser;

try {
  browser = await chromium.launch({ headless: true });

  for (const viewport of viewports) {
    const result = {
      viewport,
      passed: false,
      consoleErrors: [],
      pageErrors: [],
    };
    report.results.push(result);
    await saveReport();

    let page;
    try {
      page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        hasTouch: viewport.width < 600,
      });

      page.on('console', message => {
        if (message.type() === 'error') result.consoleErrors.push(message.text());
      });
      page.on('pageerror', error => result.pageErrors.push(String(error)));

      const response = await page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      result.httpStatus = response?.status() ?? null;
      await page.waitForTimeout(5000);

      await page.screenshot({
        path: `${screenshotRoot}/${viewport.name}-launcher.png`,
        fullPage: false,
      });

      const enter = page.locator('#enter');
      result.enterButtonFound = (await enter.count()) > 0;
      if (result.enterButtonFound) {
        await enter.click({ timeout: 15000 });
        await page.waitForTimeout(2500);
      }

      await page.screenshot({
        path: `${screenshotRoot}/${viewport.name}-terminal.png`,
        fullPage: false,
      });

      result.metrics = await page.evaluate(() => ({
        title: document.title,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        bodyHeight: document.body.scrollHeight,
        viewportHeight: document.documentElement.clientHeight,
        visibleTextLength: (document.body.innerText || '').trim().length,
      }));

      result.overflow = result.metrics.bodyWidth > result.metrics.viewportWidth + 1;
      result.blank = result.metrics.visibleTextLength < 20;
      result.badStatus = result.httpStatus === null || result.httpStatus >= 400;
      result.passed = !result.overflow && !result.blank && !result.badStatus && result.pageErrors.length === 0;
    } catch (error) {
      result.fatalError = String(error?.stack || error);
      if (page) {
        try {
          await page.screenshot({
            path: `${screenshotRoot}/${viewport.name}-failure.png`,
            fullPage: false,
          });
        } catch (screenshotError) {
          result.screenshotError = String(screenshotError?.stack || screenshotError);
        }
      }
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          result.closeError = String(closeError?.stack || closeError);
        }
      }
      await saveReport();
    }
  }
} catch (error) {
  report.runnerErrors.push(String(error?.stack || error));
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      report.runnerErrors.push(String(error?.stack || error));
    }
  }
  report.completed = true;
  report.passed = report.runnerErrors.length === 0 && report.results.length === viewports.length && report.results.every(item => item.passed);
  await saveReport();
}

console.log(JSON.stringify({ completed: report.completed, passed: report.passed, results: report.results.length }));
