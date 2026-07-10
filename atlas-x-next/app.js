(() => {
  'use strict';

  const core = document.createElement('script');
  core.src = './app-core.js';
  core.async = false;

  const desiredRows = () => {
    const panel = document.querySelector('.orderbook-panel');
    const height = panel?.clientHeight || 500;
    if (window.innerWidth < 821) return 6;
    if (height < 470) return 6;
    if (height < 620) return 8;
    return 10;
  };

  const pruneBook = () => {
    const target = desiredRows();
    const asks = document.querySelector('#askRows');
    const bids = document.querySelector('#bidRows');
    const trades = document.querySelector('#tradeRows');

    if (asks) {
      while (asks.children.length > target) asks.firstElementChild?.remove();
    }
    if (bids) {
      while (bids.children.length > target) bids.lastElementChild?.remove();
    }
    if (trades) {
      while (trades.children.length > Math.max(target * 2, 12)) trades.lastElementChild?.remove();
    }
  };

  const installRefinement = () => {
    const observer = new MutationObserver(pruneBook);
    ['#askRows', '#bidRows', '#tradeRows'].forEach(selector => {
      const node = document.querySelector(selector);
      if (node) observer.observe(node, { childList: true });
    });
    pruneBook();
    window.addEventListener('resize', pruneBook, { passive: true });
  };

  core.addEventListener('load', () => {
    window.setTimeout(installRefinement, 0);
  });
  document.head.appendChild(core);
})();
