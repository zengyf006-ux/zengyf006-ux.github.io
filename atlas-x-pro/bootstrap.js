(() => {
  'use strict';
  if (window.__ATLAS_PRO_BOOTSTRAPPED__) return;
  window.__ATLAS_PRO_BOOTSTRAPPED__ = true;

  const STYLE_HREFS = [
    './refinements.css', './release-polish.css', './terminal-quality.css', './mobile-final.css',
    './chart-pro-tools.css', './chart-trading-layer.css', './trading-advanced.css', './advanced-visual-final.css',
    './execution-guard.css', './performance-analytics.css', './performance-layout-polish.css', './portfolio-risk.css',
    './risk-position-sizing.css', './advanced-order-oco.css', './advanced-exit-strategies.css', './reservation-coordinator.css',
    './workspace-command-center.css', './workspace-command-center-compat.css', './pro-alert-center.css',
    './pro-alert-center-mobile.css', './order-execution-audit.css', './market-intelligence.css',
    './market-intelligence-polish.css', './pro-market-screener.css', './pro-market-screener-touch.css',
    './mobile-account-tools.css', './data-health.css', './semantic-typography.css', './continuous-hardening.css',
    './perpetual-trading.css',
  ];

  const ensureStyle = href => new Promise((resolve, reject) => {
    const absolute = new URL(href, document.baseURI).href;
    const loadedSheet = [...document.styleSheets].find(sheet => sheet.href === absolute);
    if (loadedSheet) { resolve(); return; }
    let link = [...document.querySelectorAll('link[rel="stylesheet"]')].find(candidate => candidate.href === absolute);
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.append(link);
    }
    if (link.sheet || link.dataset.loaded === 'true') { link.dataset.loaded = 'true'; resolve(); return; }
    link.addEventListener('load', () => { link.dataset.loaded = 'true'; resolve(); }, { once: true });
    link.addEventListener('error', () => reject(new Error(`Failed to load stylesheet: ${href}`)), { once: true });
  });

  const loadScript = src => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.body.append(script);
  });

  async function start() {
    try {
      document.documentElement.dataset.atlasQuality = 'booting';
      await Promise.all(STYLE_HREFS.map(ensureStyle));
      document.documentElement.dataset.atlasQualityStyles = 'ready';

      if (!document.querySelector('.ticket-context') || !document.querySelector('#controlPopover')) await loadScript('./pro-polish.js');
      for (const src of [
        './module-upgrades.js', './terminal-quality.js', './chart-pro-tools.js', './chart-trading-layer.js',
        './alert-center-legacy-preflight.js', './trading-advanced.js', './advanced-stability.js', './data-health.js',
        './data-health-stage1.js', './execution-guard.js', './performance-analytics.js', './portfolio-risk.js',
        './risk-position-sizing.js', './advanced-order-oco.js', './advanced-exit-strategies.js', './reservation-coordinator.js',
        './workspace-command-center.js', './workspace-command-center-compat.js', './pro-alert-center.js',
        './pro-alert-draft-stability.js', './pro-alert-create-stability.js', './pro-alert-tab-stability.js',
        './pro-alert-center-mobile.js', './pro-alert-touch-hardening.js', './alert-center-legacy-consolidation.js',
        './order-execution-audit-mobile-critical.js', './order-execution-audit.js', './market-intelligence.js',
        './market-intelligence-entry-compat.js', './pro-market-screener.js', './pro-market-screener-search-stability.js',
        './mobile-account-tools.js',
      ]) await loadScript(src);

      document.documentElement.dataset.terminalQuality = 'booting';
      for (const src of [
        './perpetual-ledger.js', './perpetual-risk-engine.js', './perpetual-order-engine.js',
        './perpetual-funding-engine.js', './perpetual-controller.js', './perpetual-trading-ui.js',
        './perpetual-market-readiness.js', './perpetual-submit-owner.js',
      ]) await loadScript(src);

      document.documentElement.dataset.atlasQuality = 'ready';
      document.documentElement.dataset.terminalQuality = 'ready';
    } catch (error) {
      document.documentElement.dataset.atlasQuality = 'failed';
      console.error('ATLAS quality bootstrap failed', error);
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => queueMicrotask(start), { once: true })
    : queueMicrotask(start);
})();
