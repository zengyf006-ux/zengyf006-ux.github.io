(() => {
  'use strict';
  if (window.__ATLAS_AUDIT_MOBILE_CRITICAL__) return;
  window.__ATLAS_AUDIT_MOBILE_CRITICAL__ = true;

  const STYLE_ID = 'atlas-audit-mobile-critical-style';

  function install() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @media (max-width: 820px) {
        .account-tabs button[data-account-tab="audit"] {
          min-height: 46px !important;
          height: 46px !important;
          padding-block: 0 !important;
          touch-action: manipulation !important;
        }
        .execution-audit-filters button {
          min-height: 44px !important;
          height: 44px !important;
          touch-action: manipulation !important;
        }
        .execution-audit-row[data-audit-record-id] {
          min-height: 100px !important;
          touch-action: manipulation !important;
        }
        .execution-audit-entry,
        [data-audit-detail-close] {
          min-height: 44px !important;
          height: 44px !important;
          touch-action: manipulation !important;
        }
      }
    `;
    document.head.append(style);
  }

  install();
  document.documentElement.dataset.auditMobileCritical = 'ready';
})();
