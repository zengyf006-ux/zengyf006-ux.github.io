(() => {
  'use strict';
  if (window.__ATLAS_MARKET_ENTRY_COMPAT__) return;
  window.__ATLAS_MARKET_ENTRY_COMPAT__ = true;

  function openMarkets() {
    document.querySelector('#marketSheetClose')?.click();
    const navigation = document.querySelector('[data-main-nav="markets"]');
    if (!navigation) return false;
    navigation.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    }));
    return true;
  }

  document.addEventListener('click', event => {
    const entry = event.target.closest('.mobile-market-center-button');
    if (!entry) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openMarkets();
  }, true);

  document.documentElement.dataset.marketEntryCompat = 'ready';
})();
