import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const packages = [
  ['packages/contracts', '@atlas-x/contracts'], ['packages/domain', '@atlas-x/domain'],
  ['packages/market-data', '@atlas-x/market-data'], ['packages/paper-trading', '@atlas-x/paper-trading'],
  ['packages/ui', '@atlas-x/ui'], ['apps/web', '@atlas-x/web'],
] as const;

async function manifest(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(`${path}/package.json`, root), 'utf8')) as Record<string, unknown>;
}
function dependencyNames(value: unknown): string[] { return Object.keys((value ?? {}) as Record<string, string>); }
async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? sourceFiles(url) : Promise.resolve([url]);
  }));
  return nested.flat().filter((url) => /\.tsx?$/.test(url.pathname));
}

describe('workspace architecture boundaries', () => {
  it('declares required workspaces and strict package typechecks', async () => {
    expect((await manifest('.'))['workspaces']).toEqual(['apps/*', 'packages/*']);
    for (const [path, name] of packages) {
      const current = await manifest(path);
      expect(current['name']).toBe(name);
      expect(current['private']).toBe(true);
      expect((current['scripts'] as Record<string, string>)['typecheck']).toContain('tsc --noEmit');
    }
  });

  it('keeps dependencies acyclic and pointing toward the application', async () => {
    const allowed: Record<string, readonly string[]> = {
      '@atlas-x/contracts': [], '@atlas-x/domain': ['@atlas-x/contracts'],
      '@atlas-x/market-data': ['@atlas-x/contracts', '@atlas-x/domain'],
      '@atlas-x/paper-trading': ['@atlas-x/contracts', '@atlas-x/domain'],
      '@atlas-x/ui': ['@atlas-x/contracts'],
      '@atlas-x/web': ['@atlas-x/contracts', '@atlas-x/domain', '@atlas-x/market-data', '@atlas-x/paper-trading', '@atlas-x/ui'],
    };
    for (const [path, name] of packages) {
      const dependencies = dependencyNames((await manifest(path))['dependencies']).filter((item) => item.startsWith('@atlas-x/'));
      expect(dependencies.sort(), name).toEqual([...(allowed[name] ?? [])].sort());
    }
  });

  it('contains no reverse app imports or unfinished source markers', async () => {
    for (const [path] of packages) {
      for (const file of await sourceFiles(new URL(`${path}/src/`, root))) {
        const source = await readFile(file, 'utf8');
        expect(source).not.toMatch(/from ['"][^'"]*apps\//);
        expect(source).not.toMatch(/from ['"]@atlas-x\/web/);
        expect(source).not.toMatch(/\b(?:TODO|TBD|implement later)\b/i);
      }
    }
  });
});
