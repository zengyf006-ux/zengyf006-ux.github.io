import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  resolvePwaPhase,
  shouldReloadAfterControllerChange,
} from '../apps/web/src/app/pwa.js';

const publicFile = (name: string) => new URL(`../apps/web/public/${name}`, import.meta.url);

describe('ATLAS X PWA policy', () => {
  it('prioritizes unsupported, offline and update-ready states deterministically', () => {
    expect(resolvePwaPhase({ supported: false, online: true, updateAvailable: true, recovered: true })).toBe('unsupported');
    expect(resolvePwaPhase({ supported: true, online: false, updateAvailable: true, recovered: true })).toBe('offline');
    expect(resolvePwaPhase({ supported: true, online: true, updateAvailable: true, recovered: true })).toBe('updateReady');
    expect(resolvePwaPhase({ supported: true, online: true, updateAvailable: false, recovered: true })).toBe('recovered');
    expect(resolvePwaPhase({ supported: true, online: true, updateAvailable: false, recovered: false })).toBe('ready');
  });

  it('reloads only after an explicit update request replaces an existing controller', () => {
    expect(shouldReloadAfterControllerChange(true, true)).toBe(true);
    expect(shouldReloadAfterControllerChange(false, true)).toBe(false);
    expect(shouldReloadAfterControllerChange(true, false)).toBe(false);
  });

  it('declares standalone identity, scope and normal plus maskable icons', async () => {
    const manifest = JSON.parse(await readFile(publicFile('manifest.webmanifest'), 'utf8')) as {
      name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      description?: string;
      icons?: Array<{ purpose?: string; type?: string; sizes?: string }>;
    };
    expect(manifest).toMatchObject({
      name: 'ATLAS X Unified Pro',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.description).toContain('No real-money execution');
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ purpose: 'any', type: 'image/svg+xml', sizes: 'any' }),
      expect.objectContaining({ purpose: 'maskable', type: 'image/svg+xml', sizes: 'any' }),
    ]));
  });

  it('keeps the service worker limited to same-origin GET shell assets and user-approved activation', async () => {
    const source = await readFile(publicFile('sw.js'), 'utf8');
    expect(source).toContain("request.method !== 'GET'");
    expect(source).toContain("request.headers.has('authorization')");
    expect(source).toContain('url.origin !== scopeUrl.origin');
    expect(source).toContain("request.mode === 'navigate'");
    expect(source).toContain("event.data?.type === 'SKIP_WAITING'");
    expect(source.match(/skipWaiting\(\)/g)).toHaveLength(1);
    expect(source).not.toContain('api.exchange.coinbase.com');
  });
});
