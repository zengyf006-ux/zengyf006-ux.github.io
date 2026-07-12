import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const coreDirectories = [
  new URL('../src/', import.meta.url),
  new URL('../packages/contracts/src/', import.meta.url),
  new URL('../packages/domain/src/', import.meta.url),
];
const workspaceDirectories = [
  ...coreDirectories,
  new URL('../packages/market-data/src/', import.meta.url),
  new URL('../packages/paper-trading/src/', import.meta.url),
  new URL('../packages/ui/src/', import.meta.url),
  new URL('../apps/web/src/', import.meta.url),
];

async function listSourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? listSourceFiles(url) : [url];
  }));
  return nested.flat().filter((url) => /\.tsx?$/.test(url.pathname));
}

async function sourceFiles(directories: readonly URL[]): Promise<URL[]> {
  return (await Promise.all(directories.map(listSourceFiles))).flat();
}

describe('unified architecture boundaries', () => {
  it('keeps contracts and domain free from browser, UI, storage and network state', async () => {
    const forbidden = [
      /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /\bsessionStorage\b/,
      /\bReact\b/, /from ['"]react/,
      /globalThis\.(?:fetch|WebSocket)\s*=/, /window\.(?:fetch|WebSocket)\s*=/,
    ];
    for (const file of await sourceFiles(coreDirectories)) {
      const content = await readFile(file, 'utf8');
      for (const pattern of forbidden) expect(pattern.test(content), `${file.pathname} matches ${pattern}`).toBe(false);
    }
  });

  it('forbids browser-persisted business truth and network monkey patches in every workspace', async () => {
    const forbidden = [
      /\blocalStorage\b/, /\bsessionStorage\b/, /window\.[A-Za-z_$][\w$]*\s*=/,
      /globalThis\.(?:fetch|WebSocket)\s*=/, /window\.(?:fetch|WebSocket)\s*=/,
    ];
    for (const file of await sourceFiles(workspaceDirectories)) {
      const content = await readFile(file, 'utf8');
      for (const pattern of forbidden) expect(pattern.test(content), `${file.pathname} matches ${pattern}`).toBe(false);
    }
  });
});
