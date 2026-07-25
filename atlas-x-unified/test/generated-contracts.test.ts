import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('generated cross-platform contract discriminants', () => {
  it('preserves DataSource business discriminants instead of schema names', async () => {
    const generated = await readFile(new URL('../src/generated/contracts.ts', import.meta.url), 'utf8');
    expect(generated).toContain('truthfulness: "real"');
    expect(generated).toContain('truthfulness: "cachedReal"');
    expect(generated).toContain('truthfulness: "fixture"');
    expect(generated).not.toContain('truthfulness: "RealDataSource"');
  });

  it('preserves order type business values', async () => {
    const generated = await readFile(new URL('../src/generated/contracts.ts', import.meta.url), 'utf8');
    expect(generated).toContain('type: "market"');
    expect(generated).toContain('type: "stopLimit"');
    expect(generated).not.toContain('type: "MarketOrderDraft"');
  });
});
