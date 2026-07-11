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
    [
      './refinements.css',
      './release-polish.css',
      './terminal-quality.css',
      './mobile-final.css',
      './chart-pro-tools.css',
      './chart-trading-layer.css',
      './trading-advanced.css',
      './advanced-visual-final.css',
      './execution-guard.css',
      './performance-analytics.css',
      './performance-layout-polish.css',
      './portfolio-risk.css',
      './risk-position-sizing.css',
      './advanced-order-oco.css',
      './advanced-exit-strategies.css',
      './reservation-coordinator.css',
      './workspace-command-center.css',
      './workspace-command-center-compat.css',
      './pro-alert-center.css',
      './pro-alert-center-mobile.css',
      './order-execution-audit.css',
      './market-intelligence.css',
      './market-intelligence-polish.css',
      './mobile-account-tools.css',
      './data-health.css',
      './semantic-typography.css',
    ].forEach(ensureStyle);

    try {
      if (!document.querySelector('.ticket-context') || !document.querySelector('#controlPopover')) {
        await loadScript('./pro-polish.js');
      }
      await loadScript('./module-upgrades.js');
      await loadScript('./terminal-quality.js');
      await loadScript('./chart-pro-tools.js');
      await loadScript('./chart-trading-layer.js');
      await loadScript('./alert-center-legacy-preflight.js');
      await loadScript('./trading-advanced.js');
      await loadScript('./advanced-stability.js');
      await loadScript('./data-health.js');
      await loadScript('./execution-guard.js');
      await loadScript('./performance-analytics.js');
      await loadScript('./portfolio-risk.js');
      await loadScript('./risk-position-sizing.js');
      await loadScript('./advanced-order-oco.js');
      await loadScript('./advanced-exit-strategies.js');
      await loadScript('./reservation-coordinator.js');
      await loadScript('./workspace-command-center.js');
      await loadScript('./workspace-command-center-compat.js');
      await loadScript('./pro-alert-center.js');
      await loadScript('./pro-alert-draft-stability.js');
      await loadScript('./pro-alert-center-mobile.js');
      await loadScript('./alert-center-legacy-consolidation.js');
      await loadScript('./order-execution-audit.js');
      await loadScript('./market-intelligence.js');
      await loadScript('./market-intelligence-entry-compat.js');
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
