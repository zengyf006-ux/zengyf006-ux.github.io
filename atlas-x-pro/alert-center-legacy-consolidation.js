(() => {
  'use strict';
  if (window.__ATLAS_ALERT_LEGACY_CONSOLIDATION__) return;
  window.__ATLAS_ALERT_LEGACY_CONSOLIDATION__ = true;

  const LEGACY_KEY = 'atlasX.pro.price-alerts.v1';
  const STAGING_KEY = 'atlasX.pro.alertCenter.legacyStaging.v1';
  const MIGRATION_KEY = 'atlasX.pro.alertCenter.legacyMigrated.v1';

  function readArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function symbolFromPair(pair) {
    return String(pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function migrateLegacyRules() {
    if (localStorage.getItem(MIGRATION_KEY)) return 0;
    const staged = readArray(STAGING_KEY);
    const api = window.AtlasAlertCenter;
    const existing = new Set((api?.getState?.().rules || []).map(rule => [
      String(rule.symbol || '').toUpperCase(),
      String(rule.type || ''),
      Number(rule.threshold || 0).toPrecision(12),
    ].join('|')));
    let migrated = 0;

    staged.forEach(alert => {
      if (!alert || alert.triggered === true) return;
      const symbol = symbolFromPair(alert.pair);
      const threshold = Number(alert.price);
      const type = alert.condition === 'below' ? 'price_below' : 'price_above';
      if (!symbol || !(threshold > 0)) return;
      const fingerprint = [symbol, type, threshold.toPrecision(12)].join('|');
      if (existing.has(fingerprint)) return;
      const result = api?.createPriceRule?.({ symbol, type, threshold });
      if (result?.ok) {
        existing.add(fingerprint);
        migrated += 1;
      }
    });

    try {
      localStorage.setItem(MIGRATION_KEY, JSON.stringify({
        version: 1,
        migrated,
        migratedAt: Date.now(),
      }));
    } catch {}
    return migrated;
  }

  function removeLegacyUi() {
    document.querySelectorAll('[data-open-price-alert]').forEach(element => element.remove());
    document.querySelector('#priceAlertPanel')?.remove();
  }

  function finalizeLegacyStorage() {
    try {
      localStorage.setItem(LEGACY_KEY, '[]');
      localStorage.removeItem(STAGING_KEY);
    } catch {}
  }

  const migrated = migrateLegacyRules();
  removeLegacyUi();
  finalizeLegacyStorage();

  // Preserve the former Alt+A workflow, but route it to the single professional center.
  document.addEventListener('keydown', event => {
    if (!event.altKey || event.key.toLowerCase() !== 'a') return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.AtlasAlertCenter?.open?.();
  }, true);

  document.documentElement.dataset.alertEntryConsolidated = 'ready';
  document.documentElement.dataset.legacyAlertsMigrated = String(migrated);
})();
