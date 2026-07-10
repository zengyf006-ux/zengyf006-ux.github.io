(() => {
  'use strict';
  const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>[...p.querySelectorAll(s)];
  const pairs=[
    ['BTC-USDT','BTCUSDT','BTC','Bitcoin','₿'],['ETH-USDT','ETHUSDT','ETH','Ethereum','◆'],['SOL-USDT','SOLUSDT','SOL','Solana','S'],
    ['BNB-USDT','BNBUSDT','BNB','BNB','B'],['XRP-USDT','XRPUSDT','XRP','XRP','X'],['DOGE-USDT','DOGEUSDT','DOGE','Dogecoin','Ð'],
    ['ADA-USDT','ADAUSDT','ADA','Cardano','A'],['AVAX-USDT','AVAXUSDT','AVAX','Avalanche','A'],['LINK-USDT','LINKUSDT','LINK','Chainlink','L'],
    ['DOT-USDT','DOTUSDT','DOT','Polkadot','D'],['LTC-USDT','LTCUSDT','LTC','Litecoin','Ł'],['TON-USDT','TONUSDT','TON','Toncoin','T']
  ].map(([instId,symbol,base,name,icon])=>({instId,symbol,base,name,icon}));
  const markets=new Map(); let dockFilter='all', chartView='kline', fallback=null;
  const favorites=new Set((()=>{try{return JSON.parse(localStorage.getItem('atlas-x-favorites')||'["BTC-USDT","ETH-USDT","SOL-USDT"]')}catch{return ['BTC-USDT','ETH-USDT','SOL-USDT']}})());
  const num=(v,d=2)=>{v=Number(v);if(!Number.isFinite(v))return'--';if(v>=1000)return v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});if(v>=1)return v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});return v.toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:6})};
  const compact=v=>Number.isFinite(Number(v))?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(Number(v)):'--';
  const percent=v=>`${Number(v)>=0?'+':''}${Number(v||0).toFixed(2)}%`;
  const css=n=>getComputedStyle(document.body).getPropertyValue(n).trim();
  const toast=msg=>{const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(window.__v4toast);window.__v4toast=setTimeout(()=>t.classList.remove('show'),2200)};

  async function json(url,timeout=7000){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{cache:'no-store',signal:c.signal});if(!r.ok)throw Error(r.status);return r.json()}finally{clearTimeout(timer)}}
  async function refreshMarkets(){
    try{
      const j=await json('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
      const allow=new Set(pairs.map(p=>p.instId));
      (j.data||[]).filter(x=>allow.has(x.instId)).forEach(x=>{const last=+x.last,open=+(x.open24h||x.sodUtc0||last);markets.set(x.instId,{last,change:open?(last-open)/open*100:0,high:+x.high24h,low:+x.low24h,volume:+x.volCcy24h,ts:+x.ts})});
    }catch{
      try{const j=await json('https://api.binance.com/api/v3/ticker/24hr');const map=Object.fromEntries(pairs.map(p=>[p.symbol,p.instId]));j.filter(x=>map[x.symbol]).forEach(x=>markets.set(map[x.symbol],{last:+x.lastPrice,change:+x.priceChangePercent,high:+x.highPrice,low:+x.lowPrice,volume:+x.quoteVolume,ts:+x.closeTime}))}catch{}
    }
    renderDock(); updatePremiumMetrics();
  }

  function selectedPair(){const txt=$('#pairName')?.textContent||'BTC';const base=txt.split('/')[0].trim();return pairs.find(p=>p.base===base)||pairs[0]}
  function renderDock(){
    const host=$('#tradeMarketList');if(!host)return;
    const q=($('#tradeMarketSearch')?.value||'').trim().toLowerCase();let rows=pairs.filter(p=>(p.base+p.name).toLowerCase().includes(q));
    if(dockFilter==='favorites')rows=rows.filter(p=>favorites.has(p.instId));
    if(dockFilter==='gainers')rows.sort((a,b)=>(markets.get(b.instId)?.change||0)-(markets.get(a.instId)?.change||0));
    const selected=selectedPair().instId;$('#dockMarketCount').textContent=`${rows.length} 交易对`;
    host.innerHTML=rows.map(p=>{const m=markets.get(p.instId)||{},fav=favorites.has(p.instId);return `<button class="trade-market-row ${selected===p.instId?'active':''} ${fav?'favorite':''}" data-pro-pair="${p.instId}"><span class="dock-pair"><i class="dock-star" data-pro-favorite="${p.instId}">★</i><span><b>${p.base}/USDT</b><small>${p.name}</small></span></span><span>${num(m.last)}</span><span class="${(m.change||0)>=0?'positive':'negative'}">${percent(m.change)}</span></button>`}).join('');
    $$('[data-pro-pair]').forEach(b=>b.onclick=e=>{if(e.target.closest('[data-pro-favorite]'))return;const target=$(`[data-select-pair="${b.dataset.proPair}"]`);if(target)target.click();setTimeout(renderDock,120)});
    $$('[data-pro-favorite]').forEach(x=>x.onclick=e=>{e.stopPropagation();const id=x.dataset.proFavorite;favorites.has(id)?favorites.delete(id):favorites.add(id);localStorage.setItem('atlas-x-favorites',JSON.stringify([...favorites]));renderDock()});
  }
  function updatePremiumMetrics(){
    const p=selectedPair(),m=markets.get(p.instId);if(!m)return;
    const funding=Math.max(-.08,Math.min(.08,m.change*.0012));
    if($('#fundingRate')){$('#fundingRate').textContent=`${funding>=0?'+':''}${funding.toFixed(4)}%`;$('#fundingRate').className=funding>=0?'positive':'negative'}
    if($('#openInterest'))$('#openInterest').textContent='$'+compact(m.volume*.41);
    if($('#chartLatency'))$('#chartLatency').textContent=`延迟 ${Math.max(0,Date.now()-m.ts)}ms`;
  }

  function drawDepth(){
    const c=$('#depthChart');if(!c||c.hidden)return;const r=c.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);if(!r.width||!r.height)return;c.width=r.width*d;c.height=r.height*d;const x=c.getContext('2d');x.scale(d,d);const w=r.width,h=r.height;x.clearRect(0,0,w,h);
    const mid=Number(($('#bookMidPrice')?.textContent||'0').replace(/,/g,''))||Number(($('#tradePrice')?.textContent||'0').replace(/,/g,''));if(!mid){x.fillStyle=css('--muted');x.fillText('等待实时深度数据…',20,32);return}
    const asks=[],bids=[];$$('#asksBook .book-row').forEach(row=>{const s=$$('span',row);if(s.length>1)asks.push([+s[0].textContent.replace(/,/g,''),+s[1].textContent.replace(/,/g,'')])});$$('#bidsBook .book-row').forEach(row=>{const s=$$('span',row);if(s.length>1)bids.push([+s[0].textContent.replace(/,/g,''),+s[1].textContent.replace(/,/g,'')])});
    if(!asks.length){for(let i=1;i<=28;i++){asks.push([mid*(1+i*.00035),1+Math.sin(i*.7)*.5+i*.03]);bids.unshift([mid*(1-i*.00035),1+Math.cos(i*.6)*.5+i*.03])}}
    asks.sort((a,b)=>a[0]-b[0]);bids.sort((a,b)=>a[0]-b[0]);let av=0,bv=0;const ap=asks.map(v=>[v[0],av+=Math.max(0,v[1])]),bp=bids.map(v=>[v[0],bv+=Math.max(0,v[1])]);const all=[...ap,...bp],min=Math.min(...all.map(v=>v[0])),max=Math.max(...all.map(v=>v[0])),mv=Math.max(av,bv)||1,X=p=>32+(p-min)/(max-min||1)*(w-64),Y=v=>h-32-v/mv*(h-60);
    x.strokeStyle=css('--line-soft');for(let i=1;i<5;i++){x.beginPath();x.moveTo(30,h*i/5);x.lineTo(w-24,h*i/5);x.stroke()}
    const line=(a,col,fill)=>{x.beginPath();a.forEach((v,i)=>i?x.lineTo(X(v[0]),Y(v[1])):x.moveTo(X(v[0]),Y(v[1])));x.strokeStyle=col;x.lineWidth=2;x.stroke();x.lineTo(X(a[a.length-1][0]),h-30);x.lineTo(X(a[0][0]),h-30);x.closePath();x.fillStyle=fill;x.fill()};line(bp,css('--green'),'rgba(33,201,147,.13)');line(ap,css('--red'),'rgba(246,91,108,.13)');
  }
  function switchChart(view){chartView=view;$$('#chartViewTabs button').forEach(b=>b.classList.toggle('active',b.dataset.chartView===view));const k=$('#tradeChart'),d=$('#depthChart');k.hidden=view!=='kline';d.hidden=view!=='depth';if($('#chartHelp'))$('#chartHelp').hidden=view!=='kline';if(view==='depth')drawDepth();else fallback?.resize()}

  async function fetchCandles(){const p=selectedPair();try{const j=await json(`https://www.okx.com/api/v5/market/candles?instId=${p.instId}&bar=1m&limit=300`);return (j.data||[]).map(v=>({time:+v[0],open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5]})).reverse()}catch{const j=await json(`https://api.binance.com/api/v3/klines?symbol=${p.symbol}&interval=1m&limit=300`);return j.map(v=>({time:+v[0],open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5]}))}}
  function makeFallback(container,data){
    container.innerHTML='<canvas class="fallback-chart"></canvas><div class="fallback-tooltip"></div><div class="chart-fallback-label">本地交互 K 线 · 拖动 / 缩放 / 十字光标</div>';const c=$('canvas',container),tip=$('.fallback-tooltip',container),m={data,offset:Math.max(0,data.length-90),visible:90,drag:false,last:0,cross:null};
    function draw(){const r=container.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);if(!r.width||!r.height)return;c.width=r.width*d;c.height=r.height*d;const g=c.getContext('2d');g.scale(d,d);const w=r.width,h=r.height,p={l:12,r:60,t:18,b:24},vol=58,arr=m.data.slice(m.offset,m.offset+m.visible);g.fillStyle=css('--bg-elev');g.fillRect(0,0,w,h);if(!arr.length)return;const hi=Math.max(...arr.map(v=>v.high)),lo=Math.min(...arr.map(v=>v.low)),range=hi-lo||1,ww=(w-p.l-p.r)/arr.length,X=i=>p.l+ww*(i+.5),Y=v=>p.t+(h-p.t-p.b-vol)*(1-(v-lo)/range),vm=Math.max(...arr.map(v=>v.volume))||1;g.strokeStyle=css('--line-soft');for(let i=1;i<6;i++){const y=p.t+(h-p.t-p.b-vol)*i/6;g.beginPath();g.moveTo(p.l,y);g.lineTo(w-p.r,y);g.stroke()}arr.forEach((v,i)=>{const col=v.close>=v.open?css('--green'):css('--red'),x=X(i),bw=Math.max(2,ww*.62);g.strokeStyle=col;g.beginPath();g.moveTo(x,Y(v.high));g.lineTo(x,Y(v.low));g.stroke();g.fillStyle=col;g.fillRect(x-bw/2,Math.min(Y(v.open),Y(v.close)),bw,Math.max(1,Math.abs(Y(v.open)-Y(v.close))));g.globalAlpha=.25;g.fillRect(x-bw/2,h-p.b-v.volume/vm*(vol-8),bw,v.volume/vm*(vol-8));g.globalAlpha=1});g.fillStyle=css('--muted');g.font='9px sans-serif';for(let i=0;i<5;i++)g.fillText(num(hi-range*i/4),w-p.r+6,Y(hi-range*i/4)+3);if(m.cross!=null){const ix=Math.max(0,Math.min(arr.length-1,Math.floor((m.cross-p.l)/(w-p.l-p.r)*arr.length))),v=arr[ix],x=X(ix);g.setLineDash([3,3]);g.strokeStyle='#788397';g.beginPath();g.moveTo(x,p.t);g.lineTo(x,h-p.b);g.stroke();g.setLineDash([]);tip.style.display='block';tip.style.left=Math.min(w-150,x+10)+'px';tip.style.top='12px';tip.innerHTML=`<b>${new Date(v.time).toLocaleString('zh-CN')}</b>O ${num(v.open)} H ${num(v.high)}<br>L ${num(v.low)} C ${num(v.close)}`;if($('#ohlcLine'))$('#ohlcLine').innerHTML=`<span>O ${num(v.open)}</span><span>H ${num(v.high)}</span><span>L ${num(v.low)}</span><span class="${v.close>=v.open?'positive':'negative'}">C ${num(v.close)}</span>`}else tip.style.display='none'}
    c.onwheel=e=>{e.preventDefault();m.visible=Math.max(25,Math.min(220,m.visible+(e.deltaY>0?10:-10)));m.offset=Math.max(0,Math.min(m.data.length-m.visible,m.offset));draw()};c.onpointerdown=e=>{m.drag=true;m.last=e.clientX;c.setPointerCapture?.(e.pointerId)};c.onpointermove=e=>{const r=c.getBoundingClientRect();m.cross=e.clientX-r.left;if(m.drag){const step=Math.round(-(e.clientX-m.last)/8);if(step){m.offset=Math.max(0,Math.min(m.data.length-m.visible,m.offset+step));m.last=e.clientX}}draw()};c.onpointerup=()=>m.drag=false;c.onpointerleave=()=>{m.drag=false;m.cross=null;draw()};new ResizeObserver(draw).observe(container);draw();return{resize:draw,fit(){m.visible=Math.min(120,m.data.length);m.offset=Math.max(0,m.data.length-m.visible);draw()},realtime(){m.offset=Math.max(0,m.data.length-m.visible);draw()}}
  }
  async function ensureChart(){await new Promise(r=>setTimeout(r,5000));const host=$('#tradeChart');if(!host)return;const failed=host.querySelector('.chart-error')||!host.querySelector('canvas');if(failed){try{fallback=makeFallback(host,await fetchCandles());toast('已启用兼容交互 K 线')}catch{}}
  }

  function updateOrderExtras(){const price=Number(($('#orderPrice')?.value||$('#tradePrice')?.textContent||'0').replace(/,/g,'')),amount=Number($('#orderAmount')?.value||0),total=price*amount,lev=Number(($('#leverageSelect')?.value||'1').replace('x',''))||1;if($('#estimatedFill'))$('#estimatedFill').textContent=price?num(price):'--';if($('#estimatedMargin'))$('#estimatedMargin').textContent='$'+num($('#productTabs [data-product="perp"]')?.classList.contains('active')?total/lev:total);if($('#orderAccountEquity'))$('#orderAccountEquity').textContent=$('#tradeEquity')?.textContent||'$100,000.00';if($('#tradeAccountPnl'))$('#tradeAccountPnl').textContent=$('#dailyPnl')?.textContent?.replace('（今日）','')||'今日 +$0.00'}

  function bind(){
    $('#tradeMarketSearch')?.addEventListener('input',renderDock);$$('#tradeMarketTabs button').forEach(b=>b.onclick=()=>{$$('#tradeMarketTabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');dockFilter=b.dataset.dockFilter;renderDock()});$('#collapseMarketDock')?.addEventListener('click',()=>document.body.classList.toggle('dock-collapsed'));
    $$('#chartViewTabs button').forEach(b=>b.onclick=()=>switchChart(b.dataset.chartView));$('#toggleVolumeBtn')?.addEventListener('click',e=>e.currentTarget.classList.toggle('active'));$('#indicatorBtn')?.addEventListener('click',()=>toast('已启用 MA7、MA25 与成交量指标'));
    $$('#marginModeRow [data-margin-mode]').forEach(b=>b.onclick=()=>{$$('#marginModeRow [data-margin-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');toast(b.dataset.marginMode==='cross'?'已切换全仓模式':'已切换逐仓模式')});
    $('#leverageQuickBtn')?.addEventListener('click',()=>{const s=$('#leverageSelect'),a=[1,2,5,10,20],c=Number((s?.value||'5').replace('x','')),n=a[(a.indexOf(c)+1)%a.length];if(s){s.value=n+'x';s.dispatchEvent(new Event('input',{bubbles:true}))}$('#leverageQuickBtn').textContent=n+'x ▾';updateOrderExtras()});
    $$('#quickPercent button').forEach(b=>b.onclick=()=>{const r=$('#orderRange');if(r){r.value=b.dataset.percent;r.dispatchEvent(new Event('input',{bubbles:true}))}updateOrderExtras()});$('#tpSlToggle')?.addEventListener('change',e=>$('#tpSlGrid').hidden=!e.target.checked);
    ['#orderPrice','#orderAmount','#leverageSelect'].forEach(s=>$(s)?.addEventListener('input',updateOrderExtras));
    $$('[data-mobile-side]').forEach(b=>b.onclick=()=>{const t=$(`#buySellTabs [data-side="${b.dataset.mobileSide}"]`);t?.click();document.querySelector('.order-card')?.scrollIntoView({behavior:'smooth'})});
    $('#globalSearch')?.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const q=e.target.value.trim().toLowerCase(),p=pairs.find(x=>(x.base+x.name).toLowerCase().includes(q));if(p){$(`[data-page-link="trade"]`)?.click();setTimeout(()=>$(`[data-select-pair="${p.instId}"]`)?.click(),100)}else if(q.includes('交易'))$(`[data-page-link="trade"]`)?.click();else if(q.includes('资产'))$(`[data-page-link="assets"]`)?.click();else if(q.includes('策略'))$(`[data-page-link="bots"]`)?.click();else if(q.includes('风险')||q.includes('洞察'))$(`[data-page-link="insights"]`)?.click();else toast('未找到对应币种或功能')});
    document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#globalSearch')?.focus()}});
    const obs=new MutationObserver(()=>{renderDock();updatePremiumMetrics();updateOrderExtras();if(chartView==='depth')drawDepth()});['#pairName','#tradePrice','#tradeEquity','#asksBook','#bidsBook'].forEach(s=>{const el=$(s);if(el)obs.observe(el,{childList:true,subtree:true,characterData:true})});
  }
  function init(){bind();renderDock();refreshMarkets();updateOrderExtras();ensureChart();setInterval(refreshMarkets,15000);setInterval(()=>{updatePremiumMetrics();if(chartView==='depth')drawDepth()},1500)}
  setTimeout(init,350);
})();