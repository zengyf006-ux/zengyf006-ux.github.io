import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourceDirectory = new URL('../src/', import.meta.url);

async function listSourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? listSourceFiles(url) : [url];
  }));
  return nested.flat().filter((url) => url.pathname.endsWith('.ts'));
}

describe('unified core architecture boundaries', () => {
  it('contains no browser globals, UI framework, storage or network monkey patches', async () => {
    const files = await listSourceFiles(sourceDirectory);
    const forbidden = [
      /\bwindow\b/,
      /\bdocument\b/,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /\bReact\b/,
      /from ['"]react/,
      /globalThis\.(?:fetch|WebSocket)\s*=/,
      /window\.(?:fetch|WebSocket)\s*=/,
    ];

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(content), `${file.pathname} matches ${pattern}`).toBe(false);
      }
    }
  });
});
