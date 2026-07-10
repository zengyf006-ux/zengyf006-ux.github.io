(() => {
  'use strict';
  if (window.__ATLAS_PRO_BOOTSTRAPPED__) return;
  window.__ATLAS_PRO_BOOTSTRAPPED__ = true;

  const ensureStyle = href => {
    if ([...document.styleSheets].some(sheet => sheet.href?.endsWith(href.replace('./', '/')))) return;
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  };

  const loadScript = src => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.body.append(script);
  });

  async function start() {
    ensureStyle('./refinements.css');
    ensureStyle('./release-polish.css');
    ensureStyle('./terminal-quality.css');
    ensureStyle('./mobile-final.css');
    ensureStyle('./chart-pro-tools.css');
    ensureStyle('./trading-advanced.css');
    ensureStyle('./advanced-visual-final.css');
    ensureStyle('./execution-guard.css');
    ensureStyle('./performance-analytics.css');
    ensureStyle('./performance-layout-polish.css');
    ensureStyle('./mobile-account-tools.css');
    ensureStyle('./semantic-typography.css');

    try {
      if (!document.querySelector('.ticket-context') || !document.querySelector('#controlPopover')) {
        await loadScript('./pro-polish.js');
      }
      await loadScript('./module-upgrades.js');
      await loadScript('./terminal-quality.js');
      await loadScript('./chart-pro-tools.js');
      await loadScript('./trading-advanced.js');
      await loadScript('./advanced-stability.js');
      await loadScript('./execution-guard.js');
      await loadScript('./performance-analytics.js');
      await loadScript('./performance-accounting.js');
      await loadScript('./mobile-account-tools.js');
      document.documentElement.dataset.atlasQuality = 'ready';
    } catch (error) {
      console.error('ATLAS quality bootstrap failed', error);
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => queueMicrotask(start), { once: true })
    : queueMicrotask(start);
})();
