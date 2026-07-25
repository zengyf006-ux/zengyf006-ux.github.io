import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const REQUIRED_VIEWPORTS = Object.freeze([
  'desktop-1440x900',
  'laptop-1024x768',
  'tablet-768x1024',
  'mobile-390x844',
]);

function requireTrue(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateQualityReport(report, expectedHead) {
  requireTrue(report?.schemaVersion === 'atlas.web-quality.v1', 'Unexpected browser quality schema');
  requireTrue(report?.head === expectedHead, `Browser report Head ${report?.head ?? 'missing'} does not match ${expectedHead}`);
  requireTrue(report?.passed === true, 'Browser quality report did not pass');
  requireTrue(Array.isArray(report?.failures) && report.failures.length === 0, 'Browser quality report contains failures');
  requireTrue(Array.isArray(report?.consoleErrors) && report.consoleErrors.length === 0, 'Browser quality report contains console errors');
  requireTrue(Array.isArray(report?.pageErrors) && report.pageErrors.length === 0, 'Browser quality report contains page errors');

  const screenshots = Array.isArray(report?.screenshots) ? report.screenshots : [];
  const names = screenshots.map((item) => item?.name).sort();
  requireTrue(
    JSON.stringify(names) === JSON.stringify([...REQUIRED_VIEWPORTS].sort()),
    `Browser report viewports are incomplete: ${names.join(', ')}`,
  );
  for (const screenshot of screenshots) {
    requireTrue(screenshot?.dimensions?.scrollWidth <= screenshot?.dimensions?.clientWidth + 1, `Horizontal overflow in ${screenshot?.name}`);
    requireTrue(typeof screenshot?.bytes === 'number' && screenshot.bytes > 0, `Empty screenshot ${screenshot?.name}`);
  }

  const accessibility = report?.accessibility ?? {};
  for (const field of ['unnamedControls', 'duplicateIds', 'unlabeledInputs', 'imagesWithoutAlt', 'unnamedAccessibilityNodes']) {
    requireTrue(Array.isArray(accessibility[field]) && accessibility[field].length === 0, `Accessibility field ${field} is not clean`);
  }
  requireTrue(accessibility.hasMain === true, 'Main accessibility landmark is missing');
  requireTrue(accessibility.navCount >= 1, 'Navigation accessibility landmark is missing');
  requireTrue(accessibility.keyboardUniqueControls >= 8, 'Keyboard traversal is insufficient');
  requireTrue(accessibility.visibleFocusStops >= 1, 'Visible keyboard focus evidence is missing');

  requireTrue(report?.paperFlow?.filled === true, 'Paper trade E2E did not fill');
  requireTrue(report?.paperFlow?.positionVisibleBeforeReload === true, 'Paper position was not visible before reload');
  requireTrue(report?.paperFlow?.positionVisibleAfterReload === true, 'Paper position did not survive reload');
  requireTrue(report?.offlineRecovery?.serviceWorkerControlled === true, 'Service worker did not control the application');
  requireTrue(report?.offlineRecovery?.offlineShellRendered === true, 'Offline shell did not render');
  requireTrue(report?.offlineRecovery?.recoveryNoticeRendered === true, 'Recovery notice did not render');

  const metrics = report?.performance?.metrics ?? {};
  const budgets = report?.performance?.budgets ?? {};
  for (const [name, budget] of Object.entries(budgets)) {
    requireTrue(typeof metrics[name] === 'number', `Performance metric ${name} is missing`);
    requireTrue(metrics[name] <= budget, `Performance metric ${name} exceeds ${budget}`);
  }

  return {
    head: report.head,
    browserVersion: report.browserVersion,
    screenshots: screenshots.map(({ name, viewport, path: screenshotPath, bytes }) => ({
      name,
      viewport,
      path: screenshotPath,
      bytes,
    })),
    performance: { metrics, budgets },
    accessibility: {
      keyboardUniqueControls: accessibility.keyboardUniqueControls,
      visibleFocusStops: accessibility.visibleFocusStops,
      navCount: accessibility.navCount,
    },
    paperFlow: report.paperFlow,
    offlineRecovery: report.offlineRecovery,
  };
}

export async function walkFiles(root) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(root);
  return files;
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
}

export async function checksumLines(root, excluded = new Set()) {
  const files = await walkFiles(root);
  const lines = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (excluded.has(relative)) continue;
    const details = await stat(file);
    lines.push(`${await sha256File(file)}  ${relative}  ${details.size}`);
  }
  return lines;
}
