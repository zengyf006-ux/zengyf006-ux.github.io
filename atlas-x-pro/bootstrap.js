(() => {
  'use strict';
  if (window.__ATLAS_PRO_BOOTSTRAPPED__) return;
  window.__ATLAS_PRO_BOOTSTRAPPED__ = true;

  const STYLE_HREFS = [
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
    './pro-market-screener.css',
    './pro-market-screener-touch.css',
    './mobile-account-tools.css',
    './data-health.css',
    './semantic-typography.css',
    './continuous-hardening.css',
    './perpetual-trading.css',
  ];

  const ensureStyle = href => new Promise((resolve, reject) => {
    const absolute = new URL(href, document.baseURI).href;
    const loadedSheet = [...document.styleSheets].find(sheet => sheet.href === absolute);
    if (loadedSheet) {
      resolve();
      return;
    }

    let link = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find(candidate => candidate.href === absolute);
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.append(link);
    }

    if (link.sheet || link.dataset.loaded === 'true') {
      link.dataset.loaded = 'true';
      resolve();
      return;
    }

    const onLoad = () => {
      link.dataset.loaded = 'true';
      resolve();
    };
    const onError = () => reject(new Error(`Failed to load stylesheet: ${href}`));
    link.addEventListener('load', onLoad, { once: true });
    link.addEventListener('error', onError, { once: true });
  });

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
    try {
      document.documentElement.dataset.atlasQuality = 'booting';
      await Promise.all(STYLE_HREFS.map(ensureStyle));
      document.documentElement.dataset.atlasQualityStyles = 'ready';

      if (!document.querySelector('.ticket-context') || !document.querySelector('#controlPopover')) {
        await loadScript('./pro-polish.js');
      }
      await loadScript('./module-upgrades.js');
      await loadScript('./terminal-quality.js');
      document.documentElement.dataset.terminalQuality = 'booting';
      await loadScript('./chart-pro-tools.js');
      await loadScript('./chart-trading-layer.js');
      await loadScript('./alert-center-legacy-preflight.js');
      await loadScript('./trading-advanced.js');
      await loadScript('./advanced-stability.js');
      await loadScript('./data-health.js');
      await loadScript('./data-health-stage1.js');
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
      await loadScript('./pro-alert-create-stability.js');
      await loadScript('./pro-alert-tab-stability.js');
      await loadScript('./pro-alert-center-mobile.js');
      await loadScript('./pro-alert-touch-hardening.js');
      await loadScript('./alert-center-legacy-consolidation.js');
      await loadScript('./order-execution-audit-mobile-critical.js');
      await loadScript('./order-execution-audit.js');
      await loadScript('./market-intelligence.js');
      await loadScript('./market-intelligence-entry-compat.js');
      await loadScript('./pro-market-screener.js');
      await loadScript('./pro-market-screener-search-stability.js');
      await loadScript('./mobile-account-tools.js');

      await loadScript('./perpetual-ledger.js');
      await loadScript('./perpetual-risk-engine.js');
      await loadScript('./perpetual-order-engine.js');
      await loadScript('./perpetual-funding-engine.js');
      await loadScript('./perpetual-controller.js');
      await loadScript('./perpetual-trading-ui.js');
      await loadScript('./perpetual-market-readiness.js');

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
