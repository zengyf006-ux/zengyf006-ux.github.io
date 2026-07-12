import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksumLines,
  REQUIRED_VIEWPORTS,
  validateQualityReport,
} from '../scripts/final-evidence-lib.mjs';

function passingReport(head: string) {
  const budgets = {
    firstContentfulPaintMs: 3000,
    loadEventMs: 5000,
  };
  return {
    schemaVersion: 'atlas.web-quality.v1',
    head,
    passed: true,
    failures: [],
    consoleErrors: [],
    pageErrors: [],
    browserVersion: '150.0.0.0',
    screenshots: REQUIRED_VIEWPORTS.map((name) => ({
      name,
      viewport: { width: 100, height: 100 },
      path: `screenshots/${name}.png`,
      bytes: 10,
      dimensions: { scrollWidth: 100, clientWidth: 100 },
    })),
    accessibility: {
      unnamedControls: [],
      duplicateIds: [],
      unlabeledInputs: [],
      imagesWithoutAlt: [],
      unnamedAccessibilityNodes: [],
      hasMain: true,
      navCount: 2,
      keyboardUniqueControls: 18,
      visibleFocusStops: 18,
    },
    paperFlow: {
      filled: true,
      positionVisibleBeforeReload: true,
      positionVisibleAfterReload: true,
    },
    offlineRecovery: {
      serviceWorkerControlled: true,
      offlineShellRendered: true,
      recoveryNoticeRendered: true,
    },
    performance: {
      metrics: { firstContentfulPaintMs: 300, loadEventMs: 120 },
      budgets,
    },
  };
}

describe('final exact-Head evidence', () => {
  it('accepts only a complete passing report for the expected Head', () => {
    const report = passingReport('a'.repeat(40));
    expect(validateQualityReport(report, 'a'.repeat(40))).toMatchObject({
      head: 'a'.repeat(40),
      browserVersion: '150.0.0.0',
      accessibility: { keyboardUniqueControls: 18, visibleFocusStops: 18 },
    });
    expect(() => validateQualityReport(report, 'b'.repeat(40))).toThrow(/does not match/);
  });

  it('rejects screenshot overflow beyond the one-pixel rendering tolerance and performance regression', () => {
    const overflow = passingReport('a'.repeat(40));
    overflow.screenshots[0]!.dimensions.scrollWidth = 102;
    expect(() => validateQualityReport(overflow, 'a'.repeat(40))).toThrow(/Horizontal overflow/);

    const slow = passingReport('a'.repeat(40));
    slow.performance.metrics.firstContentfulPaintMs = 3001;
    expect(() => validateQualityReport(slow, 'a'.repeat(40))).toThrow(/exceeds/);
  });

  it('produces deterministic sorted checksums with file sizes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-evidence-'));
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'z.txt'), 'z');
    await writeFile(path.join(root, 'nested', 'a.txt'), 'atlas');
    const lines = await checksumLines(root);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/nested\/a\.txt  5$/);
    expect(lines[1]).toMatch(/z\.txt  1$/);
  });
});
