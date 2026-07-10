(() => {
  'use strict';

  const STORAGE_KEY = 'atlasX.pro.v1';
  const FEE_RATE = 0.0008;
  const MARKET_DEFINITIONS = [
    ['BTCUSDT','BTC','Bitcoin','₿',64400,1],['ETHUSDT','ETH','Ethereum','◆',3518,2],
    ['SOLUSDT','SOL','Solana','S',153,2],['BNBUSDT','BNB','BNB','B',598,2],
    ['XRPUSDT','XRP','XRP','X',0.52,4],['DOGEUSDT','DOGE','Dogecoin','Ð',0.124,5],
    ['ADAUSDT','ADA','Cardano','A',0.45,4],['AVAXUSDT','AVAX','Avalanche','A',34.2,2],
    ['LINKUSDT','LINK','Chainlink','L',14.6,3],['DOTUSDT','DOT','Polkadot','D',6.32,3],
    ['LTCUSDT','LTC','Litecoin','Ł',82.4,2],['TRXUSDT','TRX','TRON','T',0.112,5],
  ];
  const MARKETS = Object.fromEntries(MARKET_DEFINITIONS.map(([symbol,base,name,icon,price,precision],index) => [symbol, {
    symbol, base, quote:'USDT', pair:`${base}/USDT`, name, icon, price, open:price*(1-(index%2?.012:-.008)),
    high:price*1.024, low:price*.978, volume:price>1000?8200:price>10?340000:42000000,
    turnover:price*1000000, change:index%3===2?-0.74:1.2+index*.11, precision, updatedAt:0,
  }]));

  const DEFAULT_STATE = {
    activeSymbol:'BTCUSDT', timeframe:'1h', indicator:'ema', side:'buy', orderType:'market',
    accountTab:'positions', mobileView:'chart', marketFilter:'all', bookMode:'all', favorites:['BTCUSDT'],
    cash:100000, positions:[], orders:[], history:[], nextId:1,
  };
  const state = {
    ...structuredClone(DEFAULT_STATE), candles:[], bids:[], asks:[], trades:[], pointerIndex:null,
    chartWindow:78, chartOffset:0, dragStart:null, live:false, activeSocket:null, marketSocket:null,
    demoTimer:null, reconnectTimer:null, lastMessageAt:0, selectedBookPrice:null,
  };

  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
  const market = () => MARKETS[state.activeSymbol];
  const nowText = () => new Date().toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const num = value => Number(String(value ?? '').replace(/[^0-9.-]/g,'')) || 0;
  const fmt = (value,digits=market().precision) => Number(value || 0).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const compact = value => {
    const abs=Math.abs(Number(value)||0); if(abs>=1e9)return `${(value/1e9).toFixed(2)}B`; if(abs>=1e6)return `${(value/1e6).toFixed(2)}M`; if(abs>=1e3)return `${(value/1e3).toFixed(2)}K`; return fmt(value,2);
  };
  const uid = prefix => `${prefix}-${Date.now()}-${state.nextId++}`;

  function loadState(){
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(!saved||typeof saved!=='object')return;
      Object.assign(state,{
        activeSymbol:MARKETS[saved.activeSymbol]?saved.activeSymbol:DEFAULT_STATE.activeSymbol,
        timeframe:['1m','5m','15m','1h','4h','1d'].includes(saved.timeframe)?saved.timeframe:'1h',
        indicator:['ema','boll','volume'].includes(saved.indicator)?saved.indicator:'ema',
        side:saved.side==='sell'?'sell':'buy', orderType:['market','limit','stop'].includes(saved.orderType)?saved.orderType:'market',
        accountTab:['positions','orders','history','balances'].includes(saved.accountTab)?saved.accountTab:'positions',
        mobileView:['chart','book','trades','account'].includes(saved.mobileView)?saved.mobileView:'chart',
        marketFilter:['all','favorite','gainers'].includes(saved.marketFilter)?saved.marketFilter:'all',
        bookMode:['all','bids','asks'].includes(saved.bookMode)?saved.bookMode:'all',
        favorites:Array.isArray(saved.favorites)?saved.favorites.filter(x=>MARKETS[x]):['BTCUSDT'],
        cash:Number.isFinite(saved.cash)?saved.cash:100000,
        positions:Array.isArray(saved.positions)?saved.positions:[], orders:Array.isArray(saved.orders)?saved.orders:[],
        history:Array.isArray(saved.history)?saved.history:[], nextId:Number(saved.nextId)||1,
      });
    }catch{}
  }
  function saveState(){
    try{
      const keys=['activeSymbol','timeframe','indicator','side','orderType','accountTab','mobileView','marketFilter','bookMode','favorites','cash','positions','orders','history','nextId'];
      const payload={}; keys.forEach(key=>payload[key]=state[key]); localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));
    }catch{}
  }

  function seededRandom(seed){let x=seed%2147483647;if(x<=0)x+=2147483646;return()=> (x=x*16807%2147483647)/2147483647;}
  function createDemoCandles(symbol=state.activeSymbol,count=180){
    const current=MARKETS[symbol],random=seededRandom([...symbol].reduce((a,c)=>a+c.charCodeAt(0),17)+state.timeframe.length*31);
    const scale=current.price*(current.price>1000?.006:current.price>10?.01:.018);let close=current.price*.94;const out=[];
    for(let i=0;i<count;i++){
      const open=close;close=open+(random()-.47)*scale+(i>count*.55?scale*.08:scale*.025);
      const high=Math.max(open,close)+random()*scale*.38,low=Math.min(open,close)-random()*scale*.36;
      out.push({time:Date.now()-(count-i)*60000,open,high,low,close,volume:20+random()*180,closed:true});
    }
    const delta=current.price-out.at(-1).close;out.forEach((c,i)=>{const w=i/(out.length-1);['open','high','low','close'].forEach(k=>c[k]+=delta*w);});
    return out;
  }
  function createDemoBook(){
    const current=market(),random=seededRandom(Math.round(current.price*100)+Date.now()%1000),step=Math.max(10**(-current.precision),current.price*.00012);
    state.asks=[];state.bids=[];let askTotal=0,bidTotal=0;
    for(let i=1;i<=20;i++){
      const aq=(.02+random()*1.4)*(current.price>1000?1:current.price>10?16:1200),bq=(.02+random()*1.4)*(current.price>1000?1:current.price>10?16:1200);
      askTotal+=aq;bidTotal+=bq;state.asks.push([current.price+step*i,aq,askTotal]);state.bids.push([current.price-step*i,bq,bidTotal]);
    }
  }
  function createDemoTrades(){
    const current=market(),random=seededRandom(Math.round(current.price*10));state.trades=[];
    for(let i=0;i<36;i++)state.trades.push({price:current.price+(random()-.5)*current.price*.0015,qty:(.005+random()*.7)*(current.price>1000?1:12),time:new Date(Date.now()-i*4200).toLocaleTimeString('zh-CN',{hour12:false}),side:random()>.5?'buy':'sell'});
  }

  async function fetchInitialCandles(){
    const loading=$('#chartLoading');loading?.classList.remove('hidden');
    try{
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4500);
      const url=`https://api.binance.com/api/v3/klines?symbol=${state.activeSymbol}&interval=${state.timeframe}&limit=200`;
      const response=await fetch(url,{signal:controller.signal});clearTimeout(timer);
      if(!response.ok)throw new Error('market data unavailable');
      const rows=await response.json();
      if(!Array.isArray(rows)||rows.length<20)throw new Error('invalid candle response');
      state.candles=rows.map(row=>({time:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5]),closed:true}));
      setFeedMode('live','公开行情');
    }catch{state.candles=createDemoCandles();setFeedMode('demo','演示行情');}
    loading?.classList.add('hidden');updateMarketFromLastCandle();drawChart();updateOhlc();
  }

  function setFeedMode(mode,label){
    const shell=$('.pro-shell');if(shell)shell.dataset.feedMode=mode;
    const text=$('#feedStatus span');if(text)text.textContent=label;
    const chartLabel=$('#chartFeedLabel');if(chartLabel)chartLabel.textContent=label;
    const source=$('#chartSource');if(source)source.textContent=mode==='live'?'Binance 公开行情 · 本地模拟撮合':'演示行情 · 本地模拟撮合';
    state.live=mode==='live';
  }
  function stopSockets(){
    if(state.activeSocket){try{state.activeSocket.onclose=null;state.activeSocket.close();}catch{}state.activeSocket=null;}
    clearTimeout(state.reconnectTimer);
  }
  function connectActiveStream(){
    stopSockets();setFeedMode('connecting','连接公开行情');
    const lower=state.activeSymbol.toLowerCase();
    const streams=[`${lower}@ticker`,`${lower}@depth20@100ms`,`${lower}@aggTrade`,`${lower}@kline_${state.timeframe}`].join('/');
    let socket;
    try{socket=new WebSocket(`wss://stream.binance.com:443/stream?streams=${streams}`);}catch{startDemoFeed();return;}
    state.activeSocket=socket;let openedAt=performance.now();
    const fallback=setTimeout(()=>{if(socket.readyState!==WebSocket.OPEN){try{socket.close();}catch{}startDemoFeed();}},5000);
    socket.onopen=()=>{clearTimeout(fallback);state.lastMessageAt=Date.now();setFeedMode('live','公开行情');const latency=$('#latencyValue');if(latency)latency.textContent=`${Math.max(12,Math.round(performance.now()-openedAt))} ms`;};
    socket.onmessage=event=>{state.lastMessageAt=Date.now();let packet;try{packet=JSON.parse(event.data);}catch{return;}const data=packet.data||packet;handleStreamData(packet.stream||'',data);};
    socket.onerror=()=>{};
    socket.onclose=()=>{clearTimeout(fallback);if(state.activeSocket===socket){state.activeSocket=null;startDemoFeed();state.reconnectTimer=setTimeout(connectActiveStream,9000);}};
  }
  function connectMarketStream(){
    if(state.marketSocket){try{state.marketSocket.close();}catch{}}
    try{
      const socket=new WebSocket('wss://stream.binance.com:443/ws/!miniTicker@arr');state.marketSocket=socket;
      socket.onmessage=event=>{let rows;try{rows=JSON.parse(event.data);}catch{return;}if(!Array.isArray(rows))return;rows.forEach(row=>{const item=MARKETS[row.s];if(!item)return;const close=Number(row.c),open=Number(row.o);if(!close)return;Object.assign(item,{price:close,open,high:Number(row.h),low:Number(row.l),volume:Number(row.v),turnover:Number(row.q),change:open?(close-open)/open*100:0,updatedAt:Date.now()});});renderMarketLists();updateMood();};
      socket.onerror=()=>{};socket.onclose=()=>{if(state.marketSocket===socket)setTimeout(connectMarketStream,12000);};
    }catch{}
  }
  function handleStreamData(stream,data){
    if(stream.includes('@ticker')){
      const item=market(),previous=item.price;Object.assign(item,{price:Number(data.c)||item.price,open:Number(data.o)||item.open,high:Number(data.h)||item.high,low:Number(data.l)||item.low,volume:Number(data.v)||item.volume,turnover:Number(data.q)||item.turnover,change:Number(data.P)||item.change,updatedAt:Date.now()});
      updateActiveMarketUi(previous);matchOpenOrders();renderPositions();renderAccountMetrics();
    }else if(stream.includes('@depth')){
      const normalize=(rows,ascending)=>{let total=0;const list=(rows||[]).map(([price,qty])=>{total+=Number(qty);return[Number(price),Number(qty),total];}).filter(row=>row[1]>0);return ascending?list.sort((a,b)=>a[0]-b[0]):list.sort((a,b)=>b[0]-a[0]);};
      state.bids=normalize(data.bids||data.b,false);state.asks=normalize(data.asks||data.a,true);renderOrderBook();
    }else if(stream.includes('@aggTrade')){
      const trade={price:Number(data.p),qty:Number(data.q),time:new Date(Number(data.T)||Date.now()).toLocaleTimeString('zh-CN',{hour12:false}),side:data.m?'sell':'buy'};state.trades.unshift(trade);state.trades=state.trades.slice(0,60);renderTrades();
    }else if(stream.includes('@kline_')){
      const k=data.k;if(!k)return;const candle={time:Number(k.t),open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c),volume:Number(k.v),closed:Boolean(k.x)};
      const last=state.candles.at(-1);if(last&&last.time===candle.time)state.candles[state.candles.length-1]=candle;else state.candles.push(candle);state.candles=state.candles.slice(-400);drawChart();updateOhlc();
    }
  }
  function startDemoFeed(){
    setFeedMode('demo','演示行情');clearInterval(state.demoTimer);createDemoBook();createDemoTrades();renderOrderBook();renderTrades();
    state.demoTimer=setInterval(()=>{
      const item=market(),previous=item.price,step=item.price*(.00008+Math.random()*.00022),direction=Math.random()>.49?1:-1;
      item.price=Math.max(item.price*.2,item.price+direction*step);item.high=Math.max(item.high,item.price);item.low=Math.min(item.low,item.price);item.change=item.open?(item.price-item.open)/item.open*100:0;
      const last=state.candles.at(-1);if(last){last.close=item.price;last.high=Math.max(last.high,item.price);last.low=Math.min(last.low,item.price);last.volume+=Math.random()*12;}
      createDemoBook();state.trades.unshift({price:item.price,qty:(.003+Math.random()*.2)*(item.price>1000?1:10),time:nowText(),side:direction>0?'buy':'sell'});state.trades=state.trades.slice(0,60);
      updateActiveMarketUi(previous);renderOrderBook();renderTrades();drawChart();matchOpenOrders();renderPositions();renderAccountMetrics();
    },1700);
  }

  function marketRowTemplate(item,mobile=false){
    const active=item.symbol===state.activeSymbol,changeClass=item.change>=0?'positive':'negative';
    return `<button class="${mobile?'mobile-market-row':'market-row'}${active?' active':''}" type="button" data-symbol="${item.symbol}">
      <span class="pair-cell"><i>${item.icon}</i><span><b>${item.base}<small>/USDT</small></b><small>${item.name}</small></span></span>
      <span class="price-cell">${fmtMarket(item.price,item.precision)}</span><span class="change-cell ${changeClass}">${item.change>=0?'+':''}${item.change.toFixed(2)}%</span></button>`;
  }
  function fmtMarket(value,precision){return Number(value||0).toLocaleString('en-US',{minimumFractionDigits:precision,maximumFractionDigits:precision});}
  function filteredMarkets(query=''){
    let list=Object.values(MARKETS),q=query.trim().toUpperCase();if(q)list=list.filter(item=>item.symbol.includes(q)||item.name.toUpperCase().includes(q));
    if(state.marketFilter==='favorite')list=list.filter(item=>state.favorites.includes(item.symbol));if(state.marketFilter==='gainers')list=list.sort((a,b)=>b.change-a.change);return list;
  }
  function renderMarketLists(){
    const desktopQuery=$('#marketSearch')?.value||'',mobileQuery=$('#mobileMarketSearch')?.value||'';
    const list=$('#marketList');if(list)list.innerHTML=filteredMarkets(desktopQuery).map(item=>marketRowTemplate(item)).join('');
    const mobile=$('#mobileMarketList');if(mobile)mobile.innerHTML=filteredMarkets(mobileQuery).map(item=>marketRowTemplate(item,true)).join('');
    const count=$('#marketCount');if(count)count.textContent=String(filteredMarkets(desktopQuery).length);
  }
  function updateMood(){
    const list=Object.values(MARKETS),positive=list.filter(x=>x.change>=0).length,ratio=positive/list.length*100;
    const bar=$('#moodBar');if(bar)bar.style.width=`${ratio}%`;const text=$('#marketMood');if(text)text.textContent=ratio>65?'偏多':ratio<35?'偏空':'中性';
  }
  function selectMarket(symbol,{closeSheets=true}={}){
    if(!MARKETS[symbol]||symbol===state.activeSymbol){if(closeSheets)closeMarketSheet();return;}
    state.activeSymbol=symbol;state.pointerIndex=null;state.chartOffset=0;state.chartWindow=78;state.selectedBookPrice=null;
    const item=market();state.candles=createDemoCandles();createDemoBook();createDemoTrades();
    renderMarketLists();updateActiveMarketUi(item.price);renderOrderBook();renderTrades();renderOrderTicket();drawChart();updateOhlc();renderPositions();saveState();
    fetchInitialCandles();connectActiveStream();if(closeSheets)closeMarketSheet();showToast(`已切换至 ${item.pair}`);
  }
  function toggleFavorite(){
    const index=state.favorites.indexOf(state.activeSymbol);if(index>=0)state.favorites.splice(index,1);else state.favorites.push(state.activeSymbol);renderMarketLists();updateFavoriteUi();saveState();
  }
  function updateFavoriteUi(){const active=state.favorites.includes(state.activeSymbol);['#favoriteToggle','#mobileFavorite'].forEach(sel=>$(sel)?.classList.toggle('active',active));}

  function updateActiveMarketUi(previous=market().price){
    const item=market(),positive=item.change>=0,precision=item.precision;
    const set=(sel,text)=>{const el=$(sel);if(el)el.textContent=text;};
    set('#activePair',item.pair);set('#activeMarketName',`${item.name} · 现货`);set('#activeCoinBadge',item.icon);set('#mobileCoinBadge',item.icon);set('#mobilePair',item.pair);
    set('#lastPrice',fmtMarket(item.price,precision));set('#mobileLastPrice',fmtMarket(item.price,precision));set('#mobileBarPrice',fmtMarket(item.price,precision));set('#mobileBarPair',item.pair);
    set('#priceUsd',`≈ $${fmtMarket(item.price,Math.max(2,precision))}`);set('#high24',fmtMarket(item.high,precision));set('#low24',fmtMarket(item.low,precision));set('#volume24',`${compact(item.volume)} ${item.base}`);set('#turnover24',`${compact(item.turnover)} USDT`);
    ['#priceChange','#mobileChange'].forEach(sel=>{const el=$(sel);if(!el)return;el.textContent=`${positive?'+':''}${item.change.toFixed(2)}%`;el.className=positive?'positive':'negative';});
    const price=$('#lastPrice');if(price)price.className=item.price>=previous?'positive':'negative';
    const canvas=$('#chartCanvas');if(canvas)canvas.setAttribute('aria-label',`${item.pair} K线图`);updateFavoriteUi();renderOrderTicket();
  }

  function movingAverage(candles,period){return candles.map((_,i)=>{const slice=candles.slice(Math.max(0,i-period+1),i+1);return slice.reduce((sum,c)=>sum+c.close,0)/slice.length;});}
  function stdSeries(candles,period){return candles.map((_,i)=>{const slice=candles.slice(Math.max(0,i-period+1),i+1),avg=slice.reduce((s,c)=>s+c.close,0)/slice.length;return Math.sqrt(slice.reduce((s,c)=>s+(c.close-avg)**2,0)/slice.length);});}
  function visibleCandles(){const total=state.candles.length,count=clamp(state.chartWindow,28,160),end=clamp(total-state.chartOffset,count,total);return state.candles.slice(Math.max(0,end-count),end);}
  function drawChart(){
    const canvas=$('#chartCanvas'),stage=$('#chartStage');if(!canvas||!stage||!state.candles.length)return;
    const rect=stage.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2),width=Math.max(300,Math.floor(rect.width)),height=Math.max(220,Math.floor(rect.height));
    canvas.width=Math.floor(width*ratio);canvas.height=Math.floor(height*ratio);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    const padding={top:14,right:64,bottom:25,left:9},volumeHeight=Math.min(62,height*.18),priceBottom=height-padding.bottom-volumeHeight,priceHeight=priceBottom-padding.top,chartWidth=width-padding.left-padding.right;
    const candles=visibleCandles();if(!candles.length)return;const max=Math.max(...candles.map(c=>c.high)),min=Math.min(...candles.map(c=>c.low)),range=Math.max(max-min,market().price*.0001),toY=p=>padding.top+(max-p)/range*priceHeight;
    const step=chartWidth/candles.length,bodyWidth=clamp(step*.62,2.5,9),maxVolume=Math.max(...candles.map(c=>c.volume),1);
    ctx.font='8px SFMono-Regular,Consolas,monospace';ctx.lineWidth=1;ctx.fillStyle='#5b697c';ctx.strokeStyle='#182431';ctx.textBaseline='middle';ctx.textAlign='left';
    for(let i=0;i<=5;i++){const y=padding.top+priceHeight/5*i;ctx.beginPath();ctx.moveTo(padding.left,y+.5);ctx.lineTo(width-padding.right,y+.5);ctx.stroke();ctx.fillText(fmtMarket(max-range/5*i,market().precision),width-padding.right+6,y);}
    for(let i=0;i<=6;i++){const x=padding.left+chartWidth/6*i;ctx.beginPath();ctx.moveTo(x+.5,padding.top);ctx.lineTo(x+.5,height-padding.bottom);ctx.stroke();}
    candles.forEach((c,i)=>{const x=padding.left+step*i+step/2,up=c.close>=c.open,color=up?'#21c997':'#f15b70';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(Math.round(x)+.5,toY(c.high));ctx.lineTo(Math.round(x)+.5,toY(c.low));ctx.stroke();ctx.globalAlpha=.9;ctx.fillRect(x-bodyWidth/2,Math.min(toY(c.open),toY(c.close)),bodyWidth,Math.max(1.2,Math.abs(toY(c.open)-toY(c.close))));ctx.globalAlpha=.18;const vh=c.volume/maxVolume*(volumeHeight-7);ctx.fillRect(x-bodyWidth/2,height-padding.bottom-vh,bodyWidth,vh);ctx.globalAlpha=1;});
    const drawLine=(series,color,lineWidth=1.2)=>{ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.beginPath();series.forEach((p,i)=>{const x=padding.left+step*i+step/2,y=toY(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();};
    if(state.indicator==='ema'){drawLine(movingAverage(candles,10),'#7c8cff');drawLine(movingAverage(candles,20),'#d29bf4');}
    if(state.indicator==='boll'){const mid=movingAverage(candles,20),std=stdSeries(candles,20);drawLine(mid.map((v,i)=>v+std[i]*2),'#7c8cff',1);drawLine(mid,'#d29bf4',1.15);drawLine(mid.map((v,i)=>v-std[i]*2),'#7c8cff',1);}
    ctx.fillStyle='#5b697c';ctx.textAlign='center';ctx.textBaseline='top';[0,Math.floor(candles.length/3),Math.floor(candles.length*2/3),candles.length-1].forEach(i=>{const d=new Date(candles[i].time),label=state.timeframe==='1d'?`${d.getMonth()+1}/${d.getDate()}`:`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;ctx.fillText(label,padding.left+step*i+step/2,height-padding.bottom+6);});
    const last=market().price,lastY=toY(clamp(last,min,max));ctx.strokeStyle='#21c997';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(padding.left,lastY+.5);ctx.lineTo(width-padding.right,lastY+.5);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#21c997';ctx.fillRect(width-padding.right,lastY-9,padding.right,18);ctx.fillStyle='#06140f';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='700 8px SFMono-Regular,Consolas,monospace';ctx.fillText(fmtMarket(last,market().precision),width-padding.right/2,lastY);
    if(Number.isInteger(state.pointerIndex)){const i=clamp(state.pointerIndex,0,candles.length-1),x=padding.left+step*i+step/2,y=toY(candles[i].close);ctx.strokeStyle='#6d7d91';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,padding.top);ctx.lineTo(x,height-padding.bottom);ctx.moveTo(padding.left,y);ctx.lineTo(width-padding.right,y);ctx.stroke();ctx.setLineDash([]);}
    canvas.dataset.step=String(step);canvas.dataset.left=String(padding.left);canvas.dataset.count=String(candles.length);canvas.dataset.max=String(max);canvas.dataset.min=String(min);canvas.dataset.priceHeight=String(priceHeight);canvas.dataset.top=String(padding.top);
  }
  function updateOhlc(candle=visibleCandles().at(-1)){
    if(!candle)return;const change=(candle.close-candle.open)/Math.max(candle.open,1)*100;const set=(id,value)=>{const el=$(id);if(el)el.textContent=value;};set('#ohlcOpen',fmtMarket(candle.open,market().precision));set('#ohlcHigh',fmtMarket(candle.high,market().precision));set('#ohlcLow',fmtMarket(candle.low,market().precision));set('#ohlcClose',fmtMarket(candle.close,market().precision));set('#ohlcChange',`${change>=0?'+':''}${change.toFixed(2)}%`);const delta=$('#ohlcChange');if(delta)delta.className=change>=0?'positive':'negative';
  }
  function chartPointer(event){
    const canvas=$('#chartCanvas'),rect=canvas.getBoundingClientRect(),clientX=event.touches?.[0]?.clientX??event.clientX,x=clientX-rect.left,step=num(canvas.dataset.step)||1,left=num(canvas.dataset.left),count=num(canvas.dataset.count)||1,index=clamp(Math.floor((x-left)/step),0,count-1),candles=visibleCandles(),c=candles[index];if(!c)return;
    state.pointerIndex=index;updateOhlc(c);const box=$('#chartCrosshairInfo');if(box){box.hidden=false;const d=new Date(c.time);$('#crosshairTime').textContent=d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});$('#crosshairPrice').textContent=fmtMarket(c.close,market().precision);const delta=(c.close-c.open)/Math.max(c.open,1)*100;$('#crosshairDelta').textContent=`${delta>=0?'+':''}${delta.toFixed(2)}%`;$('#crosshairDelta').className=delta>=0?'positive':'negative';box.style.left=`${clamp(x+12,8,rect.width-130)}px`;box.style.top='10px';}drawChart();
  }
  function clearPointer(){state.pointerIndex=null;const box=$('#chartCrosshairInfo');if(box)box.hidden=true;updateOhlc();drawChart();}

  function renderOrderBook(){
    if(!state.bids.length||!state.asks.length)createDemoBook();const rows=innerWidth<=820?10:14,asks=state.asks.slice(0,rows).reverse(),bids=state.bids.slice(0,rows),askMax=Math.max(...asks.map(x=>x[2]),1),bidMax=Math.max(...bids.map(x=>x[2]),1);
    const row=(entry,side,max)=>`<button class="book-row" type="button" data-book-price="${entry[0]}" style="--depth:${Math.min(100,entry[2]/max*100)}%;--depth-color:${side==='ask'?'rgba(241,91,112,.08)':'rgba(33,201,151,.08)'}"><span class="${side}">${fmtMarket(entry[0],market().precision)}</span><span>${fmt(entry[1],market().price>1000?4:2)}</span><span>${fmt(entry[2],market().price>1000?3:1)}</span></button>`;
    const askEl=$('#asksRows'),bidEl=$('#bidsRows');if(askEl)askEl.innerHTML=asks.map(x=>row(x,'ask',askMax)).join('');if(bidEl)bidEl.innerHTML=bids.map(x=>row(x,'bid',bidMax)).join('');
    const bestAsk=state.asks[0]?.[0]||market().price,bestBid=state.bids[0]?.[0]||market().price,spread=Math.max(0,bestAsk-bestBid);$('#midPrice').textContent=fmtMarket(market().price,market().precision);$('#midUsd').textContent=`≈ $${fmtMarket(market().price,Math.max(2,market().precision))}`;$('#spreadMetric').textContent=fmtMarket(spread,market().precision);
    const bidQty=state.bids.slice(0,12).reduce((s,x)=>s+x[1],0),askQty=state.asks.slice(0,12).reduce((s,x)=>s+x[1],0),ratio=bidQty/(bidQty+askQty||1)*100;$('#bookRatio').textContent=`${ratio.toFixed(1)} / ${(100-ratio).toFixed(1)}`;$('#bidRatioBar').style.width=`${ratio}%`;
    applyBookMode();
  }
  function applyBookMode(){const asks=$('#asksRows'),bids=$('#bidsRows');if(!asks||!bids)return;asks.hidden=state.bookMode==='bids';bids.hidden=state.bookMode==='asks';$$('[data-book-mode]').forEach(b=>b.classList.toggle('active',b.dataset.bookMode===state.bookMode));}
  function renderTrades(){const list=$('#tradeStream');if(!list)return;list.innerHTML=state.trades.slice(0,32).map(t=>`<div class="trade-row"><span class="${t.side==='buy'?'maker-buy':'maker-sell'}">${fmtMarket(t.price,market().precision)}</span><span>${fmt(t.qty,market().price>1000?5:3)}</span><span>${t.time}</span></div>`).join('');}

  function effectivePrice(){if(state.orderType==='market')return market().price;return num($('#orderPrice')?.value)||market().price;}
  function reservedCash(){return state.orders.filter(o=>o.side==='buy').reduce((sum,o)=>sum+o.total+o.estimatedFee,0);}
  function availableCash(){return Math.max(0,state.cash-reservedCash());}
  function positionValue(){return state.positions.reduce((sum,p)=>sum+p.qty*(MARKETS[p.symbol]?.price||p.entry),0);}
  function unrealizedPnl(){return state.positions.reduce((sum,p)=>{const mark=MARKETS[p.symbol]?.price||p.entry;return sum+(mark-p.entry)*p.qty;},0);}
  function accountEquity(){return state.cash+positionValue();}
  function syncOrderFields(source='total'){
    const price=effectivePrice(),qtyInput=$('#orderQuantity'),totalInput=$('#orderTotal');if(!qtyInput||!totalInput||price<=0)return;
    if(source==='total'){const total=num(totalInput.value);qtyInput.value=total?String((total/price).toFixed(market().price>1000?6:4)):'';}else{const qty=num(qtyInput.value);totalInput.value=qty?String((qty*price).toFixed(2)):'';}
    const total=num(totalInput.value),fee=total*FEE_RATE,slippage=state.orderType==='market'?Math.min(.25,total/Math.max(market().turnover,1)*100):0;$('#estimatedPrice').textContent=`${fmtMarket(price,market().precision)} USDT`;$('#estimatedFee').textContent=`${fee.toFixed(2)} USDT`;$('#estimatedSlippage').textContent=`${slippage.toFixed(3)}%`;
  }
  function renderOrderTicket(){
    const item=market();$('#quantityUnit').textContent=item.base;$('#ticketAvailable').textContent=fmt(availableCash(),2);$('#submitOrder').textContent=`${state.side==='buy'?'买入':'卖出'} ${item.base}`;$('#submitOrder').className=`submit-order ${state.side}`;
    $$('.side-selector [data-side]').forEach(b=>b.classList.toggle('active',b.dataset.side===state.side));$$('[data-order-type]').forEach(b=>b.classList.toggle('active',b.dataset.orderType===state.orderType));
    $('.price-field').hidden=state.orderType==='market';$('.trigger-field').hidden=state.orderType!=='stop';if(!$('#orderPrice').value)$('#orderPrice').value=String(item.price.toFixed(item.precision));syncOrderFields('total');
  }
  function submitOrder(){
    const total=num($('#orderTotal').value),qty=num($('#orderQuantity').value),price=effectivePrice();if(total<=0||qty<=0){showToast('请输入有效的下单数量或总额');return;}
    if(state.side==='buy'&&total+total*FEE_RATE>availableCash()){showToast('模拟账户可用余额不足');return;}
    if(state.side==='sell'){
      const held=state.positions.filter(p=>p.symbol===state.activeSymbol).reduce((s,p)=>s+p.qty,0);if(qty>held+1e-10){showToast(`可卖出 ${market().base} 数量不足`);return;}
    }
    if(state.orderType==='market'){executeFill({id:uid('fill'),symbol:state.activeSymbol,side:state.side,type:'market',price:market().price,qty,total:qty*market().price,createdAt:Date.now()});showToast('模拟市价订单已成交');}
    else{
      const order={id:uid('order'),symbol:state.activeSymbol,side:state.side,type:state.orderType,price,triggerPrice:num($('#triggerPrice').value),qty,total:qty*price,filled:0,estimatedFee:qty*price*FEE_RATE,createdAt:Date.now(),postOnly:$('#postOnly').checked,reduceOnly:$('#reduceOnly').checked};state.orders.unshift(order);showToast('模拟委托已提交');
    }
    $('#orderTotal').value='';$('#orderQuantity').value='';$('#orderPercent').value='0';saveState();renderAllAccount();renderOrderTicket();closeOrderSheet();
  }
  function executeFill(order){
    const item=MARKETS[order.symbol],price=Number(order.price),qty=Number(order.qty),gross=price*qty,fee=gross*FEE_RATE;
    if(order.side==='buy'){
      state.cash-=gross+fee;const existing=state.positions.find(p=>p.symbol===order.symbol);if(existing){const nextQty=existing.qty+qty;existing.entry=(existing.entry*existing.qty+price*qty)/nextQty;existing.qty=nextQty;existing.fees=(existing.fees||0)+fee;}else state.positions.unshift({id:uid('position'),symbol:order.symbol,qty,entry:price,fees:fee,createdAt:Date.now()});
    }else{
      let remaining=qty;for(const position of [...state.positions].filter(p=>p.symbol===order.symbol)){const closeQty=Math.min(remaining,position.qty);position.qty-=closeQty;remaining-=closeQty;state.cash+=closeQty*price-fee*(closeQty/qty);if(position.qty<=1e-10)state.positions=state.positions.filter(p=>p.id!==position.id);if(remaining<=1e-10)break;}
    }
    state.history.unshift({id:uid('history'),symbol:order.symbol,side:order.side,price,qty,fee,status:'已成交',createdAt:Date.now()});state.history=state.history.slice(0,100);saveState();
  }
  function matchOpenOrders(){
    const price=market().price;let changed=false;for(const order of [...state.orders]){if(order.symbol!==state.activeSymbol)continue;const triggered=order.type==='limit'?(order.side==='buy'?price<=order.price:price>=order.price):(order.triggerPrice?order.side==='buy'?price>=order.triggerPrice:price<=order.triggerPrice:false);if(triggered){executeFill({...order,price:order.type==='limit'?order.price:price});state.orders=state.orders.filter(x=>x.id!==order.id);changed=true;}}
    if(changed){saveState();renderAllAccount();showToast('一笔模拟委托已成交');}
  }
  function closePosition(id){const position=state.positions.find(p=>p.id===id);if(!position)return;executeFill({symbol:position.symbol,side:'sell',price:MARKETS[position.symbol]?.price||position.entry,qty:position.qty});showToast('模拟持仓已平仓');renderAllAccount();}
  function cancelOrder(id){state.orders=state.orders.filter(o=>o.id!==id);saveState();renderAllAccount();showToast('模拟委托已撤销');}
  function emptyTemplate(title,copy){return `<div class="empty-table"><svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg><b>${title}</b><small>${copy}</small></div>`;}
  function renderPositions(){
    const body=$('#positionsBody');if(!body)return;if(!state.positions.length){body.innerHTML=emptyTemplate('暂无持仓','完成一笔模拟市价买入后，持仓与盈亏会显示在这里。');return;}
    body.innerHTML=state.positions.map(p=>{const item=MARKETS[p.symbol],mark=item?.price||p.entry,pnl=(mark-p.entry)*p.qty,roi=p.entry?pnl/(p.entry*p.qty)*100:0;return `<div class="table-row"><span class="pair-name" data-label="交易对">${item?.pair||p.symbol}</span><span class="positive" data-label="方向">买入</span><span data-label="数量">${fmt(p.qty,item?.price>1000?6:4)}</span><span data-label="开仓均价">${fmtMarket(p.entry,item?.precision||2)}</span><span data-label="标记价格">${fmtMarket(mark,item?.precision||2)}</span><span class="${pnl>=0?'positive':'negative'}" data-label="未实现盈亏">${pnl>=0?'+':''}${pnl.toFixed(2)}</span><span class="${roi>=0?'positive':'negative'}" data-label="收益率">${roi>=0?'+':''}${roi.toFixed(2)}%</span><button class="row-action" type="button" data-close-position="${p.id}">平仓</button></div>`;}).join('');
  }
  function renderOrders(){
    const body=$('#ordersBody');if(!body)return;if(!state.orders.length){body.innerHTML=emptyTemplate('暂无当前委托','限价单和触发单会在这里等待价格条件。');return;}
    body.innerHTML=state.orders.map(o=>{const item=MARKETS[o.symbol];return `<div class="table-row"><span data-label="时间">${new Date(o.createdAt).toLocaleTimeString('zh-CN',{hour12:false})}</span><span class="pair-name" data-label="交易对">${item?.pair||o.symbol}</span><span class="${o.side==='buy'?'positive':'negative'}" data-label="方向">${o.side==='buy'?'买入':'卖出'}</span><span data-label="类型">${o.type==='limit'?'限价':'止盈止损'}</span><span data-label="委托价">${fmtMarket(o.price,item?.precision||2)}</span><span data-label="数量">${fmt(o.qty,item?.price>1000?6:4)}</span><span data-label="已成交">0%</span><button class="row-action" type="button" data-cancel-order="${o.id}">撤单</button></div>`;}).join('');
  }
  function renderHistory(){
    const body=$('#historyBody');if(!body)return;if(!state.history.length){body.innerHTML=emptyTemplate('暂无成交记录','模拟订单成交后会生成可追溯的成交与手续费记录。');return;}
    body.innerHTML=state.history.map(h=>{const item=MARKETS[h.symbol];return `<div class="table-row"><span data-label="时间">${new Date(h.createdAt).toLocaleString('zh-CN',{hour12:false})}</span><span class="pair-name" data-label="交易对">${item?.pair||h.symbol}</span><span class="${h.side==='buy'?'positive':'negative'}" data-label="方向">${h.side==='buy'?'买入':'卖出'}</span><span data-label="成交价">${fmtMarket(h.price,item?.precision||2)}</span><span data-label="数量">${fmt(h.qty,item?.price>1000?6:4)}</span><span data-label="手续费">${h.fee.toFixed(2)} USDT</span><span class="positive" data-label="状态">${h.status}</span></div>`;}).join('');
  }
  function renderBalances(){const grid=$('#balanceGrid');if(!grid)return;const holdings={USDT:state.cash};state.positions.forEach(p=>holdings[MARKETS[p.symbol]?.base||p.symbol]=(holdings[MARKETS[p.symbol]?.base||p.symbol]||0)+p.qty);grid.innerHTML=Object.entries(holdings).map(([asset,value])=>`<div class="balance-card"><i>${asset[0]}</i><div><span>${asset}</span><b>${fmt(value,asset==='USDT'?2:6)}</b></div></div>`).join('');}
  function renderAccountMetrics(){const pnl=unrealizedPnl(),equity=accountEquity();$('#accountEquity').textContent=`${fmt(equity,2)} USDT`;$('#availableBalance').textContent=fmt(availableCash(),2);$('#ticketAvailable').textContent=fmt(availableCash(),2);$('#unrealizedPnl').textContent=`${pnl>=0?'+':''}${pnl.toFixed(2)}`;$('#unrealizedPnl').className=pnl>=0?'positive':'negative';}
  function renderAllAccount(){renderPositions();renderOrders();renderHistory();renderBalances();renderAccountMetrics();$('#positionsCount').textContent=String(state.positions.length);$('#ordersCount').textContent=String(state.orders.length);$('#historyCount').textContent=String(state.history.length);applyAccountTab();}
  function applyAccountTab(){$$('[data-account-tab]').forEach(b=>b.classList.toggle('active',b.dataset.accountTab===state.accountTab));$$('[data-account-view]').forEach(view=>view.classList.toggle('active',view.dataset.accountView===state.accountTab));}

  function applyMobileView(){
    $$('[data-mobile-view]').forEach(b=>b.classList.toggle('active',b.dataset.mobileView===state.mobileView));$$('[data-mobile-panel]').forEach(panel=>panel.classList.remove('mobile-active'));
    if(state.mobileView==='chart')$('.chart-panel')?.classList.add('mobile-active');
    if(state.mobileView==='book'||state.mobileView==='trades'){const panel=$('.orderbook-panel');panel?.classList.add('mobile-active');setBookContent(state.mobileView==='trades'?'trades':'book');}
    if(state.mobileView==='account')$('.account-workspace')?.classList.add('mobile-active');saveState();requestAnimationFrame(drawChart);
  }
  function setBookContent(view){$$('[data-book-view]').forEach(b=>b.classList.toggle('active',b.dataset.bookView===view));$$('[data-book-content]').forEach(el=>el.classList.toggle('active',el.dataset.bookContent===view));}
  function openOrderSheet(side){state.side=side;renderOrderTicket();document.body.classList.add('order-sheet-open');$('#sheetBackdrop').hidden=false;}
  function closeOrderSheet(){document.body.classList.remove('order-sheet-open');if($('#marketSheet').hidden)setTimeout(()=>{$('#sheetBackdrop').hidden=true;},220);}
  function openMarketSheet(){$('#marketSheet').hidden=false;$('#sheetBackdrop').hidden=false;renderMarketLists();}
  function closeMarketSheet(){$('#marketSheet').hidden=true;if(!document.body.classList.contains('order-sheet-open'))$('#sheetBackdrop').hidden=true;}
  function showToast(message){const toast=$('#toast');if(!toast)return;toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),1900);}

  function updateMarketFromLastCandle(){const last=state.candles.at(-1);if(!last)return;const item=market();item.price=last.close;item.high=Math.max(item.high,last.high);item.low=Math.min(item.low,last.low);item.change=item.open?(item.price-item.open)/item.open*100:item.change;updateActiveMarketUi(item.price);}
  function resetChart(){state.chartWindow=78;state.chartOffset=0;drawChart();showToast('图表视图已重置');}
  function bindEvents(){
    document.addEventListener('click',event=>{
      const symbol=event.target.closest('[data-symbol]')?.dataset.symbol;if(symbol){selectMarket(symbol);return;}
      const nav=event.target.closest('[data-main-nav]');if(nav){$$('[data-main-nav]').forEach(b=>b.classList.toggle('active',b===nav));showToast(`${nav.textContent.trim()}模块将在专业版后续工作区中展开`);return;}
      const filter=event.target.closest('[data-market-filter]');if(filter){state.marketFilter=filter.dataset.marketFilter;$$('[data-market-filter]').forEach(b=>b.classList.toggle('active',b===filter));renderMarketLists();saveState();return;}
      const timeframe=event.target.closest('[data-timeframe]');if(timeframe){state.timeframe=timeframe.dataset.timeframe;$$('[data-timeframe]').forEach(b=>b.classList.toggle('active',b===timeframe));state.chartOffset=0;saveState();fetchInitialCandles();connectActiveStream();return;}
      const indicator=event.target.closest('[data-indicator]');if(indicator){state.indicator=indicator.dataset.indicator;$$('[data-indicator]').forEach(b=>b.classList.toggle('active',b===indicator));saveState();drawChart();return;}
      const bookView=event.target.closest('[data-book-view]');if(bookView){setBookContent(bookView.dataset.bookView);return;}
      const bookMode=event.target.closest('[data-book-mode]');if(bookMode){state.bookMode=bookMode.dataset.bookMode;saveState();applyBookMode();return;}
      const bookPrice=event.target.closest('[data-book-price]')?.dataset.bookPrice;if(bookPrice){$('#orderPrice').value=Number(bookPrice).toFixed(market().precision);state.selectedBookPrice=Number(bookPrice);syncOrderFields('total');return;}
      const side=event.target.closest('[data-side]')?.dataset.side;if(side){state.side=side;saveState();renderOrderTicket();return;}
      const mobileSide=event.target.closest('[data-mobile-side]')?.dataset.mobileSide;if(mobileSide){openOrderSheet(mobileSide);return;}
      const orderType=event.target.closest('[data-order-type]')?.dataset.orderType;if(orderType){state.orderType=orderType;saveState();renderOrderTicket();return;}
      const percent=event.target.closest('[data-percent]')?.dataset.percent;if(percent!==undefined){const value=Number(percent);$('#orderPercent').value=String(value);$('#orderTotal').value=value?String((availableCash()*value/100).toFixed(2)):'';syncOrderFields('total');return;}
      const tab=event.target.closest('[data-account-tab]')?.dataset.accountTab;if(tab){state.accountTab=tab;saveState();applyAccountTab();return;}
      const closeId=event.target.closest('[data-close-position]')?.dataset.closePosition;if(closeId){closePosition(closeId);return;}
      const cancelId=event.target.closest('[data-cancel-order]')?.dataset.cancelOrder;if(cancelId){cancelOrder(cancelId);return;}
      const mobileView=event.target.closest('[data-mobile-view]')?.dataset.mobileView;if(mobileView){state.mobileView=mobileView;applyMobileView();return;}
    });
    $('#marketSearch').addEventListener('input',renderMarketLists);$('#mobileMarketSearch').addEventListener('input',renderMarketLists);
    $('#favoriteToggle').addEventListener('click',toggleFavorite);$('#mobileFavorite').addEventListener('click',toggleFavorite);$('#mobilePairButton').addEventListener('click',openMarketSheet);$('#marketSheetClose').addEventListener('click',closeMarketSheet);$('#orderSheetClose').addEventListener('click',closeOrderSheet);$('#sheetBackdrop').addEventListener('click',()=>{closeMarketSheet();closeOrderSheet();});
    $('#orderTotal').addEventListener('input',()=>syncOrderFields('total'));$('#orderQuantity').addEventListener('input',()=>syncOrderFields('quantity'));$('#orderPrice').addEventListener('input',()=>syncOrderFields('total'));$('#orderPercent').addEventListener('input',event=>{$('#orderTotal').value=event.target.value?String((availableCash()*Number(event.target.value)/100).toFixed(2)):'';syncOrderFields('total');});$('#submitOrder').addEventListener('click',submitOrder);
    $('#chartReset').addEventListener('click',resetChart);$('#chartFullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#chartStage').requestFullscreen();}catch{showToast('当前浏览器不支持图表全屏');}});
    const canvas=$('#chartCanvas');canvas.addEventListener('mousemove',chartPointer);canvas.addEventListener('mouseleave',clearPointer);canvas.addEventListener('touchstart',event=>{chartPointer(event);},{passive:true});canvas.addEventListener('touchmove',event=>{chartPointer(event);},{passive:true});
    canvas.addEventListener('wheel',event=>{event.preventDefault();const before=state.chartWindow;state.chartWindow=clamp(state.chartWindow+(event.deltaY>0?8:-8),30,160);if(before!==state.chartWindow)drawChart();},{passive:false});
    canvas.addEventListener('pointerdown',event=>{state.dragStart={x:event.clientX,offset:state.chartOffset};canvas.setPointerCapture?.(event.pointerId);});canvas.addEventListener('pointermove',event=>{if(!state.dragStart)return;const step=num(canvas.dataset.step)||6,delta=Math.round((event.clientX-state.dragStart.x)/step);state.chartOffset=clamp(state.dragStart.offset+delta,0,Math.max(0,state.candles.length-state.chartWindow));drawChart();});canvas.addEventListener('pointerup',()=>{state.dragStart=null;});canvas.addEventListener('pointercancel',()=>{state.dragStart=null;});
    document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(innerWidth<=820)openMarketSheet();else{$('#marketSearch').focus();$('#marketSearch').select();}}if(event.key==='Escape'){closeMarketSheet();closeOrderSheet();}});
    let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{renderOrderBook();applyMobileView();drawChart();},100);});
  }

  function restoreUiState(){
    $$('[data-timeframe]').forEach(b=>b.classList.toggle('active',b.dataset.timeframe===state.timeframe));$$('[data-indicator]').forEach(b=>b.classList.toggle('active',b.dataset.indicator===state.indicator));$$('[data-market-filter]').forEach(b=>b.classList.toggle('active',b.dataset.marketFilter===state.marketFilter));
    renderMarketLists();updateMood();updateActiveMarketUi(market().price);createDemoBook();createDemoTrades();renderOrderBook();renderTrades();renderAllAccount();renderOrderTicket();applyMobileView();
  }
  async function init(){
    loadState();state.candles=createDemoCandles();bindEvents();restoreUiState();drawChart();updateOhlc();await fetchInitialCandles();connectMarketStream();connectActiveStream();
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();
