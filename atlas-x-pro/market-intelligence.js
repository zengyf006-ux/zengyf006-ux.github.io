(() => {
  'use strict';
  if (window.__ATLAS_MARKET_INTELLIGENCE__) return;
  window.__ATLAS_MARKET_INTELLIGENCE__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let activeFilter = 'all';
  let refreshTimer = 0;

  function numberFrom(value) {
    return Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    })[character]);
  }

  function readMarkets() {
    return $$('#marketList .market-row').map(row => {
      const symbol = row.dataset.symbol || '';
      const pair = $('.pair-cell b', row)?.textContent?.replace(/\s+/g, '') || symbol;
      const name = $('.pair-cell > span > small:last-child', row)?.textContent?.trim() || '';
      const priceText = $('.price-cell', row)?.textContent?.trim() || '--';
      const changeText = $('.change-cell', row)?.textContent?.trim() || '0.00%';
      const price = numberFrom(priceText.replace(/,/g, ''));
      const change = numberFrom(changeText);
      return {
        symbol,
        pair,
        name,
        price,
        priceText,
        change,
        icon: $('.pair-cell i', row)?.textContent?.trim() || pair.charAt(0),
        active: row.classList.contains('active'),
        direction: change > 0 ? 'advancers' : change < 0 ? 'decliners' : 'flat',
      };
    }).filter(item => item.symbol && Number.isFinite(item.price) && Number.isFinite(item.change));
  }

  function calculate(markets) {
    const changes = markets.map(item => item.change).sort((a, b) => a - b);
    const advancers = markets.filter(item => item.change > 0).length;
    const decliners = markets.filter(item => item.change < 0).length;
    const flat = markets.length - advancers - decliners;
    const median = changes.length
      ? changes.length % 2
        ? changes[Math.floor(changes.length / 2)]
        : (changes[changes.length / 2 - 1] + changes[changes.length / 2]) / 2
      : 0;
    const mean = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
    const dispersion = changes.length
      ? Math.sqrt(changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / changes.length)
      : 0;
    const ranked = [...markets].sort((a, b) => b.change - a.change || a.symbol.localeCompare(b.symbol));
    const topGainer = ranked[0] || { symbol: '', pair: '--', change: 0 };
    const topLoser = ranked.at(-1) || { symbol: '', pair: '--', change: 0 };
    const breadth = markets.length ? advancers / markets.length * 100 : 0;
    let regime = '震荡';
    let regimeClass = 'warning';
    if (breadth >= 75 && median > 0) {
      regime = '强势偏多';
      regimeClass = 'positive';
    } else if (breadth >= 58 && median >= 0) {
      regime = '偏多';
      regimeClass = 'positive';
    } else if (breadth <= 25 && median < 0) {
      regime = '强势偏空';
      regimeClass = 'negative';
    } else if (breadth <= 42 && median <= 0) {
      regime = '偏空';
      regimeClass = 'negative';
    }
    const buckets = [
      { label: '跌幅 ≥ 2%', count: markets.filter(item => item.change <= -2).length, color: '#f15b70' },
      { label: '跌幅 < 2%', count: markets.filter(item => item.change > -2 && item.change < 0).length, color: '#bd5667' },
      { label: '涨幅 < 2%', count: markets.filter(item => item.change >= 0 && item.change < 2).length, color: '#2b9f80' },
      { label: '涨幅 ≥ 2%', count: markets.filter(item => item.change >= 2).length, color: '#21c997' },
    ];
    return { markets, ranked, advancers, decliners, flat, median, mean, dispersion, topGainer, topLoser, breadth, regime, regimeClass, buckets };
  }

  function signed(value, digits = 2) {
    return `${value >= 0 ? '+' : ''}${Number(value || 0).toFixed(digits)}%`;
  }

  function stat(label, value, note, className = '') {
    return `<article class="market-intelligence-stat"><span>${label}</span><b class="${className}">${value}</b><small>${note}</small></article>`;
  }

  function heatStyle(change) {
    const intensity = Math.min(1, Math.abs(change) / 3);
    if (change > 0) {
      return `--heat-bg:rgba(33,201,151,${(0.07 + intensity * 0.27).toFixed(3)});--heat-border:rgba(33,201,151,${(0.18 + intensity * 0.35).toFixed(3)})`;
    }
    if (change < 0) {
      return `--heat-bg:rgba(241,91,112,${(0.07 + intensity * 0.27).toFixed(3)});--heat-border:rgba(241,91,112,${(0.18 + intensity * 0.35).toFixed(3)})`;
    }
    return '--heat-bg:rgba(124,140,255,.08);--heat-border:rgba(124,140,255,.20)';
  }

  function heatmapMarkup(data) {
    return data.ranked.map(item => `<button class="market-heat-tile ${item.change >= 0 ? 'positive' : 'negative'}" type="button" data-intelligence-symbol="${escapeHtml(item.symbol)}" data-direction="${item.direction}" style="${heatStyle(item.change)}"><strong>${escapeHtml(item.pair)}</strong><b>${signed(item.change)}</b><small>${escapeHtml(item.name)}</small><span>${escapeHtml(item.priceText)}</span></button>`).join('');
  }

  function moverMarkup(label, item, className) {
    return `<article class="market-mover-card"><span>${label}</span><b>${escapeHtml(item.pair)}</b><strong class="${className}">${signed(item.change)}</strong></article>`;
  }

  function distributionMarkup(data) {
    return data.buckets.map(bucket => {
      const width = data.markets.length ? bucket.count / data.markets.length * 100 : 0;
      return `<div class="market-distribution-bar"><span>${bucket.label}</span><i style="--bucket-width:${width}%;--bucket-color:${bucket.color}"></i><b>${bucket.count}</b></div>`;
    }).join('');
  }

  function rankingMarkup(data) {
    const maxChange = Math.max(...data.markets.map(item => Math.abs(item.change)), 1);
    return data.ranked.map((item, index) => {
      const strength = Math.max(3, Math.abs(item.change) / maxChange * 100);
      const color = item.change >= 0 ? 'var(--green)' : 'var(--red)';
      const cls = item.change >= 0 ? 'positive' : 'negative';
      return `<button class="market-intelligence-row" type="button" data-symbol="${escapeHtml(item.symbol)}" data-intelligence-symbol="${escapeHtml(item.symbol)}" data-direction="${item.direction}"><span class="rank">${String(index + 1).padStart(2, '0')}</span><span class="market-intelligence-asset"><b>${escapeHtml(item.pair)}</b><small>${escapeHtml(item.name)}</small></span><span class="market-intelligence-price">${escapeHtml(item.priceText)}</span><span class="market-intelligence-change ${cls}">${signed(item.change)}</span><span class="market-strength"><i style="--strength:${strength}%;--strength-color:${color}"></i><b>${Math.abs(item.change).toFixed(2)}</b></span></button>`;
    }).join('');
  }

  function dashboardMarkup(data) {
    const medianClass = data.median >= 0 ? 'positive' : 'negative';
    return `<div class="market-intelligence-dashboard">
      <header class="module-header"><div><h1>实时市场情报</h1><p>从当前观察市场实时计算涨跌广度、强弱分布、离散度与领涨领跌。</p></div><div class="market-intelligence-regime"><span>市场状态</span><b class="${data.regimeClass}">${data.regime}</b></div><button class="module-close" type="button">返回交易终端</button></header>
      <section class="market-intelligence-summary">
        ${stat('观察市场', String(data.markets.length), '当前 USDT 现货列表')}
        ${stat('上涨广度', `${data.breadth.toFixed(1)}%`, `${data.advancers} 涨 / ${data.decliners} 跌`, data.breadth >= 50 ? 'positive' : 'negative')}
        ${stat('中位涨跌', signed(data.median), '降低极端涨跌干扰', medianClass)}
        ${stat('涨跌离散度', `${data.dispersion.toFixed(2)}%`, '越高代表市场分化越强')}
        ${stat('领涨市场', escapeHtml(data.topGainer.pair), signed(data.topGainer.change), 'positive')}
        ${stat('领跌市场', escapeHtml(data.topLoser.pair), signed(data.topLoser.change), 'negative')}
      </section>
      <section class="market-intelligence-main">
        <article class="market-intelligence-panel"><header><div><strong>市场热力图</strong><span>颜色强度对应绝对涨跌幅</span></div><nav class="market-intelligence-filters" aria-label="行情筛选"><button class="active" type="button" data-market-intelligence-filter="all">全部</button><button type="button" data-market-intelligence-filter="advancers">上涨</button><button type="button" data-market-intelligence-filter="decliners">下跌</button></nav></header><div class="market-heatmap">${heatmapMarkup(data)}</div></article>
        <article class="market-intelligence-panel market-intelligence-side"><header><strong>强弱分布</strong><span>按 24h 涨跌幅分层</span></header><div><div class="market-movers">${moverMarkup('领涨', data.topGainer, 'positive')}${moverMarkup('领跌', data.topLoser, 'negative')}</div><div class="market-distribution"><div class="market-breadth-track" style="--breadth:${data.breadth}%"><i></i><em></em></div><div class="market-breadth-legend"><span>上涨 ${data.advancers}</span><span>平盘 ${data.flat}</span><span>下跌 ${data.decliners}</span></div>${distributionMarkup(data)}</div></div></article>
      </section>
      <section class="market-intelligence-panel market-ranking-panel"><header><strong>市场强弱排名</strong><span>默认按 24h 涨跌幅从高到低</span></header><div class="market-intelligence-head"><span>#</span><span>交易对</span><span>最新价</span><span>24h 涨跌</span><span>相对强度</span></div><div class="market-intelligence-list">${rankingMarkup(data)}</div></section>
      <p class="market-intelligence-note">市场情报仅根据当前观察列表的公开行情计算；行情降级时会使用明确标记的演示数据，不构成投资建议。</p>
    </div>`;
  }

  function applyFilter(filter) {
    activeFilter = filter;
    $$('[data-market-intelligence-filter]').forEach(button => button.classList.toggle('active', button.dataset.marketIntelligenceFilter === filter));
    $$('.market-heat-tile, .market-intelligence-row').forEach(element => {
      element.hidden = filter !== 'all' && element.dataset.direction !== filter;
    });
  }

  function renderOverlay(overlay) {
    const markets = readMarkets();
    if (!overlay || !markets.length) return;
    const data = calculate(markets);
    overlay.dataset.upgraded = 'true';
    overlay.dataset.marketIntelligenceReady = 'true';
    overlay.dataset.marketCount = String(data.markets.length);
    overlay.dataset.advancers = String(data.advancers);
    overlay.dataset.decliners = String(data.decliners);
    overlay.dataset.medianChange = String(data.median);
    overlay.dataset.dispersion = String(data.dispersion);
    overlay.dataset.breadth = String(data.breadth);
    overlay.dataset.topGainer = data.topGainer.symbol;
    overlay.dataset.topLoser = data.topLoser.symbol;
    overlay.innerHTML = dashboardMarkup(data);
    applyFilter(activeFilter);
  }

  function inspect() {
    const overlay = $('.module-overlay[data-module="markets"]');
    if (!overlay) return;
    requestAnimationFrame(() => renderOverlay(overlay));
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const overlay = $('.module-overlay[data-module="markets"]');
      if (overlay) renderOverlay(overlay);
    }, 80);
  }

  function openMarketIntelligence() {
    $('#marketSheetClose')?.click();
    const navigation = $('[data-main-nav="markets"]');
    navigation?.click();
  }

  function createMobileEntry() {
    const head = $('.mobile-market-head');
    const favorite = $('#mobileFavorite');
    if (!head || !favorite || $('.mobile-market-center-button', head)) return;
    const button = document.createElement('button');
    button.className = 'mobile-market-center-button';
    button.type = 'button';
    button.setAttribute('aria-label', '打开实时市场情报');
    button.title = '市场情报';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V9m5 9V5m5 13v-7m5 7V3"/><path d="M3 21h18"/></svg>';
    head.insertBefore(button, favorite);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openMarketIntelligence();
    });
  }

  function bindInteractions() {
    document.addEventListener('click', event => {
      const filter = event.target.closest('[data-market-intelligence-filter]')?.dataset.marketIntelligenceFilter;
      if (filter) {
        event.preventDefault();
        applyFilter(filter);
        return;
      }
      const market = event.target.closest('[data-intelligence-symbol]');
      if (market) {
        const symbol = market.dataset.intelligenceSymbol;
        const source = $(`#marketList [data-symbol="${CSS.escape(symbol)}"]`);
        if (!market.matches('[data-symbol]')) source?.click();
        requestAnimationFrame(() => $('.module-overlay .module-close')?.click());
      }
    });
  }

  function init() {
    createMobileEntry();
    bindInteractions();
    const shell = $('.pro-shell');
    if (shell) new MutationObserver(inspect).observe(shell, { childList: true });
    const marketList = $('#marketList');
    if (marketList) new MutationObserver(scheduleRefresh).observe(marketList, { childList: true, characterData: true, subtree: true });
    inspect();
    document.documentElement.dataset.marketIntelligence = 'ready';
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
