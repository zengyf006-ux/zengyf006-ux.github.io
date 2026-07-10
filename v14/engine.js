(()=>{
'use strict';
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const uid=()=>`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const safeGet=(k,fallback='')=>{try{return localStorage.getItem(k)??fallback}catch{return fallback}};
const safeSet=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
const PAIRS=[
 {base:'BTC',name:'Bitcoin',icon:'₿',decimals:1,spot:'BTC-USDT',perp:'BTC-USDT-SWAP',seed:64415.8,color:'#f6a821'},
 {base:'ETH',name:'Ethereum',icon:'◆',decimals:2,spot:'ETH-USDT',perp:'ETH-USDT-SWAP',seed:3385.6,color:'#627eea'},
 {base:'SOL',name:'Solana',icon:'S',decimals:2,spot:'SOL-USDT',perp:'SOL-USDT-SWAP',seed:154.42,color:'#20c997'},
 {base:'BNB',name:'BNB',icon:'B',decimals:2,spot:'BNB-USDT',perp:'BNB-USDT-SWAP',seed:608.2,color:'#f0b90b'},
 {base:'XRP',name:'XRP',icon:'X',decimals:4,spot:'XRP-USDT',perp:'XRP-USDT-SWAP',seed:.5152,color:'#23292f'},
 {base:'DOGE',name:'Dogecoin',icon:'Ð',decimals:5,spot:'DOGE-USDT',perp:'DOGE-USDT-SWAP',seed:.1224,color:'#c9a538'},
 {base:'ADA',name:'Cardano',icon:'A',decimals:4,spot:'ADA-USDT',perp:'ADA-USDT-SWAP',seed:.4356,color:'#3154a3'}
];
const BARS={'15m':'15m','1H':'1H','4H':'4H','1D':'1D'};
class AtlasEngine extends EventTarget{
 constructor(){super();this.pairs=PAIRS;this.product='spot';this.pair=PAIRS[0];this.timeframe='1H';this.markets=new Map();this.candles=[];this.book={asks:[],bids:[]};this.connected=false;this.ws=null;this.poll=null;this.account=this.loadAccount();this.favorite=new Set(JSON.parse(safeGet('atlas-v14-favs','[]')));this.seedMarkets();this.candles=this.seedCandles();this.seedBook()}
 emit(type,detail={}){this.dispatchEvent(new CustomEvent(type,{detail}))}
 loadAccount(){try{return JSON.parse(safeGet('atlas-v14-account','null'))||this.freshAccount()}catch{return this.freshAccount()}}
 freshAccount(){return{initial:100000,cash:100000,positions:{},orders:[],trades:[],fees:0,createdAt:Date.now()}}
 saveAccount(){safeSet('atlas-v14-account',JSON.stringify(this.account));this.emit('account')}
 resetAccount(){this.account=this.freshAccount();this.saveAccount()}
 saveFavs(){safeSet('atlas-v14-favs',JSON.stringify([...this.favorite]));this.emit('favorites')}
 toggleFavorite(){this.favorite.has(this.pair.base)?this.favorite.delete(this.pair.base):this.favorite.add(this.pair.base);this.saveFavs()}
 currentInst(){return this.product==='spot'?this.pair.spot:this.pair.perp}
 currentMarket(base=this.pair.base){return this.markets.get(base)||{last:this.pair.seed,change:0,high:this.pair.seed*1.012,low:this.pair.seed*.988,volumeQuote:1.8e9,ts:Date.now()}}
 setProduct(p){if(!['spot','perp'].includes(p))return;this.product=p;this.seedBook();this.emit('product',{product:p});this.refreshAll();this.refreshCurrent()}
 setPair(base){const p=this.pairs.find(x=>x.base===base);if(!p)return;this.pair=p;this.candles=this.seedCandles();this.seedBook();this.emit('pair',{pair:p});this.emit('candles',{candles:this.candles});this.emit('book',{book:this.book});this.refreshCurrent()}
 setTimeframe(tf){if(!BARS[tf])return;this.timeframe=tf;this.candles=this.seedCandles();this.emit('timeframe',{timeframe:tf});this.emit('candles',{candles:this.candles});this.refreshCurrent()}
 seedMarkets(){for(const p of this.pairs){const drift=Math.sin(p.base.charCodeAt(0))*1.4;this.markets.set(p.base,{last:p.seed,change:drift,high:p.seed*(1+.014+Math.abs(drift)/500),low:p.seed*(1-.012-Math.abs(drift)/500),volumeQuote:1e8*(3+p.base.length*1.8),ts:Date.now()})}}
 seedCandles(pair=this.pair,tf=this.timeframe,count=180){const seconds={'15m':900,'1H':3600,'4H':14400,'1D':86400}[tf],now=Math.floor(Date.now()/1000/seconds)*seconds;let x=pair.seed*.958,seed=pair.base.split('').reduce((s,c)=>s+c.charCodeAt(0),0)+tf.length*97;const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280};const out=[];for(let i=count-1;i>=0;i--){const time=now-i*seconds,vol=(rnd()-.49)*.012,trend=i<count*.32?.0013:i<count*.72?.00025:-.00012,open=x,close=Math.max(.00001,open*(1+vol+trend)),high=Math.max(open,close)*(1+rnd()*.006),low=Math.min(open,close)*(1-rnd()*.006),volume=100+rnd()*900;x=close;out.push({time,open,high,low,close,volume})}const scale=pair.seed/out.at(-1).close;return out.map(c=>({...c,open:c.open*scale,high:c.high*scale,low:c.low*scale,close:c.close*scale}))}
 seedBook(){const m=this.currentMarket(),mid=m.last,step=Math.max(mid*.00001,10**-this.pair.decimals),asks=[],bids=[];for(let i=5;i>=1;i--)asks.push([mid+step*i,(Math.random()*.9+.01)*(this.pair.base==='BTC'?.7:6)]);for(let i=1;i<=5;i++)bids.push([mid-step*i,(Math.random()*.9+.01)*(this.pair.base==='BTC'?.7:6)]);this.book={asks,bids}}
 async getJSON(url,timeout=6500){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{cache:'no-store',signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}finally{clearTimeout(t)}}
 async refreshAll(){try{const ids=this.pairs.map(p=>this.product==='spot'?p.spot:p.perp),rows=await Promise.all(ids.map(id=>this.getJSON(`https://www.okx.com/api/v5/market/ticker?instId=${id}`,4800).catch(()=>null)));rows.forEach((j,i)=>{const d=j?.data?.[0];if(!d)return;const last=+d.last,open=+d.open24h;this.markets.set(this.pairs[i].base,{last,change:open?(last-open)/open*100:0,high:+d.high24h,low:+d.low24h,volumeQuote:+d.volCcy24h||+d.vol24h*last,ts:Date.now()})});this.connected=rows.some(Boolean);this.emit('markets',{markets:this.markets});this.emit('connection',{connected:this.connected})}catch{this.connected=false;this.emit('connection',{connected:false})}}
 async refreshCurrent(){const id=this.currentInst(),bar=BARS[this.timeframe];try{const [cj,bj]=await Promise.all([this.getJSON(`https://www.okx.com/api/v5/market/candles?instId=${id}&bar=${bar}&limit=180`,6500),this.getJSON(`https://www.okx.com/api/v5/market/books?instId=${id}&sz=10`,6500)]);const rows=(cj?.data||[]).map(r=>({time:+r[0]/1000,open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5]})).reverse();if(rows.length>20)this.candles=rows;const b=bj?.data?.[0];if(b)this.book={asks:(b.asks||[]).slice(0,5).reverse().map(x=>[+x[0],+x[1]]),bids:(b.bids||[]).slice(0,5).map(x=>[+x[0],+x[1]])};this.connected=true;this.emit('candles',{candles:this.candles});this.emit('book',{book:this.book});this.emit('connection',{connected:true});this.checkOrders()}catch{this.connected=false;if(!this.candles.length)this.candles=this.seedCandles();if(!this.book.asks.length)this.seedBook();this.emit('candles',{candles:this.candles});this.emit('book',{book:this.book});this.emit('connection',{connected:false})}}
 start(){this.refreshAll();this.refreshCurrent();clearInterval(this.poll);this.poll=setInterval(()=>{if(!document.hidden){this.refreshAll();this.refreshCurrent()}},8500);this.connectWS()}
 connectWS(){try{this.ws?.close();const ws=new WebSocket('wss://ws.okx.com:8443/ws/v5/public');this.ws=ws;ws.onopen=()=>{ws.send(JSON.stringify({op:'subscribe',args:[{channel:'tickers',instId:this.currentInst()}]}))};ws.onmessage=e=>{let j;try{j=JSON.parse(e.data)}catch{return}const d=j?.data?.[0];if(!d||!d.last)return;const m=this.currentMarket(),last=+d.last,open=+d.open24h;this.markets.set(this.pair.base,{...m,last,change:open?(last-open)/open*100:m.change,high:+d.high24h||m.high,low:+d.low24h||m.low,volumeQuote:+d.volCcy24h||m.volumeQuote,ts:Date.now()});const c=this.candles.at(-1);if(c){const updated={...c,close:last,high:Math.max(c.high,last),low:Math.min(c.low,last)};this.candles[this.candles.length-1]=updated;this.emit('candle',{candle:updated})}this.emit('ticker',{market:this.currentMarket()});this.checkOrders()};ws.onclose=()=>setTimeout(()=>{if(this.ws===ws)this.connectWS()},3500)}catch{}}
 placeOrder({side,orderType,amount,price,amountUnit,positionAction='open',leverage=1,marginMode='cross'}){const m=this.currentMarket(),qty=amountUnit==='USDT'?amount/Math.max(price||m.last,1):amount,px=orderType==='market'?m.last:price;if(!qty||qty<=0||!px)return{ok:false,message:'请输入有效数量'};if(orderType==='limit'){this.account.orders.unshift({id:uid(),base:this.pair.base,product:this.product,side,positionAction,price:px,qty,leverage,marginMode,createdAt:Date.now()});this.saveAccount();return{ok:true,message:'限价委托已提交'}}return this.executeTrade({base:this.pair.base,product:this.product,side,positionAction,qty,price:px,leverage,marginMode})}
 executeTrade(o){const fee=o.qty*o.price*(o.product==='perp'?.0006:.001),key=o.product==='spot'?`${o.base}-spot`:`${o.base}-perp`,pos=this.account.positions[key];if(o.product==='spot'){
   if(o.side==='buy'){const cost=o.qty*o.price+fee;if(cost>this.account.cash)return{ok:false,message:'可用余额不足'};this.account.cash-=cost;if(pos){const total=pos.qty+o.qty;pos.avg=(pos.avg*pos.qty+o.price*o.qty)/total;pos.qty=total}else this.account.positions[key]={key,base:o.base,type:'spot',qty:o.qty,avg:o.price}}
   else{if(!pos||pos.qty<o.qty)return{ok:false,message:'持仓数量不足'};this.account.cash+=o.qty*o.price-fee;pos.qty-=o.qty;if(pos.qty<1e-10)delete this.account.positions[key]}
  }else{
   const signed=o.side==='buy'?o.qty:-o.qty,margin=Math.abs(o.qty*o.price/o.leverage);
   if(o.positionAction==='open'){if(margin+fee>this.account.cash)return{ok:false,message:'保证金不足'};this.account.cash-=margin+fee;if(pos&&Math.sign(pos.qty)===Math.sign(signed)){const total=Math.abs(pos.qty)+Math.abs(signed);pos.avg=(pos.avg*Math.abs(pos.qty)+o.price*Math.abs(signed))/total;pos.qty+=signed;pos.margin+=margin}else if(pos){const close=Math.min(Math.abs(pos.qty),Math.abs(signed));this.closePerp(pos,close,o.price,fee);const remain=Math.abs(signed)-close;if(remain>1e-10)this.account.positions[key]={key,base:o.base,type:'perp',qty:Math.sign(signed)*remain,avg:o.price,margin:remain*o.price/o.leverage,leverage:o.leverage,marginMode:o.marginMode}}else this.account.positions[key]={key,base:o.base,type:'perp',qty:signed,avg:o.price,margin,leverage:o.leverage,marginMode:o.marginMode}}
   else{if(!pos)return{ok:false,message:'当前没有可平仓位'};const close=Math.min(Math.abs(pos.qty),o.qty);this.closePerp(pos,close,o.price,fee)}
  }
  this.account.fees+=fee;this.account.trades.unshift({id:uid(),...o,fee,filledAt:Date.now()});this.saveAccount();return{ok:true,message:'模拟成交成功'}
 }
 closePerp(pos,qty,price,fee=0){const pnl=(price-pos.avg)*qty*Math.sign(pos.qty),release=pos.margin*(qty/Math.abs(pos.qty));this.account.cash+=release+pnl-fee;pos.qty-=qty*Math.sign(pos.qty);pos.margin-=release;if(Math.abs(pos.qty)<1e-10)delete this.account.positions[pos.key]}
 closePosition(key){const p=this.account.positions[key];if(!p)return;const px=this.currentMarket(p.base).last;if(p.type==='spot')this.executeTrade({base:p.base,product:'spot',side:'sell',positionAction:'close',qty:p.qty,price:px,leverage:1});else this.closePerp(p,Math.abs(p.qty),px,0);this.saveAccount()}
 cancelOrder(id){this.account.orders=this.account.orders.filter(x=>x.id!==id);this.saveAccount()}
 checkOrders(){const remain=[];for(const o of this.account.orders){const last=this.currentMarket(o.base).last,hit=o.side==='buy'?last<=o.price:last>=o.price;if(hit)this.executeTrade({...o,price:o.price});else remain.push(o)}this.account.orders=remain;this.saveAccount()}
 equity(){let unrealized=0,value=0;for(const p of Object.values(this.account.positions)){const px=this.currentMarket(p.base).last||p.avg,pnl=(px-p.avg)*p.qty;unrealized+=pnl;value+=p.type==='spot'?px*p.qty:p.margin+pnl}return{equity:this.account.cash+value,unrealized,value}}
 exportReport(){return{version:'V14',generatedAt:new Date().toISOString(),account:this.account,equity:this.equity()}}
}
window.AtlasEngine=AtlasEngine;
})();
