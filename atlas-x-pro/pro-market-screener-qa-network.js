(() => {
  'use strict';
  if (!window.__ATLAS_QA_MODE__ || window.__ATLAS_SCREENER_QA_NETWORK__) return;
  window.__ATLAS_SCREENER_QA_NETWORK__ = true;

  // Keep all QA traffic on the deterministic routed fetch installed by the
  // terminal harness. Bypassing it with the captured native fetch caused
  // unrelated public ticker probes to hit regional upstream 503 responses,
  // even though the screener gateway contract itself was fully stubbed.
  // Production mode never loads a fixture and continues to use the real
  // unified public market gateway.
  document.documentElement.dataset.marketScreenerQaNetwork = 'routed';
})();