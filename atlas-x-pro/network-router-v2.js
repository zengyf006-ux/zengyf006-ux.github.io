(() => {
  'use strict';
  if (window.__ATLAS_STAGE1_LOADER__) return;
  window.__ATLAS_STAGE1_LOADER__ = true;
  document.documentElement.dataset.marketRouter = 'stage1';

  const stylesheet = './realtime-market-chart.css';
  const scripts = [
    './market-data-engine.js',
    './chart-experience.js',
    './realtime-market-integration.js',
  ];

  if (document.readyState === 'loading') {
    document.write(`<link rel="stylesheet" href="${stylesheet}">`);
    scripts.forEach(source => document.write(`<script src="${source}"><\/script>`));
    return;
  }

  if (!document.querySelector(`link[href="${stylesheet}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheet;
    document.head.append(link);
  }

  let chain = Promise.resolve();
  scripts.forEach(source => {
    chain = chain.then(() => new Promise((resolve, reject) => {
      if ([...document.scripts].some(script => script.getAttribute('src') === source)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${source}`));
      document.head.append(script);
    }));
  });
  chain.catch(error => console.error(error));
})();
