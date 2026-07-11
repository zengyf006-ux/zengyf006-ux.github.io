(() => {
  'use strict';
  if (window.__ATLAS_ALERT_LEGACY_PREFLIGHT__) return;
  window.__ATLAS_ALERT_LEGACY_PREFLIGHT__ = true;

  const LEGACY_KEY = 'atlasX.pro.price-alerts.v1';
  const STAGING_KEY = 'atlasX.pro.alertCenter.legacyStaging.v1';
  const MIGRATION_KEY = 'atlasX.pro.alertCenter.legacyMigrated.v1';

  function readLegacy() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.slice(-30) : [];
    } catch {
      return [];
    }
  }

  const legacy = readLegacy();
  const alreadyMigrated = Boolean(localStorage.getItem(MIGRATION_KEY));

  if (!alreadyMigrated && legacy.length) {
    try { localStorage.setItem(STAGING_KEY, JSON.stringify(legacy)); } catch {}
  }

  // The old module loads next. Feed it an inert copy so its private observer can
  // never emit duplicate toasts while the new center performs the migration.
  const inert = legacy.map(alert => ({ ...alert, triggered: true, migratedToProfessionalCenter: true }));
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(alreadyMigrated ? [] : inert)); } catch {}

  document.documentElement.dataset.alertLegacyPreflight = 'ready';
})();
