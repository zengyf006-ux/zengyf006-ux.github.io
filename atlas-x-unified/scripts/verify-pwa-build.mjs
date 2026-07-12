import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const dist = path.resolve('apps/web/dist');
const required = ['index.html', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-maskable.svg'];
for (const file of required) await access(path.join(dist, file), constants.R_OK);

const index = await readFile(path.join(dist, 'index.html'), 'utf8');
if (!index.includes('rel="manifest" href="/manifest.webmanifest"')) {
  throw new Error('Production index.html does not link the PWA manifest');
}

const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.webmanifest'), 'utf8'));
if (manifest.display !== 'standalone' || manifest.start_url !== '/' || manifest.scope !== '/') {
  throw new Error('PWA manifest identity, scope or standalone display is invalid');
}
const purposes = new Set((manifest.icons ?? []).map((icon) => icon.purpose));
if (!purposes.has('any') || !purposes.has('maskable')) {
  throw new Error('PWA manifest must provide normal and maskable icons');
}

const worker = await readFile(path.join(dist, 'sw.js'), 'utf8');
for (const boundary of [
  "request.method !== 'GET'",
  "request.headers.has('authorization')",
  'url.origin !== scopeUrl.origin',
  "event.data?.type === 'SKIP_WAITING'",
]) {
  if (!worker.includes(boundary)) throw new Error(`Service worker boundary missing: ${boundary}`);
}
if ((worker.match(/skipWaiting\(\)/g) ?? []).length !== 1) {
  throw new Error('Service worker must activate updates only through the explicit SKIP_WAITING path');
}

const assetsDir = path.join(dist, 'assets');
const assets = await readdir(assetsDir);
const javascript = assets.filter((file) => file.endsWith('.js'));
const styles = assets.filter((file) => file.endsWith('.css'));
if (javascript.length === 0 || styles.length === 0) {
  throw new Error('Production PWA shell is missing compiled JavaScript or CSS');
}
const bundle = await readFile(path.join(assetsDir, javascript[0]), 'utf8');
if (!bundle.includes('sw.js') || !bundle.includes('SKIP_WAITING')) {
  throw new Error('Production JavaScript does not contain PWA registration and update activation');
}

console.log(`[pwa-build] shell=${required.length} js=${javascript.length} css=${styles.length} manifest=standalone update=user-approved`);
