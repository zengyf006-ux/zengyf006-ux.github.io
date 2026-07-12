import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const packages = [
  ['packages/contracts', '@atlas-x/contracts'],
  ['packages/domain', '@atlas-x/domain'],
  ['packages/market-data', '@atlas-x/market-data'],
  ['packages/paper-trading', '@atlas-x/paper-trading'],
  ['packages/ui', '@atlas-x/ui'],
  ['apps/web', '@atlas-x/web'],
] as const;

async function manifest(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(`${path}/package.json`, root), 'utf8')) as Record<string, unknown>;
}

function dependencyNames(value: unknown): string[] {
  return Object.keys((value ?? {}) as Record<string, string>);
}

describe('workspace architecture boundaries', () => {
  it('declares the required workspaces and strict package typechecks', async () => {
    const rootManifest = await manifest('.');
    expect(rootManifest['workspaces']).toEqual(['apps/*', 'packages/*']);
    for (const [path, name] of packages) {
      const current = await manifest(path);
      expect(current['name']).toBe(name);
      expect(current['private']).toBe(true);
      expect((current['scripts'] as Record<string, string>)['typecheck']).toContain('tsc --noEmit');
    }
  });

  it('keeps dependencies acyclic and pointing in one direction', async () => {
    const allowed: Record<string, readonly string[]> = {
      '@atlas-x/contracts': [],
      '@atlas-x/domain': ['@atlas-x/contracts'],
      '@atlas-x/market-data': ['@atlas-x/contracts', '@atlas-x/domain'],
      '@atlas-x/paper-trading': ['@atlas-x/contracts', '@atlas-x/domain'],
      '@atlas-x/ui': ['@atlas-x/contracts'],
      '@atlas-x/web': [
        '@atlas-x/contracts', '@atlas-x/domain', '@atlas-x/market-data',
        '@atlas-x/paper-trading', '@atlas-x/ui',
      ],
    };
    for (const [path, name] of packages) {
      const current = await manifest(path);
      const dependencies = dependencyNames(current['dependencies']).filter((item) => item.startsWith('@atlas-x/'));
      const expected = allowed[name];
      expect(expected, `${name} has no dependency policy`).toBeDefined();
      expect(dependencies.sort(), name).toEqual([...(expected ?? [])].sort());
    }
  });

  it('exposes focused source entrypoints without reverse app imports', async () => {
    for (const [path] of packages) {
      const source = await readFile(new URL(`${path}/src/index.ts`, root), 'utf8');
      expect(source).not.toMatch(/from ['"][^'"]*apps\//);
      expect(source).not.toMatch(/from ['"]@atlas-x\/web/);
    }
  });

  it('contains no placeholder markers in workspace source', async () => {
    for (const [path] of packages) {
      const names = await readdir(new URL(`${path}/src/`, root));
      for (const name of names.filter((item) => item.endsWith('.ts'))) {
        const source = await readFile(new URL(`${path}/src/${name}`, root), 'utf8');
        expect(source).not.toMatch(/\b(?:TODO|TBD|placeholder|implement later)\b/i);
      }
    }
  });
});
