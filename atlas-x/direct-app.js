(()=>{
'use strict';
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const formatNumber=(n)=>{
 if(!Number.isFinite(+n))return'--';
 const a=Math.abs(n);return Number(n).toLocaleString('en-US',{maximumFractionDigits:a>=1000?1:a>=1?4:8});
};
class AtlasProChart{
 constructor(canvas,overlay){
  this.canvas=canvas;this.overlay=overlay;this.ctx=canvas.getContext('2d');this.octx=overlay.getContext('2d');
  this.data=[];this.visibleCount=72;this.offset=0;this.hover=-1;this.selected=-1;this.drag=null;this.pointers=new Map();this.pinch=null;this.raf=0;this.bounds=null;
  this.options={ema:true,volume:true,boll:false,subIndicator:'none'};this.levels=[];this.timeframe='1H';this.onSelect=null;this.onHover=null;this.onSeries=null;this.onViewChange=null;
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.bind();this.resize();
 }
 bind(){
  const el=this.overlay;
  el.addEventListener('contextmenu',e=>e.preventDefault());
  el.addEventListener('pointerdown',e=>{
   e.preventDefault();el.setPointerCapture?.(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(this.pointers.size===2){const p=[...this.pointers.values()];this.pinch={dist:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),count:this.visibleCount,offset:this.offset};this.drag=null;return}
   this.drag={x:e.clientX,y:e.clientY,offset:this.offset,moved:false,time:performance.now()};
  });
  el.addEventListener('pointermove',e=>{
   if(this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(this.pointers.size===2&&this.pinch){const p=[...this.pointers.values()],dist=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);if(dist>12){const next=clamp(Math.round(this.pinch.count*this.pinch.dist/dist),24,Math.min(220,this.data.length||220));this.visibleCount=next;this.offset=clamp(this.pinch.offset,0,Math.max(0,this.data.length-next));this.schedule();this.onViewChange?.(next)}return}
   if(this.drag){const dx=e.clientX-this.drag.x;if(Math.abs(dx)>7)this.drag.moved=true;const step=Math.max(3,this.bounds?.candleW||8);this.offset=clamp(Math.round(this.drag.offset-dx/step),0,Math.max(0,this.data.length-this.visibleCount));this.schedule();return}
   this.updateHover(e.clientX,e.clientY);
  });
  const finish=e=>{
   e.preventDefault();const drag=this.drag;this.pointers.delete(e.pointerId);if(this.pointers.size<2)this.pinch=null;this.drag=null;
   if(!drag)return;const moved=drag.moved||Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>13,age=performance.now()-drag.time;if(!moved&&age<900)this.selectAt(e.clientX,e.clientY);
  };
  el.addEventListener('pointerup',finish);el.addEventListener('pointercancel',e=>{this.pointers.delete(e.pointerId);this.drag=null;this.pinch=null});
  el.addEventListener('pointerleave',()=>{if(!this.drag&&this.selected<0){this.hover=-1;this.drawOverlay()}});
  el.addEventListener('wheel',e=>{e.preventDefault();const old=this.visibleCount,f=e.deltaY>0?1.12:.9;const next=clamp(Math.round(old*f),24,Math.min(220,this.data.length||220));const r=el.getBoundingClientRect(),ratio=clamp((e.clientX-r.left)/(r.width||1),0,1),delta=next-old;this.visibleCount=next;this.offset=clamp(Math.round(this.offset+delta*(1-ratio)),0,Math.max(0,this.data.length-next));this.schedule();this.onViewChange?.(next)},{passive:false});
 }
 setData(data){this.data=(data||[]).slice().sort((a,b)=>a.time-b.time);this.offset=0;this.visibleCount=clamp(Math.min(72,this.data.length||72),24,120);this.selected=-1;this.schedule()}
 update(c){if(!c)return;const last=this.data.at(-1);if(last&&last.time===c.time)this.data[this.data.length-1]=c;else if(!last||c.time>last.time)this.data.push(c);if(this.data.length>800)this.data.shift();this.schedule()}
 setOption(name,value){this.options[name]=value;this.schedule()}
 setTimeframe(tf){this.timeframe=tf;this.schedule()}
 setLevels(levels){this.levels=Array.isArray(levels)?levels:[];this.schedule()}
 fit(){this.offset=0;this.visibleCount=clamp(Math.min(72,this.data.length||72),24,120);this.selected=-1;this.hover=-1;this.schedule()}
 clearSelection(){this.selected=-1;this.hover=-1;this.drawOverlay()}
 resize(){const host=this.canvas.parentElement,r=host.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);if(!r.width||!r.height)return;for(const c of [this.canvas,this.overlay]){c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);c.style.width=r.width+'px';c.style.height=r.height+'px'}this.dpr=d;this.width=r.width;this.height=r.height;this.schedule()}
 schedule(){if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw()})}
 visible(){const end=Math.max(0,this.data.length-this.offset),start=Math.max(0,end-this.visibleCount);return{items:this.data.slice(start,end),start,end}}
 calcBounds(items){
  const mobile=this.width<600,sub=this.options.subIndicator&&this.options.subIndicator!=='none',volumeH=this.options.volume?(mobile?30:40):0,subH=sub?(mobile?62:76):0,pad={l:0,r:mobile?64:76,t:38,b:35+volumeH+subH+(volumeH?8:0)+(subH?10:0)},mainH=Math.max(105,this.height-pad.t-pad.b);
  let min=Math.min(...items.map(x=>x.low)),max=Math.max(...items.map(x=>x.high));if(!Number.isFinite(min)||!Number.isFinite(max)){min=0;max=1}let spread=max-min||Math.max(1,max*.01);min-=spread*.075;max+=spread*.08;spread=max-min;const plotW=this.width-pad.l-pad.r,candleW=plotW/Math.max(1,items.length),volumeTop=pad.t+mainH+7,subTop=volumeTop+volumeH+(volumeH?9:0);return{...pad,mainH,min,max,spread,plotW,candleW,volumeTop,volumeH,subTop,subH}
 }
 xFor(i,b){return b.l+(i+.5)*b.candleW} yFor(v,b){return b.t+(b.max-v)/b.spread*b.mainH}
 draw(){
  const d=this.dpr||1,ctx=this.ctx,w=this.width||1,h=this.height||1;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
  const {items,start}=this.visible();if(items.length<2){this.drawOverlay();return}const b=this.bounds=this.calcBounds(items);
  const root=getComputedStyle(document.documentElement),green=root.getPropertyValue('--green').trim()||'#78bd00',red=root.getPropertyValue('--red').trim()||'#f33d94',line=root.getPropertyValue('--line').trim()||'#eceef0',muted=root.getPropertyValue('--muted').trim()||'#8b9098';
  ctx.lineWidth=1;ctx.font='11px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textBaseline='middle';
  for(let i=0;i<=5;i++){const y=b.t+b.mainH*i/5,p=b.max-b.spread*i/5;ctx.strokeStyle=line;ctx.beginPath();ctx.moveTo(0,y+.5);ctx.lineTo(w-b.r,y+.5);ctx.stroke();ctx.fillStyle=muted;ctx.textAlign='left';ctx.fillText(formatNumber(p),w-b.r+7,y)}
  const steps=Math.max(3,Math.min(5,Math.floor(b.plotW/110)));for(let i=0;i<steps;i++){const idx=Math.round((items.length-1)*i/(steps-1)),x=this.xFor(idx,b);ctx.strokeStyle=line;ctx.beginPath();ctx.moveTo(x+.5,b.t);ctx.lineTo(x+.5,b.t+b.mainH+b.volumeH+8);ctx.stroke();const dt=new Date(items[idx].time*1000);ctx.fillStyle=muted;ctx.textAlign='center';ctx.fillText(`${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`,x,h-12)}
  if(this.options.volume){const vmax=Math.max(1,...items.map(x=>x.volume||0));items.forEach((c,i)=>{const x=this.xFor(i,b),bw=Math.max(1,Math.min(8,b.candleW*.6)),vh=(c.volume||0)/vmax*b.volumeH;ctx.fillStyle=(c.close>=c.open?green:red)+'45';ctx.fillRect(x-bw/2,b.volumeTop+b.volumeH-vh,bw,vh)})}
  items.forEach((c,i)=>{const x=this.xFor(i,b),yo=this.yFor(c.open,b),yc=this.yFor(c.close,b),yh=this.yFor(c.high,b),yl=this.yFor(c.low,b),up=c.close>=c.open,col=up?green:red,bw=Math.max(2,Math.min(10,b.candleW*.64));ctx.strokeStyle=col;ctx.beginPath();ctx.moveTo(x,yh);ctx.lineTo(x,yl);ctx.stroke();ctx.fillStyle=col;ctx.fillRect(x-bw/2,Math.min(yo,yc),bw,Math.max(1.5,Math.abs(yc-yo)))});
  const closes=items.map(x=>x.close);
  if(this.options.ema){const e10=this.ema(closes,10),e20=this.ema(closes,20);this.drawLine(e10,b,'#ff8a00',1.5);this.drawLine(e20,b,'#f33d94',1.45);this.onSeries?.({ema10:e10.at(-1),ema20:e20.at(-1)})}
  if(this.options.boll){const bo=this.boll(closes,20);this.drawLine(bo.upper,b,'rgba(79,104,255,.72)',1);this.drawLine(bo.mid,b,'rgba(111,86,180,.76)',1);this.drawLine(bo.lower,b,'rgba(79,104,255,.72)',1)}
  if(b.subH)this.drawSubIndicator(ctx,items,closes,b,w,line,muted);
  const hi=Math.max(...items.map(x=>x.high)),lo=Math.min(...items.map(x=>x.low)),hiIdx=items.findIndex(x=>x.high===hi),loIdx=items.findIndex(x=>x.low===lo);this.marker(ctx,this.xFor(hiIdx,b),this.yFor(hi,b),formatNumber(hi),true,w,b);this.marker(ctx,this.xFor(loIdx,b),this.yFor(lo,b),formatNumber(lo),false,w,b);
  for(const level of this.levels){if(!Number.isFinite(level.price)||level.price<b.min||level.price>b.max)continue;const yy=this.yFor(level.price,b);ctx.save();ctx.strokeStyle=level.color||'#5f6b7a';ctx.setLineDash(level.dash||[5,4]);ctx.beginPath();ctx.moveTo(0,yy+.5);ctx.lineTo(w-b.r,yy+.5);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=level.color||'#5f6b7a';ctx.font='10px -apple-system';ctx.textAlign='left';ctx.fillText(level.label||formatNumber(level.price),8,yy-8);ctx.restore()}
  const last=items.at(-1),ly=this.yFor(last.close,b),color=last.close>=last.open?green:red;ctx.strokeStyle='#656a72';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,ly+.5);ctx.lineTo(w-b.r,ly+.5);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fff';ctx.strokeStyle='#8c9096';ctx.strokeRect(w-b.r+3,ly-22,b.r-7,44);ctx.fillRect(w-b.r+4,ly-21,b.r-9,42);ctx.fillStyle='#51565d';ctx.textAlign='center';ctx.font='700 12px -apple-system';ctx.fillText(formatNumber(last.close),w-b.r/2,ly-8);ctx.font='11px -apple-system';ctx.fillText(this.countdown(last.time),w-b.r/2,ly+10);
  this.startIndex=start;this.drawOverlay();
 }
 drawLine(vals,b,color,width){const ctx=this.ctx;ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;let begun=false;vals.forEach((v,i)=>{if(v==null)return;const x=this.xFor(i,b),y=this.yFor(v,b);if(!begun){ctx.moveTo(x,y);begun=true}else ctx.lineTo(x,y)});ctx.stroke();ctx.lineWidth=1}
 sma(a,n){return a.map((_,i)=>i<n-1?null:a.slice(i-n+1,i+1).reduce((s,v)=>s+v,0)/n)}
 ema(a,n){const k=2/(n+1);let p=null;return a.map(v=>(p=p==null?v:v*k+p*(1-k)))}
 boll(a,n){const mid=[],upper=[],lower=[];a.forEach((_,i)=>{if(i<n-1){mid.push(null);upper.push(null);lower.push(null);return}const x=a.slice(i-n+1,i+1),m=x.reduce((s,v)=>s+v,0)/n,sd=Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/n);mid.push(m);upper.push(m+sd*2);lower.push(m-sd*2)});return{mid,upper,lower}}
 rsi(a,n=14){const out=Array(a.length).fill(null);let gain=0,loss=0;for(let i=1;i<a.length;i++){const d=a[i]-a[i-1],g=Math.max(0,d),l=Math.max(0,-d);if(i<=n){gain+=g;loss+=l;if(i===n){gain/=n;loss/=n;out[i]=loss===0?100:100-100/(1+gain/loss)}}else{gain=(gain*(n-1)+g)/n;loss=(loss*(n-1)+l)/n;out[i]=loss===0?100:100-100/(1+gain/loss)}}return out}
 macd(a){const fast=this.ema(a,12),slow=this.ema(a,26),dif=a.map((_,i)=>fast[i]-slow[i]),dea=this.ema(dif,9),hist=dif.map((v,i)=>(v-dea[i])*2);return{dif,dea,hist}}
 drawSubIndicator(ctx,items,closes,b,w,line,muted){const top=b.subTop,h=b.subH;ctx.save();ctx.strokeStyle=line;ctx.beginPath();ctx.moveTo(0,top+.5);ctx.lineTo(w-b.r,top+.5);ctx.stroke();if(this.options.subIndicator==='rsi'){const vals=this.rsi(closes),y=v=>top+(100-v)/100*h;for(const v of [30,70]){ctx.strokeStyle='rgba(139,144,152,.3)';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(0,y(v));ctx.lineTo(w-b.r,y(v));ctx.stroke()}ctx.setLineDash([]);ctx.strokeStyle='#6c7cff';ctx.lineWidth=1.25;ctx.beginPath();let open=false;vals.forEach((v,i)=>{if(v==null)return;const x=this.xFor(i,b),yy=y(v);open?ctx.lineTo(x,yy):(ctx.moveTo(x,yy),open=true)});ctx.stroke();ctx.fillStyle=muted;ctx.font='10px -apple-system';ctx.textAlign='left';ctx.fillText(`RSI14 ${vals.at(-1)?.toFixed(2)||'--'}`,8,top+11)}else{const m=this.macd(closes),all=[...m.dif.filter(Number.isFinite),...m.dea.filter(Number.isFinite),...m.hist.filter(Number.isFinite)],mx=Math.max(.00001,...all.map(Math.abs)),y=v=>top+h/2-v/mx*(h*.42);m.hist.forEach((v,i)=>{const x=this.xFor(i,b),yy=y(v),zero=y(0);ctx.fillStyle=v>=0?'rgba(120,189,0,.52)':'rgba(243,61,148,.48)';ctx.fillRect(x-Math.max(1,b.candleW*.25),Math.min(yy,zero),Math.max(1,b.candleW*.5),Math.max(1,Math.abs(zero-yy)))});for(const [vals,col] of [[m.dif,'#ff8a00'],[m.dea,'#6c7cff']]){ctx.strokeStyle=col;ctx.lineWidth=1;ctx.beginPath();let open=false;vals.forEach((v,i)=>{const x=this.xFor(i,b),yy=y(v);open?ctx.lineTo(x,yy):(ctx.moveTo(x,yy),open=true)});ctx.stroke()}ctx.fillStyle=muted;ctx.font='10px -apple-system';ctx.textAlign='left';ctx.fillText(`MACD ${m.dif.at(-1).toFixed(2)}  DEA ${m.dea.at(-1).toFixed(2)}`,8,top+11)}ctx.restore()}
 marker(ctx,x,y,text,top,w,b){const right=x>w*.68,dir=right?-1:1,len=42;ctx.strokeStyle='#2d3035';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dir*len,y);ctx.stroke();ctx.fillStyle='#555a61';ctx.textAlign=right?'right':'left';ctx.fillText(text,x+dir*(len+4),y+(top?-9:11))}
 countdown(ts){const duration={'1m':60,'5m':300,'15m':900,'30m':1800,'1H':3600,'4H':14400,'1D':86400,'1W':604800}[this.timeframe]||3600,sec=Math.max(0,duration-(Math.floor(Date.now()/1000)-ts));return`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}
 indexAt(clientX){const r=this.overlay.getBoundingClientRect(),x=clientX-r.left,b=this.bounds;if(!b)return 0;return clamp(Math.floor((x-b.l)/b.candleW),0,Math.max(0,this.visible().items.length-1))}
 updateHover(x,y){const r=this.overlay.getBoundingClientRect();if(x<r.left||x>r.right||y<r.top||y>r.bottom)return;this.hover=this.indexAt(x);this.drawOverlay();const c=this.visible().items[this.hover];if(c)this.onHover?.(c)}
 selectAt(x,y){const r=this.overlay.getBoundingClientRect();if(y<r.top||y>r.bottom)return;this.selected=this.indexAt(x);const c=this.visible().items[this.selected];if(c){this.onSelect?.(c);this.drawOverlay()}}
 drawOverlay(){const d=this.dpr||1,ctx=this.octx,w=this.width||1,h=this.height||1;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);const idx=this.selected>=0?this.selected:this.hover,{items}=this.visible(),b=this.bounds;if(idx<0||!items[idx]||!b)return;const c=items[idx],x=this.xFor(idx,b),y=this.yFor(c.close,b);ctx.strokeStyle='rgba(69,73,80,.64)';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x,b.t);ctx.lineTo(x,b.t+b.mainH+b.volumeH+8);ctx.moveTo(0,y);ctx.lineTo(w-b.r,y);ctx.stroke();ctx.setLineDash([]);const time=new Date(c.time*1000).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});ctx.font='11px -apple-system';ctx.textAlign='center';const tw=Math.min(154,ctx.measureText(time).width+18),tx=clamp(x-tw/2,3,w-b.r-tw-3);ctx.fillStyle='#4c5056';ctx.fillRect(tx,h-28,tw,24);ctx.fillStyle='#fff';ctx.fillText(time,tx+tw/2,h-16);ctx.fillStyle='#4c5056';ctx.fillRect(w-b.r+3,y-13,b.r-7,26);ctx.fillStyle='#fff';ctx.fillText(formatNumber(c.close),w-b.r/2,y)}
 destroy(){this.resizeObserver.disconnect();cancelAnimationFrame(this.raf)}
}
window.AtlasProChart=AtlasProChart;
})();

;
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

;
(()=>{
'use strict';
const $=(s,p=document)=>p.querySelector(s),$$=(s,p=document)=>[...p.querySelectorAll(s)];
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const fmt=(n,d=2)=>Number.isFinite(+n)?Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'--';
const compact=n=>Number.isFinite(+n)?new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(+n):'--';
const money=n=>Number.isFinite(+n)?'$'+fmt(n,2):'--';
const pct=n=>Number.isFinite(+n)?`${n>=0?'+':''}${Number(n).toFixed(2)}%`:'--';
window.__ATLAS_UI_HELPERS={$, $$, clamp, fmt, compact, money, pct};
class AtlasUI{
 constructor(engine,chart){this.engine=engine;this.chart=chart;this.mode='spot';this.bottomPage='trade';this.side='buy';this.positionAction='open';this.orderType='market';this.amountUnit='USDT';this.marginMode='cross';this.leverage=10;this.accountTab='positions';this.sheet=null;this.chartPinned=false;this.toastTimer=null;this.bind();this.bindEngine();this.seedUtility();this.renderAll()}
 toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>t.classList.remove('show'),2100)}
 bindEngine(){
  this.engine.addEventListener('markets',()=>{this.renderQuote();this.renderMarkets();this.renderConvert();this.renderAssets();this.renderAnalysis()});
  this.engine.addEventListener('ticker',()=>{this.renderQuote();this.renderOrderForm();this.renderAssets();this.renderAnalysis()});
  this.engine.addEventListener('candles',e=>{this.chart.setData(e.detail.candles);$('#chartLoading').classList.add('hide')});
  this.engine.addEventListener('candle',e=>this.chart.update(e.detail.candle));
  this.engine.addEventListener('book',()=>this.renderBook());
  this.engine.addEventListener('account',()=>{this.renderAccount();this.renderOrderForm();this.renderAssets();this.renderAnalysis()});
  this.engine.addEventListener('connection',e=>this.renderConnection(e.detail.connected));
  this.engine.addEventListener('favorites',()=>this.renderFavorite());
  this.chart.onSelect=c=>{this.chartPinned=true;this.showChartInfo(c)};
  this.chart.onHover=c=>{if(innerWidth>900&&!this.chartPinned)this.showChartInfo(c)};
  this.chart.onSeries=s=>{const d=this.engine.pair.decimals;$('#emaFastLabel').textContent=`EMA10: ${fmt(s.ema10,d)}`;$('#emaSlowLabel').textContent=`EMA20: ${fmt(s.ema20,d)}`};
 }
 intro(){const intro=$('#presentationIntro'),app=$('#app'),enter=()=>{if(intro.classList.contains('hide'))return;intro.classList.add('hide');app.classList.add('ready');app.setAttribute('aria-hidden','false');setTimeout(()=>{intro.hidden=true;this.chart.resize()},190)};$('#enterDemo').onclick=enter;window.__ATLAS_ENTER=enter}
 bind(){
  this.intro();
  $$('.product-tabs [data-mode]').forEach(b=>b.onclick=()=>this.switchMode(b.dataset.mode));
  $$('[data-bottom-nav]').forEach(b=>b.onclick=()=>this.navigateBottom(b.dataset.bottomNav));
  $('#instrumentButton').onclick=()=>this.openSheet('instrumentSheet');
  $('#favoriteButton').onclick=()=>this.engine.toggleFavorite();
  $('#chartModeButton').onclick=()=>this.openSheet('indicatorSheet');
  $('#indicatorButton').onclick=()=>this.openSheet('indicatorSheet');
  $('#moreButton').onclick=()=>this.openSheet('moreSheet');
  $('#latestButton').onclick=()=>{this.chart.fit();this.hideChartInfo();this.toast('已回到最新K线')};
  $('#fullscreenButton').onclick=()=>this.toggleFullscreen();
  $('#closeChartInfo').onclick=()=>this.hideChartInfo();
  $$('#timeframeTabs [data-timeframe]').forEach(b=>b.onclick=()=>{this.engine.setTimeframe(b.dataset.timeframe);$$('#timeframeTabs button').forEach(x=>x.classList.toggle('active',x===b));this.hideChartInfo()});
  $$('#spotSideTabs [data-side]').forEach(b=>b.onclick=()=>{this.side=b.dataset.side;this.renderOrderForm()});
  $$('#perpActionTabs [data-position-action]').forEach(b=>b.onclick=()=>{this.positionAction=b.dataset.positionAction;this.renderOrderForm()});
  $('#leverageToggle').onchange=e=>{this.leverage=e.target.checked?10:1;this.renderOrderForm()};
  $('#marginModeButton').onclick=()=>this.showOptions('保证金模式','合约设置',[{value:'cross',label:'全仓'},{value:'isolated',label:'逐仓'}],this.marginMode,v=>{this.marginMode=v;this.renderOrderForm()});
  $('#leverageButton').onclick=()=>this.showOptions('杠杆倍数','合约设置',[1,2,3,5,10,20,50].map(v=>({value:String(v),label:`${v}x`})),String(this.leverage),v=>{this.leverage=+v;$('#leverageToggle').checked=this.leverage>1;this.renderOrderForm()});
  $('#orderTypeButton').onclick=()=>this.showOptions('订单类型','交易设置',[{value:'market',label:'市价委托'},{value:'limit',label:'限价委托'}],this.orderType,v=>{this.orderType=v;this.renderOrderForm()});
  $('#amountUnitButton').onclick=()=>this.showOptions('数量单位','下单设置',[{value:'USDT',label:'USDT 金额'},{value:this.engine.pair.base,label:`${this.engine.pair.base} 数量`}],this.amountUnit,v=>{this.amountUnit=v;this.renderOrderForm()});
  $('#orderAmount').oninput=()=>this.renderOrderForm();$('#orderPrice').oninput=()=>this.renderOrderForm();
  $('#amountSlider').oninput=e=>{const value=+e.target.value;e.target.style.setProperty('--range',`${value}%`);$('#orderAmount').value=this.sliderAmount(value).toFixed(this.amountUnit==='USDT'?2:6);this.renderOrderForm()};
  $('#submitOrder').onclick=()=>this.placeOrder();
  $$('#accountTabs [data-account-tab]').forEach(b=>b.onclick=()=>{this.accountTab=b.dataset.accountTab;this.renderAccount()});
  $('#instrumentSearch').oninput=()=>this.renderInstrumentList();$('#marketSearch').oninput=()=>this.renderMarkets();
  $$('[data-close-sheet]').forEach(el=>el.onclick=()=>this.closeSheet(el.dataset.closeSheet));
  $$('[data-chart-setting]').forEach(b=>b.onclick=()=>this.chartSetting(b.dataset.chartSetting));
  $('#resetAccountButton').onclick=()=>{this.engine.resetAccount();this.closeSheet('moreSheet');this.toast('模拟账户已重置')};
  $('#exportButton').onclick=()=>this.exportReport();
  $('#aboutButton').onclick=()=>{this.closeSheet('moreSheet');setTimeout(()=>this.openSheet('aboutSheet'),80)};
  $('#convertPay').oninput=()=>this.renderConvert();$('#convertSubmit').onclick=()=>this.toast('模拟兑换已完成');$('#swapAssetsButton').onclick=()=>this.toast('已交换支付与获得资产');
  $('#convertFromButton').onclick=()=>this.showOptions('支付资产','闪兑设置',[{value:'USDT',label:'USDT'},{value:'ETH',label:'ETH'}],'USDT',()=>this.toast('支付资产已切换'));
  $('#convertToButton').onclick=()=>this.showOptions('获得资产','闪兑设置',this.engine.pairs.slice(0,4).map(p=>({value:p.base,label:p.base})),'BTC',()=>this.toast('获得资产已切换'));
  window.addEventListener('popstate',()=>{if(this.sheet)this.closeSheet(this.sheet,true);if($('#chartSection').classList.contains('fullscreen'))this.exitFullscreen(true)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(this.sheet)this.closeSheet(this.sheet);else if($('#chartSection').classList.contains('fullscreen'))this.exitFullscreen();else this.hideChartInfo()}});
  window.addEventListener('resize',()=>this.chart.resize(),{passive:true});
 }
}
window.AtlasUI=AtlasUI;
})();

;
(()=>{
'use strict';
const {$,$$,clamp,fmt,compact,money,pct}=window.__ATLAS_UI_HELPERS;
Object.assign(window.AtlasUI.prototype,{
 switchMode(mode){
  $$('.product-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  $$('.bottom-page').forEach(p=>p.classList.remove('active'));
  this.bottomPage='trade';$$('[data-bottom-nav]').forEach(b=>b.classList.toggle('active',b.dataset.bottomNav==='trade'));
  $$('.mode-panel').forEach(p=>p.classList.remove('active'));
  if(mode==='spot'||mode==='perp'){$('[data-mode-panel="spot"]').classList.add('active');this.mode=mode;this.engine.setProduct(mode);this.renderProduct();setTimeout(()=>this.chart.resize(),50)}
  else{$(`[data-mode-panel="${mode}"]`).classList.add('active');this.mode=mode;setTimeout(()=>window.scrollTo({top:0,behavior:'instant'}),0)}
 },
 navigateBottom(page){this.bottomPage=page;$$('[data-bottom-nav]').forEach(b=>b.classList.toggle('active',b.dataset.bottomNav===page));$$('.mode-panel,.bottom-page').forEach(p=>p.classList.remove('active'));if(page==='trade'){$('[data-mode-panel="spot"]').classList.add('active');$$('.product-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.mode===this.engine.product));setTimeout(()=>this.chart.resize(),50)}else{$(`[data-bottom-page="${page}"]`).classList.add('active');this.renderAll()}window.scrollTo({top:0,behavior:'instant'})},
 openSheet(id){if(this.sheet&&this.sheet!==id)this.closeSheet(this.sheet,true);const el=$('#'+id);if(!el)return;this.sheet=id;el.hidden=false;document.body.style.overflow='hidden';requestAnimationFrame(()=>el.classList.add('open'));history.pushState({atlasSheet:id},'')},
 closeSheet(id,fromPop=false){const el=$('#'+id);if(!el||el.hidden)return;el.classList.remove('open');setTimeout(()=>{el.hidden=true;if(!$$('.sheet.open').length)document.body.style.overflow=''},230);if(this.sheet===id)this.sheet=null;if(!fromPop&&history.state?.atlasSheet===id)history.back()},
 showOptions(title,eyebrow,items,current,onSelect){$('#optionSheetTitle').textContent=title;$('#optionSheetEyebrow').textContent=eyebrow;$('#optionList').innerHTML=items.map(x=>`<button class="option-item ${String(x.value)===String(current)?'active':''}" data-value="${x.value}">${x.label}</button>`).join('');$$('#optionList .option-item').forEach(b=>b.onclick=()=>{onSelect(b.dataset.value);this.closeSheet('optionSheet')});this.openSheet('optionSheet')},
 toggleFullscreen(){const s=$('#chartSection');if(s.classList.contains('fullscreen'))return this.exitFullscreen();s.classList.add('fullscreen');history.pushState({atlasFullscreen:true},'');setTimeout(()=>this.chart.resize(),50);s.onclick=e=>{if(e.target===s||e.target.closest('canvas'))return;if(e.target===s)this.exitFullscreen()}},
 exitFullscreen(fromPop=false){const s=$('#chartSection');if(!s.classList.contains('fullscreen'))return;s.classList.remove('fullscreen');setTimeout(()=>this.chart.resize(),50);if(!fromPop&&history.state?.atlasFullscreen)history.back()},
 showChartInfo(c){const d=this.engine.pair.decimals,chg=c.open?(c.close-c.open)/c.open*100:0,amp=c.open?(c.high-c.low)/c.open*100:0,vals={time:new Date(c.time*1000).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}),open:fmt(c.open,d),high:fmt(c.high,d),low:fmt(c.low,d),close:fmt(c.close,d),change:pct(chg),amplitude:`${amp.toFixed(2)}%`,volume:compact(c.volume)};for(const[k,v]of Object.entries(vals))$(`[data-chart="${k}"]`).textContent=v;const ce=$('[data-chart="change"]');ce.className=chg>=0?'positive':'negative';$('#chartInfo').hidden=false},
 hideChartInfo(){this.chartPinned=false;$('#chartInfo').hidden=true;this.chart.clearSelection()},
 renderAll(){this.renderProduct();this.renderQuote();this.renderBook();this.renderOrderForm();this.renderAccount();this.renderInstrumentList();this.renderMarkets();this.renderAssets();this.renderAnalysis();this.renderConvert();this.renderFavorite()},
 renderProduct(){const perp=this.engine.product==='perp';$('#instrumentBadge').textContent=perp?'永续':'现货';$('#spotSideTabs').classList.toggle('hidden',perp);$('#perpActionTabs').classList.toggle('hidden',!perp);$('#perpControls').classList.toggle('hidden',!perp);$('#leverageToggleWrap').classList.toggle('hidden',perp);$('#sheetMarketTitle').textContent=perp?'永续合约':'现货市场';this.renderQuote();this.renderOrderForm();this.renderInstrumentList()},
 renderConnection(online=this.engine.connected){const el=$('#connectionStatus');el.classList.toggle('online',online);el.classList.toggle('offline',!online);el.querySelector('span').textContent=online?'实时':'演示数据'},
 renderFavorite(){const b=$('#favoriteButton');b.classList.toggle('active',this.engine.favorite.has(this.engine.pair.base));b.setAttribute('aria-label',this.engine.favorite.has(this.engine.pair.base)?'移出自选':'加入自选')}
});
})();

;
(()=>{
'use strict';
const {$,$$,clamp,fmt,compact,money,pct}=window.__ATLAS_UI_HELPERS;
Object.assign(window.AtlasUI.prototype,{
 renderQuote(){const p=this.engine.pair,m=this.engine.currentMarket();$('#instrumentName').textContent=this.engine.product==='spot'?`${p.base}/USDT`:`${p.base}USDT`;$('#bookMidPrice').textContent=fmt(m.last,p.decimals);$('#bookMidUsd').textContent=`≈ ${money(m.last)}`;$('#bookMidChange').textContent=pct(m.change);$('#bookMidChange').className=m.change>=0?'positive':'negative';$('#bookUnit').textContent=`(${p.base})`;this.renderConvert()},
 renderBook(){const p=this.engine.pair,book=this.engine.book,all=[...book.asks,...book.bids],max=Math.max(1,...all.map(x=>x[1]));const rows=(arr,kind)=>arr.map(([px,q])=>`<div class="book-row ${kind}" style="--depth:${Math.max(5,q/max*100)}%;--depth-color:${kind==='ask'?'rgba(243,61,148,.13)':'rgba(120,189,0,.16)'}"><span>${fmt(px,p.decimals)}</span><span>${fmt(q,p.base==='BTC'?5:3)}</span></div>`).join('');$('#bookAsks').innerHTML=rows(book.asks,'ask');$('#bookBids').innerHTML=rows(book.bids,'bid');const bid=book.bids.reduce((s,x)=>s+x[1],0),ask=book.asks.reduce((s,x)=>s+x[1],0),r=bid/(bid+ask||1)*100;$('#buyRatio').textContent=`B ${r.toFixed(0)}%`;$('#sellRatio').textContent=`${(100-r).toFixed(0)}% S`;$('#ratioBar').style.width=`${r}%`},
 sliderAmount(value){const m=this.engine.currentMarket(),cash=this.engine.account.cash,pctv=value/100;if(this.amountUnit==='USDT')return cash*pctv;if(this.engine.product==='spot'&&this.side==='sell'){const pos=this.engine.account.positions[`${this.engine.pair.base}-spot`];return(pos?.qty||0)*pctv}return cash*(this.engine.product==='perp'?this.leverage:1)/Math.max(m.last,1)*pctv},
 renderOrderForm(){const p=this.engine.pair,m=this.engine.currentMarket(),perp=this.engine.product==='perp';$$('#spotSideTabs button').forEach(b=>b.classList.toggle('active',b.dataset.side===this.side));$$('#perpActionTabs button').forEach(b=>b.classList.toggle('active',b.dataset.positionAction===this.positionAction));$('#marginModeText').textContent=this.marginMode==='cross'?'全仓':'逐仓';$('#leverageText').textContent=`${this.leverage}x`;$('#orderTypeText').textContent=this.orderType==='market'?'市价委托':'限价委托';$('#priceRow').classList.toggle('hidden',this.orderType==='market');if(this.orderType==='limit'&&!$('#orderPrice').value)$('#orderPrice').value=m.last.toFixed(p.decimals);$('#amountLabel').textContent=this.amountUnit==='USDT'?'金额':'数量';$('#amountUnitText').textContent=this.amountUnit==='USDT'?'USDT':p.base;const amount=+($('#orderAmount').value||0),price=this.orderType==='market'?m.last:+($('#orderPrice').value||m.last),qty=this.amountUnit==='USDT'?amount/Math.max(price,1):amount,available=this.engine.account.cash;$('#availableBalance').textContent=`${fmt(available,2)} USDT`;let cap;if(perp)cap=available*this.leverage/Math.max(price,1);else if(this.side==='buy')cap=available/Math.max(price,1);else cap=this.engine.account.positions[`${p.base}-spot`]?.qty||0;$('#capacityLabel').textContent=perp?(this.positionAction==='open'?(this.side==='buy'?'可开多':'可开空'):'可平仓'):(this.side==='buy'?'可买':'可卖');$('#capacityValue').textContent=`${fmt(cap,6)} ${p.base}`;let label;if(perp)label=`${this.positionAction==='open'?'开':'平'}${this.side==='buy'?'多':'空'} ${this.leverage}x`;else label=`${this.side==='buy'?'买入':'卖出'} ${p.base}`;const submit=$('#submitOrder');submit.textContent=label;submit.className=`submit-order ${this.side==='buy'?'buy':'sell'}`;$('#secondaryCapacity').textContent=qty>0?`预计数量 ${fmt(qty,6)} ${p.base} · 参考价格 ${fmt(price,p.decimals)}`:'';$('#amountSlider').style.setProperty('--range',`${$('#amountSlider').value}%`)},
 placeOrder(){const amount=+($('#orderAmount').value||0),price=this.orderType==='market'?this.engine.currentMarket().last:+($('#orderPrice').value||0);const result=this.engine.placeOrder({side:this.side,orderType:this.orderType,amount,price,amountUnit:this.amountUnit,positionAction:this.positionAction,leverage:this.engine.product==='perp'?this.leverage:1,marginMode:this.marginMode});this.toast(result.message);if(result.ok){$('#orderAmount').value='';$('#amountSlider').value=0;$('#amountSlider').style.setProperty('--range','0%');this.renderAll()}},
 renderAccount(){const a=this.engine.account,positions=Object.values(a.positions),orders=a.orders,trades=a.trades;$('#positionCount').textContent=positions.length;$('#orderCount').textContent=orders.length;$$('#accountTabs button').forEach(b=>b.classList.toggle('active',b.dataset.accountTab===this.accountTab));let html='';if(this.accountTab==='positions'){html=positions.length?positions.map(p=>{const px=this.engine.currentMarket(p.base).last||p.avg,pnl=(px-p.avg)*p.qty;return`<article class="account-item"><div><h4>${p.base}/USDT · ${p.type==='spot'?'现货':`${p.leverage}x ${p.qty>0?'多':'空'}`}</h4><p>数量 ${fmt(Math.abs(p.qty),6)} · 均价 ${fmt(p.avg,this.engine.pairs.find(x=>x.base===p.base).decimals)}</p></div><aside><strong class="${pnl>=0?'positive':'negative'}">${pnl>=0?'+':''}${money(pnl)}</strong><button data-close-position="${p.key}">平仓</button></aside></article>`}).join(''):'<div class="empty-state">暂无持仓</div>'}else if(this.accountTab==='orders'){html=orders.length?orders.map(o=>`<article class="account-item"><div><h4>${o.base}/USDT · ${o.product==='spot'?'现货':'永续'}</h4><p>${o.side==='buy'?'买入/做多':'卖出/做空'} · 限价 ${fmt(o.price,this.engine.pairs.find(x=>x.base===o.base).decimals)}</p></div><aside><strong>${fmt(o.qty,6)}</strong><button data-cancel-order="${o.id}">撤单</button></aside></article>`).join(''):'<div class="empty-state">暂无当前委托</div>'}else{html=trades.length?trades.slice(0,30).map(t=>`<article class="account-item"><div><h4>${t.base}/USDT · ${t.product==='spot'?'现货':'永续'}</h4><p>${new Date(t.filledAt).toLocaleTimeString('zh-CN',{hour12:false})} · ${t.side==='buy'?'买入/做多':'卖出/做空'} ${fmt(t.qty,6)}</p></div><aside><strong>${fmt(t.price,this.engine.pairs.find(x=>x.base===t.base).decimals)}</strong><p>手续费 ${fmt(t.fee,2)}</p></aside></article>`).join(''):'<div class="empty-state">暂无成交记录</div>'}$('#accountList').innerHTML=html;$$('[data-close-position]').forEach(b=>b.onclick=()=>{this.engine.closePosition(b.dataset.closePosition);this.toast('仓位已平')});$$('[data-cancel-order]').forEach(b=>b.onclick=()=>{this.engine.cancelOrder(b.dataset.cancelOrder);this.toast('委托已撤销')})}
});
})();

;
(()=>{
'use strict';
const {$,$$,clamp,fmt,compact,money,pct}=window.__ATLAS_UI_HELPERS;
Object.assign(window.AtlasUI.prototype,{
 renderInstrumentList(){const q=$('#instrumentSearch').value.trim().toLowerCase(),rows=this.engine.pairs.filter(p=>!q||p.base.toLowerCase().includes(q)||p.name.toLowerCase().includes(q));$('#instrumentList').innerHTML=rows.map(p=>{const m=this.engine.currentMarket(p.base);return`<button class="instrument-option" data-pair="${p.base}"><span><i class="coin-icon" style="background:${p.color}">${p.icon}</i><span><b>${this.engine.product==='spot'?`${p.base}/USDT`:`${p.base}USDT`}</b><small>${p.name}</small></span></span><span><b>${fmt(m.last,p.decimals)}</b><small class="${m.change>=0?'positive':'negative'}">${pct(m.change)}</small></span></button>`}).join('');$$('[data-pair]').forEach(b=>b.onclick=()=>{this.engine.setPair(b.dataset.pair);this.amountUnit='USDT';this.closeSheet('instrumentSheet');this.renderAll()})},
 renderMarkets(){const q=$('#marketSearch').value.trim().toLowerCase(),rows=this.engine.pairs.filter(p=>!q||p.base.toLowerCase().includes(q)||p.name.toLowerCase().includes(q));$('#marketList').innerHTML=rows.map(p=>{const m=this.engine.currentMarket(p.base);return`<article class="market-item"><div class="coin"><i class="coin-icon" style="background:${p.color}">${p.icon}</i><span><b>${p.base}/USDT</b><small>${p.name}</small></span></div><span><b>${fmt(m.last,p.decimals)}</b><small>${compact(m.volumeQuote)}</small></span><span class="${m.change>=0?'positive':'negative'}"><b>${pct(m.change)}</b></span><button data-market-trade="${p.base}">交易</button></article>`}).join('');$$('[data-market-trade]').forEach(b=>b.onclick=()=>{this.engine.setPair(b.dataset.marketTrade);this.navigateBottom('trade')})},
 renderAssets(){const e=this.engine.equity(),ret=(e.equity-this.engine.account.initial)/this.engine.account.initial*100;$('#assetEquity').textContent=money(e.equity);$('#assetReturn').textContent=pct(ret);$('#assetReturn').className=ret>=0?'positive':'negative';$('#assetCash').textContent=money(this.engine.account.cash);$('#assetPnl').textContent=money(e.unrealized);const ps=Object.values(this.engine.account.positions);$('#assetPositions').innerHTML=ps.length?ps.map(p=>{const px=this.engine.currentMarket(p.base).last||p.avg,pnl=(px-p.avg)*p.qty;return`<article class="asset-position"><header><b>${p.base}/USDT · ${p.type==='spot'?'现货':`${p.leverage}x ${p.qty>0?'多':'空'}`}</b><strong class="${pnl>=0?'positive':'negative'}">${pnl>=0?'+':''}${money(pnl)}</strong></header><p>数量 ${fmt(Math.abs(p.qty),6)} · 均价 ${fmt(p.avg,this.engine.pairs.find(x=>x.base===p.base).decimals)} · 现价 ${fmt(px,this.engine.pairs.find(x=>x.base===p.base).decimals)}</p></article>`}).join(''):'<div class="empty-state">当前资产全部为 USDT</div>'},
 renderAnalysis(){const e=this.engine.equity(),ps=Object.values(this.engine.account.positions),exposure=ps.reduce((s,p)=>s+Math.abs(p.qty)*(this.engine.currentMarket(p.base).last||p.avg),0),usage=exposure/Math.max(e.equity,1),risk=Math.round(clamp(usage*40+Math.max(0,-e.unrealized/e.equity*180),0,100)),trades=this.engine.account.trades,win=trades.filter(t=>(t.realized||0)>0).length,realized=trades.reduce((s,t)=>s+(t.realized||0),0);$('#riskScore').textContent=risk;$('.risk-ring').style.setProperty('--risk',`${risk}%`);$('#riskTitle').textContent=risk<30?'风险较低':risk<65?'风险中等':'风险偏高';$('#riskText').textContent=`当前账户风险敞口 ${money(exposure)}，未实现盈亏 ${money(e.unrealized)}。`;const metrics=[['累计收益',pct((e.equity-this.engine.account.initial)/this.engine.account.initial*100)],['已实现盈亏',money(realized)],['交易次数',trades.length],['胜率',trades.length?`${(win/trades.length*100).toFixed(1)}%`:'--']];$('#analysisMetrics').innerHTML=metrics.map(x=>`<article class="metric-card"><span>${x[0]}</span><b>${x[1]}</b></article>`).join('')},
 renderConvert(){const pay=+($('#convertPay')?.value||0),m=this.engine.currentMarket('BTC');if($('#convertReceive'))$('#convertReceive').value=m.last?(pay/m.last).toFixed(6):'';if($('#convertRate'))$('#convertRate').textContent=`1 BTC ≈ ${fmt(m.last,2)} USDT`},
 seedUtility(){const chains=[['Ethereum','网络正常','Gas 低'],['Solana','网络正常','确认快速'],['Bitcoin','网络正常','内存池稳定'],['Base','网络正常','费用较低'],['Arbitrum','网络正常','活跃度高'],['BNB Chain','网络正常','交易稳定']];$('#onchainGrid').innerHTML=chains.map(x=>`<article class="feature-card"><header><div><span>NETWORK</span><h3>${x[0]}</h3></div><b class="positive">${x[1]}</b></header><p>${x[2]}，用于展示链上市场与网络状态聚合能力。</p><button data-feature-action="查看 ${x[0]}">查看详情</button></article>`).join('');const strategies=[['现货网格','震荡行情','模拟运行'],['合约网格','双向捕捉','未启动'],['定投策略','长期积累','模拟运行'],['趋势跟随','顺势执行','未启动'],['智能套利','价差监控','监控中'],['组合再平衡','控制偏离','未启动']];$('#strategyGrid').innerHTML=strategies.map(x=>`<article class="feature-card"><header><div><span>${x[1]}</span><h3>${x[0]}</h3></div><b>${x[2]}</b></header><p>完整展示策略参数、运行状态与模拟收益反馈。</p><button data-feature-action="配置 ${x[0]}">配置策略</button></article>`).join('');$$('[data-feature-action]').forEach(b=>b.onclick=()=>this.toast(`${b.dataset.featureAction}：演示入口已响应`))},
 chartSetting(type){if(type==='fit'){this.chart.fit();this.hideChartInfo();this.closeSheet('indicatorSheet');return}if(type==='ema'){this.chart.options.ema=!this.chart.options.ema;this.chart.setOption('ema',this.chart.options.ema);$('#emaSettingState').textContent=this.chart.options.ema?'显示':'隐藏'}if(type==='volume'){this.chart.options.volume=!this.chart.options.volume;this.chart.setOption('volume',this.chart.options.volume);$('#volumeSettingState').textContent=this.chart.options.volume?'显示':'隐藏'}this.chart.resize()},
 exportReport(){const blob=new Blob([JSON.stringify(this.engine.exportReport(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`atlas-v14-report-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),400);this.closeSheet('moreSheet');this.toast('账户报告已导出')}
});
})();

;
(()=>{
'use strict';
const Base=window.AtlasEngine;
if(!Base)return;
const TF_MAP={'1m':'1m','5m':'5m','15m':'15m','30m':'30m','1H':'1H','4H':'4H','1D':'1D','1W':'1W'};
const uid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const now=()=>Date.now();
const safeNum=(n,d=0)=>Number.isFinite(+n)?+n:d;
class AtlasReleaseEngine extends Base{
 constructor(){
  super();
  this.version='RC1';
  this.tradesTape=[];
  this.derivatives={fundingRate:0.0001,nextFundingAt:this.nextFundingTime(),markPrice:this.currentMarket().last,indexPrice:this.currentMarket().last,openInterest:0,longShortRatio:1,latency:0};
  this.connectionState='connecting';
  this.lastMessageAt=0;
  this.secondaryPoll=null;
  this.fundingTimer=null;
  this.marketWs=null;
  this.account=this.migrateAccount(this.account);
  this.seedTape();
 }
 migrateAccount(a){
  const fresh=this.freshAccount();
  a=a&&typeof a==='object'?a:fresh;
  a.initial=safeNum(a.initial,100000);a.cash=safeNum(a.cash,100000);a.frozen=safeNum(a.frozen,0);
  a.positions=a.positions||{};a.orders=Array.isArray(a.orders)?a.orders:[];a.trades=Array.isArray(a.trades)?a.trades:[];
  a.fees=safeNum(a.fees);a.funding=safeNum(a.funding);a.ledger=Array.isArray(a.ledger)?a.ledger:[];
  a.equityHistory=Array.isArray(a.equityHistory)?a.equityHistory:[];a.createdAt=a.createdAt||now();
  for(const o of a.orders){o.status=o.status||'open';o.filledQty=safeNum(o.filledQty);o.remainingQty=safeNum(o.remainingQty,o.qty-o.filledQty);o.tif=o.tif||'GTC'}
  return a;
 }
 freshAccount(){return{initial:100000,cash:100000,frozen:0,positions:{},orders:[],trades:[],fees:0,funding:0,ledger:[],equityHistory:[],createdAt:now()}}
 nextFundingTime(){const d=new Date(),h=d.getUTCHours(),next=[0,8,16,24].find(x=>x>h)??24;const t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),next,0,0);return t}
 seedTape(){const m=this.currentMarket(),base=m.last;this.tradesTape=Array.from({length:28},(_,i)=>({id:uid(),price:base*(1+(Math.random()-.5)*.00018),qty:(Math.random()*.45+.005)*(this.pair.base==='BTC'?1:6),side:Math.random()>.5?'buy':'sell',ts:now()-i*900})).reverse()}
 currentDerivatives(){return this.derivatives}
 availableCash(){return this.account.cash}
 lockedSpotQty(base){return this.account.orders.filter(o=>o.product==='spot'&&o.base===base&&o.side==='sell'&&['open','partial'].includes(o.status)).reduce((s,o)=>s+o.remainingQty,0)}
 availableSpot(base){const p=this.account.positions[`${base}-spot`];return Math.max(0,(p?.qty||0)-this.lockedSpotQty(base))}
 emitState(){this.emit('release',{tape:this.tradesTape,derivatives:this.derivatives,latency:this.derivatives.latency})}
 setProduct(p){if(!['spot','perp'].includes(p))return;this.product=p;this.seedBook();this.seedTape();this.derivatives.nextFundingAt=this.nextFundingTime();this.emit('product',{product:p});this.emitState();this.refreshAll();this.refreshCurrent();this.connectWS()}
 setPair(base){const p=this.pairs.find(x=>x.base===base);if(!p)return;this.pair=p;this.candles=this.seedCandles(p,this.timeframe,240);this.seedBook();this.seedTape();this.emit('pair',{pair:p});this.emit('candles',{candles:this.candles});this.emit('book',{book:this.book});this.emitState();this.refreshCurrent();this.connectWS()}
 setTimeframe(tf){if(!TF_MAP[tf])return;this.timeframe=tf;this.candles=this.seedCandles(this.pair,tf,240);this.emit('timeframe',{timeframe:tf});this.emit('candles',{candles:this.candles});this.refreshCurrent()}
 seedCandles(pair=this.pair,tf=this.timeframe,count=240){
  const seconds={'1m':60,'5m':300,'15m':900,'30m':1800,'1H':3600,'4H':14400,'1D':86400,'1W':604800}[tf]||3600;
  const current=Math.floor(Date.now()/1000/seconds)*seconds;let x=pair.seed*.972,seed=pair.base.split('').reduce((s,c)=>s+c.charCodeAt(0),0)+tf.length*113;
  const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280};const out=[];
  for(let i=count-1;i>=0;i--){const time=current-i*seconds,cycle=Math.sin((count-i)/17)*.0009,vol=(rnd()-.49)*.0085,trend=i<count*.36?.00058:i<count*.72?.00014:-.00003,open=x,close=Math.max(.000001,open*(1+vol+trend+cycle)),high=Math.max(open,close)*(1+rnd()*.0036),low=Math.min(open,close)*(1-rnd()*.0036),volume=90+rnd()*1100*(1+Math.abs(close-open)/Math.max(open,1)*15);x=close;out.push({time,open,high,low,close,volume})}
  const scale=(this.currentMarket(pair.base)?.last||pair.seed)/out.at(-1).close;return out.map(c=>({...c,open:c.open*scale,high:c.high*scale,low:c.low*scale,close:c.close*scale}))
 }
 seedBook(){const m=this.currentMarket(),mid=m.last,step=Math.max(mid*.000015,10**-this.pair.decimals),asks=[],bids=[];for(let i=12;i>=1;i--)asks.push([mid+step*i,(Math.random()*.7+.015)*(this.pair.base==='BTC'?.7:8)]);for(let i=1;i<=12;i++)bids.push([mid-step*i,(Math.random()*.7+.015)*(this.pair.base==='BTC'?.7:8)]);this.book={asks,bids}}
 async refreshAll(){const t=performance.now();await super.refreshAll();this.derivatives.latency=Math.max(0,Math.round(performance.now()-t));this.connectionState=this.connected?'live':'degraded';this.emitState()}
 async refreshCurrent(){
  const id=this.currentInst(),bar=TF_MAP[this.timeframe]||'1H',started=performance.now();
  try{
   const calls=[this.getJSON(`https://www.okx.com/api/v5/market/candles?instId=${id}&bar=${bar}&limit=240`,6500),this.getJSON(`https://www.okx.com/api/v5/market/books?instId=${id}&sz=20`,6500),this.getJSON(`https://www.okx.com/api/v5/market/trades?instId=${id}&limit=60`,6500)];
   if(this.product==='perp')calls.push(this.getJSON(`https://www.okx.com/api/v5/public/funding-rate?instId=${id}`,6500).catch(()=>null),this.getJSON(`https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${id}`,6500).catch(()=>null),this.getJSON(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${id}`,6500).catch(()=>null));
   const [cj,bj,tj,fj,mj,oj]=await Promise.all(calls);
   const rows=(cj?.data||[]).map(r=>({time:+r[0]/1000,open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5]})).reverse();if(rows.length>20)this.candles=rows;
   const b=bj?.data?.[0];if(b)this.book={asks:(b.asks||[]).slice(0,10).reverse().map(x=>[+x[0],+x[1]]),bids:(b.bids||[]).slice(0,10).map(x=>[+x[0],+x[1]])};
   if(tj?.data?.length)this.tradesTape=tj.data.slice(0,50).reverse().map(x=>({id:x.tradeId||uid(),price:+x.px,qty:+x.sz,side:x.side,ts:+x.ts}));
   if(fj?.data?.[0]){this.derivatives.fundingRate=+fj.data[0].fundingRate;this.derivatives.nextFundingAt=+fj.data[0].fundingTime}
   if(mj?.data?.[0])this.derivatives.markPrice=+mj.data[0].markPx;
   if(oj?.data?.[0])this.derivatives.openInterest=+oj.data[0].oiCcy||+oj.data[0].oi;
   const cur=this.currentMarket();this.derivatives.indexPrice=cur.last*(1-(this.derivatives.fundingRate||0)*.3);this.derivatives.longShortRatio=.85+Math.random()*.4;
   this.connected=true;this.connectionState='live';this.lastMessageAt=now();this.derivatives.latency=Math.round(performance.now()-started);
   this.emit('candles',{candles:this.candles});this.emit('book',{book:this.book});this.emit('connection',{connected:true});this.emitState();this.checkOrders();
  }catch(e){this.connected=false;this.connectionState='degraded';if(!this.candles.length)this.candles=this.seedCandles();if(!this.book.asks.length)this.seedBook();if(!this.tradesTape.length)this.seedTape();this.emit('candles',{candles:this.candles});this.emit('book',{book:this.book});this.emit('connection',{connected:false});this.emitState()}
 }
 start(){this.refreshAll();this.refreshCurrent();clearInterval(this.poll);clearInterval(this.secondaryPoll);clearInterval(this.fundingTimer);this.poll=setInterval(()=>{if(!document.hidden)this.refreshAll()},9000);this.secondaryPoll=setInterval(()=>{if(!document.hidden)this.refreshCurrent()},6500);this.fundingTimer=setInterval(()=>this.applyFundingIfDue(),60000);this.connectWS();this.recordEquity()}
 connectWS(){
  try{this.ws?.close();const ws=new WebSocket('wss://ws.okx.com:8443/ws/v5/public');this.ws=ws;const instId=this.currentInst();
   ws.onopen=()=>{this.connectionState='live';ws.send(JSON.stringify({op:'subscribe',args:[{channel:'tickers',instId},{channel:'books5',instId},{channel:'trades',instId}]}))};
   ws.onmessage=e=>{let j;try{j=JSON.parse(e.data)}catch{return}const d=j?.data;if(!d?.length)return;this.lastMessageAt=now();this.connected=true;this.connectionState='live';
    if(j.arg?.channel==='tickers'){const x=d[0],m=this.currentMarket(),last=+x.last,open=+x.open24h;this.markets.set(this.pair.base,{...m,last,change:open?(last-open)/open*100:m.change,high:+x.high24h||m.high,low:+x.low24h||m.low,volumeQuote:+x.volCcy24h||m.volumeQuote,ts:now()});const c=this.candles.at(-1);if(c){const updated={...c,close:last,high:Math.max(c.high,last),low:Math.min(c.low,last),volume:c.volume+Math.random()*3};this.candles[this.candles.length-1]=updated;this.emit('candle',{candle:updated})}this.derivatives.markPrice=this.derivatives.markPrice||last;this.emit('ticker',{market:this.currentMarket()});this.checkOrders()}
    if(j.arg?.channel==='books5'){const x=d[0];this.book={asks:(x.asks||[]).slice(0,10).reverse().map(v=>[+v[0],+v[1]]),bids:(x.bids||[]).slice(0,10).map(v=>[+v[0],+v[1]])};this.emit('book',{book:this.book})}
    if(j.arg?.channel==='trades'){for(const x of d){this.tradesTape.push({id:x.tradeId||uid(),price:+x.px,qty:+x.sz,side:x.side,ts:+x.ts});if(this.tradesTape.length>80)this.tradesTape.shift()}this.emitState()}
    this.emit('connection',{connected:true});
   };
   ws.onclose=()=>{this.connectionState='reconnecting';this.emitState();setTimeout(()=>{if(this.ws===ws)this.connectWS()},2500)};
   ws.onerror=()=>{this.connectionState='degraded';this.emitState()};
  }catch{this.connectionState='degraded';this.emitState()}
 }
 quoteDepth(side,qty,limitPrice=null){const levels=(side==='buy'?this.book.asks.slice().reverse():this.book.bids.slice()).map(([price,size])=>({price,size}));let remain=qty,filled=0,notional=0;const fills=[];for(const l of levels){if(limitPrice!=null){if(side==='buy'&&l.price>limitPrice)continue;if(side==='sell'&&l.price<limitPrice)continue}const take=Math.min(remain,l.size);if(take<=0)continue;fills.push({price:l.price,qty:take});filled+=take;notional+=take*l.price;remain-=take;if(remain<=1e-12)break}return{fills,filled,remaining:Math.max(0,remain),avg:filled?notional/filled:0,available:filled>=qty-1e-12}}
 reserveForOrder(o){let reservedCash=0;if(o.product==='spot'&&o.side==='buy')reservedCash=o.qty*o.price*(1+.001);if(o.product==='perp'&&o.positionAction==='open')reservedCash=o.qty*o.price/o.leverage+o.qty*o.price*.0006;if(reservedCash>this.account.cash)return{ok:false,message:o.product==='perp'?'保证金不足':'可用余额不足'};if(o.product==='spot'&&o.side==='sell'&&o.qty>this.availableSpot(o.base))return{ok:false,message:'可卖数量不足'};this.account.cash-=reservedCash;this.account.frozen+=reservedCash;o.reservedCash=reservedCash;return{ok:true}}
 releaseReservation(o,ratio=1){const amount=(o.reservedCash||0)*ratio;if(amount){this.account.cash+=amount;this.account.frozen=Math.max(0,this.account.frozen-amount);o.reservedCash=Math.max(0,(o.reservedCash||0)-amount)}}
 placeOrder(input){
  const m=this.currentMarket(),orderType=input.orderType||'market',price=orderType==='market'?m.last:safeNum(input.price,m.last),qty=input.amountUnit==='USDT'?safeNum(input.amount)/Math.max(price,1):safeNum(input.amount),tif=input.tif||'GTC',postOnly=!!input.postOnly,reduceOnly=!!input.reduceOnly;
  if(!qty||qty<=0||!price)return{ok:false,message:'请输入有效数量'};
  const o={id:uid(),base:this.pair.base,product:this.product,side:input.side||'buy',positionAction:input.positionAction||'open',orderType,price,qty,filledQty:0,remainingQty:qty,avgFillPrice:0,leverage:input.leverage||1,marginMode:input.marginMode||'cross',tif,postOnly,reduceOnly,status:'created',createdAt:now(),triggerPrice:safeNum(input.triggerPrice),takeProfit:safeNum(input.takeProfit),stopLoss:safeNum(input.stopLoss)};
  const bestAsk=this.book.asks.at(-1)?.[0]||m.last,bestBid=this.book.bids[0]?.[0]||m.last,cross=o.side==='buy'?o.price>=bestAsk:o.price<=bestBid;
  if(postOnly&&cross)return{ok:false,message:'Post Only 委托会立即成交，已拒绝'};
  if(reduceOnly&&o.product==='perp'){const p=this.account.positions[`${o.base}-perp`];if(!p||Math.sign(p.qty)===(o.side==='buy'?1:-1))return{ok:false,message:'Reduce Only 只能减少现有仓位'}}
  if(orderType==='trigger'&&o.triggerPrice>0){const r=this.reserveForOrder(o);if(!r.ok)return r;o.status='conditional';this.account.orders.unshift(o);this.ledger('freeze','条件委托占用',-(o.reservedCash||0),o);this.saveAccount();return{ok:true,message:'条件委托已创建',order:o}}
  const depth=this.quoteDepth(o.side,o.qty,orderType==='limit'?o.price:null);
  if(tif==='FOK'&&!depth.available)return{ok:false,message:'FOK 深度不足，委托已取消'};
  const shouldImmediate=orderType==='market'||cross||tif==='IOC'||tif==='FOK';
  if(shouldImmediate){const fillQty=tif==='FOK'?o.qty:depth.filled;if(fillQty<=0)return{ok:false,message:'当前价格无可成交深度'};const fill={...depth,filled:fillQty};const result=this.applyOrderFill(o,fill);if(!result.ok)return result;if(tif==='IOC'&&o.remainingQty>0){o.status='cancelled';o.cancelReason='IOC剩余撤销'}if(o.remainingQty<=1e-10)o.status='filled';this.saveAccount();return{ok:true,message:o.status==='filled'?'模拟成交成功':`已成交 ${o.filledQty.toFixed(6)}，剩余已撤销`,order:o}}
  const r=this.reserveForOrder(o);if(!r.ok)return r;o.status='open';this.account.orders.unshift(o);this.ledger('freeze','限价委托占用',-(o.reservedCash||0),o);this.saveAccount();return{ok:true,message:'限价委托已提交',order:o}
 }
 applyOrderFill(o,depth){
  const fillQty=Math.min(o.remainingQty,depth.filled||0),avg=depth.avg||o.price;if(fillQty<=0)return{ok:false,message:'没有可成交数量'};
  const fillOrder={base:o.base,product:o.product,side:o.side,positionAction:o.positionAction,qty:fillQty,price:avg,leverage:o.leverage,marginMode:o.marginMode,reduceOnly:o.reduceOnly};
  const reservationBefore=o.reservedCash||0;
  if(reservationBefore){const ratio=fillQty/Math.max(o.remainingQty,1e-12);this.releaseReservation(o,ratio)}
  const result=this.executeTrade(fillOrder,{fromOrder:o,reserved:reservationBefore>0});if(!result.ok){if(reservationBefore)this.reserveForOrder(o);return result}
  const prev=o.filledQty;o.filledQty+=fillQty;o.remainingQty=Math.max(0,o.qty-o.filledQty);o.avgFillPrice=(o.avgFillPrice*prev+avg*fillQty)/Math.max(o.filledQty,1e-12);o.status=o.remainingQty>1e-10?'partial':'filled';o.updatedAt=now();return{ok:true}
 }
 executeTrade(o,opts={}){
  const feeRate=opts.fromOrder?.postOnly?.0002:.0006,fee=o.qty*o.price*(o.product==='perp'?feeRate:(opts.fromOrder?.postOnly?.0004:.001)),key=o.product==='spot'?`${o.base}-spot`:`${o.base}-perp`,pos=this.account.positions[key];
  if(o.product==='spot'){
   if(o.side==='buy'){const cost=o.qty*o.price+fee;if(!opts.reserved&&cost>this.account.cash)return{ok:false,message:'可用余额不足'};if(!opts.reserved)this.account.cash-=cost;else if((opts.fromOrder?.reservedCash||0)<cost){const extra=cost-(opts.fromOrder?.reservedCash||0);if(extra>this.account.cash)return{ok:false,message:'余额不足以完成成交'};this.account.cash-=extra}if(pos){const total=pos.qty+o.qty;pos.avg=(pos.avg*pos.qty+o.price*o.qty)/total;pos.qty=total}else this.account.positions[key]={key,base:o.base,type:'spot',qty:o.qty,avg:o.price,createdAt:now()};this.ledger('trade',`买入 ${o.base}`,-cost,o)}
   else{if(!pos||this.availableSpot(o.base)<o.qty-1e-10)return{ok:false,message:'持仓数量不足'};const proceeds=o.qty*o.price-fee;this.account.cash+=proceeds;const realized=(o.price-pos.avg)*o.qty;pos.qty-=o.qty;if(pos.qty<1e-10)delete this.account.positions[key];this.ledger('trade',`卖出 ${o.base}`,proceeds,{...o,realized})}
  }else{
   const signed=o.side==='buy'?o.qty:-o.qty,margin=Math.abs(o.qty*o.price/o.leverage);
   if(o.positionAction==='open'){
    if(!opts.reserved&&margin+fee>this.account.cash)return{ok:false,message:'保证金不足'};if(!opts.reserved)this.account.cash-=margin+fee;
    if(pos&&Math.sign(pos.qty)===Math.sign(signed)){const total=Math.abs(pos.qty)+Math.abs(signed);pos.avg=(pos.avg*Math.abs(pos.qty)+o.price*Math.abs(signed))/total;pos.qty+=signed;pos.margin+=margin;pos.leverage=o.leverage;pos.marginMode=o.marginMode}
    else if(pos){const close=Math.min(Math.abs(pos.qty),Math.abs(signed));this.closePerp(pos,close,o.price,fee);const remain=Math.abs(signed)-close;if(remain>1e-10)this.account.positions[key]={key,base:o.base,type:'perp',qty:Math.sign(signed)*remain,avg:o.price,margin:remain*o.price/o.leverage,leverage:o.leverage,marginMode:o.marginMode,takeProfit:o.takeProfit,stopLoss:o.stopLoss,createdAt:now()}}
    else this.account.positions[key]={key,base:o.base,type:'perp',qty:signed,avg:o.price,margin,leverage:o.leverage,marginMode:o.marginMode,takeProfit:o.takeProfit,stopLoss:o.stopLoss,createdAt:now()};this.ledger('margin',`${o.side==='buy'?'开多':'开空'} ${o.base}`,-margin,o)
   }else{if(!pos)return{ok:false,message:'当前没有可平仓位'};if(o.reduceOnly&&Math.sign(pos.qty)===(o.side==='buy'?1:-1))return{ok:false,message:'方向不会减少仓位'};const close=Math.min(Math.abs(pos.qty),o.qty);this.closePerp(pos,close,o.price,fee)}
  }
  this.account.fees+=fee;const trade={id:uid(),...o,fee,filledAt:now(),maker:!!opts.fromOrder?.postOnly};this.account.trades.unshift(trade);this.recordEquity();this.saveAccount();return{ok:true,message:'模拟成交成功',trade}
 }
 closePerp(pos,qty,price,fee=0){const pnl=(price-pos.avg)*qty*Math.sign(pos.qty),release=pos.margin*(qty/Math.abs(pos.qty));this.account.cash+=release+pnl-fee;pos.qty-=qty*Math.sign(pos.qty);pos.margin-=release;this.ledger('close',`平仓 ${pos.base}`,release+pnl-fee,{base:pos.base,qty,price,pnl});if(Math.abs(pos.qty)<1e-10)delete this.account.positions[pos.key]}
 cancelOrder(id){const o=this.account.orders.find(x=>x.id===id);if(!o)return;this.releaseReservation(o,1);o.status='cancelled';o.cancelledAt=now();this.account.orders=this.account.orders.filter(x=>x.id!==id);this.ledger('release','撤单释放占用',o.reservedCash||0,o);this.saveAccount()}
 checkOrders(){const last=this.currentMarket().last;for(const o of [...this.account.orders]){if(o.status==='conditional'){const hit=o.side==='buy'?last>=o.triggerPrice:last<=o.triggerPrice;if(hit){o.status='open';o.orderType='market';const depth=this.quoteDepth(o.side,o.remainingQty);this.applyOrderFill(o,depth)}}else if(['open','partial'].includes(o.status)){const hit=o.side==='buy'?last<=o.price:last>=o.price;if(hit){const max=Math.max(o.remainingQty*.25,Math.min(o.remainingQty,(this.quoteDepth(o.side,o.remainingQty,o.price).filled||0)*(0.35+Math.random()*.55)));const depth=this.quoteDepth(o.side,max,o.price);this.applyOrderFill(o,depth)}}if(o.status==='filled'){this.releaseReservation(o,1);this.account.orders=this.account.orders.filter(x=>x.id!==o.id)}}this.checkStops();this.recordEquity();this.saveAccount()}
 checkStops(){for(const p of Object.values(this.account.positions)){if(p.type!=='perp')continue;const px=this.currentMarket(p.base).last;if(p.takeProfit&&((p.qty>0&&px>=p.takeProfit)||(p.qty<0&&px<=p.takeProfit)))this.closePerp(p,Math.abs(p.qty),px,0);else if(p.stopLoss&&((p.qty>0&&px<=p.stopLoss)||(p.qty<0&&px>=p.stopLoss)))this.closePerp(p,Math.abs(p.qty),px,0)}}
 liquidationPrice(p){if(!p||p.type!=='perp')return null;const maintenance=.005,dir=Math.sign(p.qty);return p.avg*(1-dir*(1/p.leverage-maintenance))}
 marginRatio(p){if(!p||p.type!=='perp')return 0;const px=this.currentMarket(p.base).last,pnl=(px-p.avg)*p.qty,equity=p.margin+pnl,maintenance=Math.abs(p.qty*px)*.005;return maintenance/Math.max(equity,1e-9)*100}
 ledger(type,label,amount,meta={}){this.account.ledger.unshift({id:uid(),type,label,amount,ts:now(),meta});if(this.account.ledger.length>300)this.account.ledger.length=300}
 recordEquity(){const e=this.equity();const last=this.account.equityHistory.at(-1);if(!last||now()-last.ts>30000){this.account.equityHistory.push({ts:now(),equity:e.equity});if(this.account.equityHistory.length>300)this.account.equityHistory.shift()}}
 applyFundingIfDue(){if(this.product!=='perp'||now()<this.derivatives.nextFundingAt)return;let total=0;for(const p of Object.values(this.account.positions)){if(p.type!=='perp')continue;const px=this.currentMarket(p.base).last,fee=p.qty*px*this.derivatives.fundingRate;this.account.cash-=fee;total+=fee}if(total){this.account.funding+=total;this.ledger('funding','资金费结算',-total,{rate:this.derivatives.fundingRate})}this.derivatives.nextFundingAt=this.nextFundingTime()+8*3600000;this.saveAccount();this.emitState()}
 equity(){let unrealized=0,value=0;for(const p of Object.values(this.account.positions)){const px=this.currentMarket(p.base).last||p.avg,pnl=(px-p.avg)*p.qty;unrealized+=pnl;value+=p.type==='spot'?px*p.qty:p.margin+pnl}return{equity:this.account.cash+this.account.frozen+value,unrealized,value,frozen:this.account.frozen}}
 exportReport(){return{version:'ATLAS-X-RC1',generatedAt:new Date().toISOString(),account:this.account,equity:this.equity(),derivatives:this.derivatives,market:{pair:this.pair,product:this.product}}}
}
window.AtlasEngine=AtlasReleaseEngine;
})();

;
(()=>{
'use strict';
const Base=window.AtlasUI;
if(!Base)return;
const {$,$$,clamp,fmt,compact,money,pct}=window.__ATLAS_UI_HELPERS;
const escape=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
class AtlasReleaseUI extends Base{
 constructor(engine,chart){
  super(engine,chart);
  this.tif='GTC';this.postOnly=false;this.reduceOnly=false;this.subIndicator='none';this.bookView='depth';this.marketSort='volume';this.convertFrom='USDT';this.convertTo='BTC';this.bookAggregation='0.1';this.pendingOrder=null;this.lastPrice=null;this.releaseReady=false;
  this.setupRelease();this.bindRelease();this.releaseReady=true;this.renderAll();this.renderRelease();
 }
 bindEngine(){
  super.bindEngine();
  this.engine.addEventListener('release',()=>this.renderRelease());
  this.engine.addEventListener('ticker',()=>{this.animatePrice();this.updateChartLevels()});
  this.engine.addEventListener('timeframe',e=>this.chart.setTimeframe?.(e.detail.timeframe));
  this.engine.addEventListener('pair',()=>this.updateChartLevels());
  this.engine.addEventListener('product',()=>this.updateChartLevels());
 }
 setupRelease(){
  document.body.classList.add('release-candidate');
  document.title='ATLAS X｜专业数字资产模拟交易终端';
  const intro=$('#presentationIntro');if(intro)intro.dataset.appReady='true'
  const header=$('.product-header');
  if(header&&!$('#marketTickerStrip'))header.insertAdjacentHTML('afterend',`<div id="marketTickerStrip" class="market-ticker-strip" aria-label="实时市场行情"></div>`);
  const ih=$('.instrument-header');
  if(ih&&!$('#marketSummaryStrip'))ih.insertAdjacentHTML('afterend',`<section id="marketSummaryStrip" class="market-summary-strip">
   <div class="summary-price"><span>最新价</span><strong id="summaryLast">--</strong><em id="summaryChange">--</em></div>
   <div><span>24h最高</span><b id="summaryHigh">--</b></div><div><span>24h最低</span><b id="summaryLow">--</b></div><div><span>24h成交额</span><b id="summaryVolume">--</b></div>
   <div class="derivative-stat" id="fundingStat"><span>资金费率 / 倒计时</span><b><i id="summaryFunding">--</i> <small id="fundingCountdown">--</small></b></div>
   <div class="derivative-stat" id="markStat"><span>标记价格</span><b id="summaryMark">--</b></div>
  </section>`);
  const tf=$('#timeframeTabs');if(tf&&!tf.querySelector('[data-timeframe="1m"]'))tf.innerHTML=`<button data-timeframe="1m">1分</button><button data-timeframe="5m">5分</button><button data-timeframe="15m">15分</button><button class="active" data-timeframe="1H">1时</button><button data-timeframe="4H">4时</button><button data-timeframe="1D">1日</button><button data-timeframe="1W">1周</button>`;
  const book=$('.book-column');
  if(book&&!$('#bookViewTabs')){
   book.insertAdjacentHTML('afterbegin',`<div class="book-topline"><div id="bookViewTabs" class="book-view-tabs"><button class="active" data-book-view="depth">盘口</button><button data-book-view="trades">成交</button></div><button id="aggregationButton" class="aggregation-button" type="button">${this.bookAggregation}<svg><use href="#i-chevron-down"/></svg></button></div>`);
   $('#bookRatio')?.remove?.();
   book.insertAdjacentHTML('beforeend',`<div id="tradeTape" class="trade-tape" hidden><div class="tape-head"><span>价格</span><span>数量</span><span>时间</span></div><div id="tradeTapeRows"></div></div>`);
  }
  const orderType=$('#orderTypeButton');
  if(orderType&&!$('#advancedOrderOptions'))orderType.insertAdjacentHTML('afterend',`<div id="advancedOrderOptions" class="advanced-order-options">
   <button id="tifButton" type="button"><span>有效期</span><b id="tifText">GTC</b><svg><use href="#i-chevron-down"/></svg></button>
   <label><input id="postOnlyToggle" type="checkbox"><i></i><span>只做Maker</span></label>
   <label id="reduceOnlyLabel"><input id="reduceOnlyToggle" type="checkbox"><i></i><span>只减仓</span></label>
  </div><div id="triggerFields" class="trigger-fields hidden"><label class="input-row"><span>触发价</span><input id="triggerPrice" inputmode="decimal"><b>USDT</b></label></div>`);
  const tpsl=$('.tp-sl');
  if(tpsl&&!$('#tpSlFields'))tpsl.insertAdjacentHTML('afterend',`<div id="tpSlFields" class="tp-sl-fields hidden"><label><span>止盈价</span><input id="takeProfitInput" inputmode="decimal" placeholder="可选"></label><label><span>止损价</span><input id="stopLossInput" inputmode="decimal" placeholder="可选"></label></div>`);
  const sec=$('#secondaryCapacity');if(sec&&!$('#orderPreview'))sec.insertAdjacentHTML('beforebegin',`<div id="orderPreview" class="order-preview"><span>预计成交均价 <b id="previewAvg">--</b></span><span>预估手续费 <b id="previewFee">--</b></span><span>预估滑点 <b id="previewSlip">--</b></span></div>`);
  const account=$('.account-panel');if(account&&!$('#accountOverview'))account.insertAdjacentHTML('afterbegin',`<div id="accountOverview" class="account-overview"><div><span>总权益</span><b id="overviewEquity">--</b></div><div><span>可用</span><b id="overviewCash">--</b></div><div><span>未实现盈亏</span><b id="overviewPnl">--</b></div><div><span>冻结</span><b id="overviewFrozen">--</b></div></div>`);
  const home=$('[data-bottom-page="home"]');if(home)home.innerHTML=`<header class="page-head"><span>ATLAS X TERMINAL</span><h1>市场与账户总览</h1><p>实时行情、模拟账户与最近活动集中展示。</p></header><section class="home-equity-card"><div><span>模拟总权益</span><strong id="homeEquity">--</strong><em id="homeReturn">--</em></div><div class="home-actions"><button data-home-action="spot">现货交易</button><button data-home-action="perp">永续合约</button><button data-home-action="funds">增加资金</button></div></section><section class="home-grid"><article><header><b>市场焦点</b><button data-home-more="markets">查看行情</button></header><div id="homeMarkets"></div></article><article><header><b>账户状态</b><button data-home-more="assets">查看资产</button></header><div id="homeAccount"></div></article></section><section class="home-activity"><header><b>最近活动</b><span>本地模拟账本</span></header><div id="homeActivity"></div></section>`;
  const marketPage=$('[data-bottom-page="markets"]');if(marketPage&&!$('#marketFilterTabs'))marketPage.querySelector('.search-row').insertAdjacentHTML('afterend',`<div id="marketFilterTabs" class="market-filter-tabs"><button class="active" data-market-sort="volume">成交额</button><button data-market-sort="change">涨幅</button><button data-market-sort="loss">跌幅</button><button data-market-sort="name">币种</button></div>`);
  const assets=$('[data-bottom-page="assets"]');if(assets&&!$('#ledgerList'))assets.insertAdjacentHTML('beforeend',`<section class="ledger-section"><header><div><span>ACCOUNT LEDGER</span><h2>资金流水</h2></div><button id="clearLedgerButton" type="button">清空记录</button></header><div id="ledgerList" class="ledger-list"></div></section>`);
  const analysis=$('[data-bottom-page="analysis"]');if(analysis&&!$('#equityCurveCanvas'))analysis.insertAdjacentHTML('beforeend',`<section class="equity-curve-card"><header><div><span>PERFORMANCE</span><h2>权益曲线</h2></div><b id="curvePeriod">最近记录</b></header><canvas id="equityCurveCanvas"></canvas></section>`);
  document.body.insertAdjacentHTML('beforeend',`<div id="orderConfirmSheet" class="sheet" hidden><div class="sheet-backdrop" data-release-close="orderConfirmSheet"></div><section class="sheet-panel order-confirm-panel"><header><div><span>ORDER CONFIRMATION</span><b>确认模拟委托</b></div><button class="icon-btn" data-release-close="orderConfirmSheet" aria-label="关闭"><svg><use href="#i-close"/></svg></button></header><div id="orderConfirmBody" class="order-confirm-body"></div><div class="confirm-actions"><button data-release-close="orderConfirmSheet">取消</button><button id="confirmOrderButton" class="primary">确认下单</button></div></section></div>
  <div id="tradeSuccess" class="trade-success" hidden><div><span class="success-check"><svg><use href="#i-check"/></svg></span><b id="tradeSuccessTitle">委托已提交</b><p id="tradeSuccessText">订单状态已同步到账户中心</p></div></div>`);
  const settings=$('#indicatorSheet .settings-list');if(settings&&!$('#bollSettingState'))settings.insertAdjacentHTML('beforeend',`<button id="bollSettingButton"><span>BOLL 布林带</span><b id="bollSettingState">隐藏</b></button><button id="rsiSettingButton"><span>RSI14</span><b id="rsiSettingState">隐藏</b></button><button id="macdSettingButton"><span>MACD</span><b id="macdSettingState">隐藏</b></button>`);
  const about=$('#aboutSheet .about-copy');if(about)about.innerHTML='<p>实时公开行情与本地模拟交易，仅用于产品演示，不接入真实资金。</p><ul><li>实时K线、盘口与逐笔成交</li><li>现货及永续模拟撮合</li><li>订单生命周期与账户账本</li><li>移动端和桌面端专业布局</li></ul>';
 }
 bindRelease(){
  $$('#timeframeTabs [data-timeframe]').forEach(b=>b.onclick=()=>{this.engine.setTimeframe(b.dataset.timeframe);$$('#timeframeTabs button').forEach(x=>x.classList.toggle('active',x===b));this.hideChartInfo();$('#chartLoading').classList.remove('hide')});
  $$('#bookViewTabs [data-book-view]').forEach(b=>b.onclick=()=>{this.bookView=b.dataset.bookView;$$('#bookViewTabs button').forEach(x=>x.classList.toggle('active',x===b));this.renderBookView()});
  $('#aggregationButton').onclick=()=>this.showOptions('盘口精度','行情设置',['0.1','1','10','100'].map(x=>({value:x,label:x})),this.bookAggregation,v=>{this.bookAggregation=v;$('#aggregationButton').childNodes[0].nodeValue=v;this.renderBook()});
  $('#orderTypeButton').onclick=()=>this.showOptions('订单类型','交易设置',[{value:'market',label:'市价委托'},{value:'limit',label:'限价委托'},{value:'trigger',label:'条件委托'}],this.orderType,v=>{this.orderType=v;this.renderOrderForm()});
  $('#tifButton').onclick=()=>this.showOptions('委托有效期','订单设置',[{value:'GTC',label:'GTC · 一直有效'},{value:'IOC',label:'IOC · 立即成交并撤销剩余'},{value:'FOK',label:'FOK · 全部成交否则撤销'}],this.tif,v=>{this.tif=v;$('#tifText').textContent=v;this.renderOrderForm()});
  $('#postOnlyToggle').onchange=e=>{this.postOnly=e.target.checked;this.renderOrderForm()};
  $('#reduceOnlyToggle').onchange=e=>{this.reduceOnly=e.target.checked;this.renderOrderForm()};
  $('#tpSlCheck').onchange=e=>{$('#tpSlFields').classList.toggle('hidden',!e.target.checked);this.renderOrderForm()};
  ['triggerPrice','takeProfitInput','stopLossInput'].forEach(id=>$('#'+id).oninput=()=>this.renderOrderForm());
  $$('[data-release-close]').forEach(el=>el.onclick=()=>this.closeReleaseSheet(el.dataset.releaseClose));
  $('#confirmOrderButton').onclick=()=>this.executeConfirmedOrder();
  $('#bollSettingButton').onclick=()=>{const on=!this.chart.options.boll;this.chart.setOption('boll',on);$('#bollSettingState').textContent=on?'显示':'隐藏';this.toast(`BOLL已${on?'显示':'隐藏'}`)};
  $('#rsiSettingButton').onclick=()=>{this.subIndicator=this.subIndicator==='rsi'?'none':'rsi';this.chart.setOption('subIndicator',this.subIndicator);$('#rsiSettingState').textContent=this.subIndicator==='rsi'?'显示':'隐藏';$('#macdSettingState').textContent='隐藏';this.chart.resize()};
  $('#macdSettingButton').onclick=()=>{this.subIndicator=this.subIndicator==='macd'?'none':'macd';this.chart.setOption('subIndicator',this.subIndicator);$('#macdSettingState').textContent=this.subIndicator==='macd'?'显示':'隐藏';$('#rsiSettingState').textContent='隐藏';this.chart.resize()};
  $$('[data-home-action]').forEach(b=>b.onclick=()=>{const a=b.dataset.homeAction;if(a==='funds')this.addDemoFunds();else{this.engine.setProduct(a);this.switchMode(a);this.navigateBottom('trade')}});$$('[data-home-more]').forEach(b=>b.onclick=()=>this.navigateBottom(b.dataset.homeMore));
  $$('#marketFilterTabs [data-market-sort]').forEach(b=>b.onclick=()=>{this.marketSort=b.dataset.marketSort;$$('#marketFilterTabs button').forEach(x=>x.classList.toggle('active',x===b));this.renderMarkets()});
  $('#convertFromButton').onclick=()=>this.showOptions('支付资产','闪兑设置',[{value:'USDT',label:'USDT'},{value:'ETH',label:'ETH'},{value:'BTC',label:'BTC'}],this.convertFrom,v=>{this.convertFrom=v;$('#convertFromButton').childNodes[0].nodeValue=v;this.renderConvert()});
  $('#convertToButton').onclick=()=>this.showOptions('获得资产','闪兑设置',this.engine.pairs.slice(0,5).map(p=>({value:p.base,label:p.base})),this.convertTo,v=>{this.convertTo=v;$('#convertToButton').childNodes[0].nodeValue=v;this.renderConvert()});
  $('#convertSubmit').onclick=()=>this.executeConvert();
  $('#clearLedgerButton').onclick=()=>{this.engine.account.ledger=[];this.engine.saveAccount();this.renderAssets();this.toast('资金流水已清空')};
  document.addEventListener('visibilitychange',()=>document.body.classList.toggle('page-hidden',document.hidden));
 }
 renderQuote(){
  super.renderQuote();if(!this.releaseReady&&!$('#marketSummaryStrip'))return;
  const p=this.engine.pair,m=this.engine.currentMarket(),d=this.engine.currentDerivatives?.()||{};
  const set=(id,v)=>{const e=$('#'+id);if(e)e.textContent=v};set('summaryLast',fmt(m.last,p.decimals));set('summaryChange',pct(m.change));set('summaryHigh',fmt(m.high,p.decimals));set('summaryLow',fmt(m.low,p.decimals));set('summaryVolume',compact(m.volumeQuote));set('summaryFunding',`${((d.fundingRate||0)*100).toFixed(4)}%`);set('summaryMark',fmt(d.markPrice||m.last,p.decimals));
  const ch=$('#summaryChange');if(ch)ch.className=m.change>=0?'positive':'negative';this.renderTickerStrip();this.updateFundingCountdown();
 }
 renderTickerStrip(){const box=$('#marketTickerStrip');if(!box)return;box.innerHTML=this.engine.pairs.map(p=>{const m=this.engine.currentMarket(p.base);return`<button data-release-pair="${p.base}"><b>${p.base}</b><span>${fmt(m.last,p.decimals)}</span><em class="${m.change>=0?'positive':'negative'}">${pct(m.change)}</em></button>`}).join('');$$('[data-release-pair]').forEach(b=>b.onclick=()=>{this.engine.setPair(b.dataset.releasePair);this.navigateBottom('trade')})}
 updateFundingCountdown(){const e=$('#fundingCountdown'),d=this.engine.currentDerivatives?.();if(!e||!d)return;const ms=Math.max(0,(d.nextFundingAt||Date.now())-Date.now()),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);e.textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
 renderBook(){super.renderBook();if(!this.releaseReady&&!$('#tradeTape'))return;this.renderBookView()}
 renderBookView(){const depth=this.bookView==='depth';$$('.book-heading,.book-list,.book-mid,.book-ratio').forEach(e=>e.hidden=!depth);$('#tradeTape').hidden=depth;$('#aggregationButton').hidden=!depth;if(!depth)this.renderTradeTape()}
 renderTradeTape(){const box=$('#tradeTapeRows');if(!box)return;const p=this.engine.pair,tape=(this.engine.tradesTape||[]).slice(-24).reverse();box.innerHTML=tape.map((t,i)=>`<div class="tape-row ${t.side}" style="--delay:${Math.min(i,8)*18}ms"><span>${fmt(t.price,p.decimals)}</span><span>${fmt(t.qty,p.base==='BTC'?5:3)}</span><span>${new Date(t.ts).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span></div>`).join('')}
 renderOrderForm(){
  super.renderOrderForm();if(!$('#advancedOrderOptions'))return;
  const perp=this.engine.product==='perp',m=this.engine.currentMarket(),p=this.engine.pair,amount=+($('#orderAmount').value||0),price=this.orderType==='market'||this.orderType==='trigger'?m.last:+($('#orderPrice').value||m.last),qty=this.amountUnit==='USDT'?amount/Math.max(price,1):amount;
  $('#reduceOnlyLabel').classList.toggle('hidden',!perp);$('#reduceOnlyToggle').disabled=!perp;$('#triggerFields').classList.toggle('hidden',this.orderType!=='trigger');$('#tifButton').classList.toggle('disabled',this.orderType==='trigger');$('#orderTypeText').textContent=this.orderType==='market'?'市价委托':this.orderType==='limit'?'限价委托':'条件委托';$('#priceRow').classList.toggle('hidden',this.orderType!=='limit');
  const depth=this.engine.quoteDepth?.(this.side,qty,this.orderType==='limit'?price:null)||{avg:price,filled:qty};const avg=depth.avg||price,fee=qty*avg*(perp?.0006:.001),slip=price?Math.abs(avg-price)/price*100:0;
  $('#previewAvg').textContent=qty?fmt(avg,p.decimals):'--';$('#previewFee').textContent=qty?`${fmt(fee,2)} USDT`:'--';$('#previewSlip').textContent=qty?`${slip.toFixed(3)}%`:'--';
  $('#availableBalance').textContent=`${fmt(this.engine.availableCash?.()??this.engine.account.cash,2)} USDT`;
  if(!perp&&this.side==='sell')$('#capacityValue').textContent=`${fmt(this.engine.availableSpot?.(p.base)??0,6)} ${p.base}`;
 }
 placeOrder(){
  const amount=+($('#orderAmount').value||0),market=this.engine.currentMarket(),price=this.orderType==='market'||this.orderType==='trigger'?market.last:+($('#orderPrice').value||0),p=this.engine.pair;
  if(!amount||amount<=0)return this.toast('请输入有效金额或数量');if(this.orderType!=='market'&&(!price||price<=0))return this.toast('请输入有效委托价格');
  const payload={side:this.side,orderType:this.orderType,amount,price,amountUnit:this.amountUnit,positionAction:this.positionAction,leverage:this.engine.product==='perp'?this.leverage:1,marginMode:this.marginMode,tif:this.tif,postOnly:this.postOnly,reduceOnly:this.reduceOnly,triggerPrice:+($('#triggerPrice').value||0),takeProfit:+($('#takeProfitInput').value||0),stopLoss:+($('#stopLossInput').value||0)};
  const qty=this.amountUnit==='USDT'?amount/Math.max(price,1):amount,action=this.engine.product==='perp'?`${this.positionAction==='open'?'开':'平'}${this.side==='buy'?'多':'空'}`:(this.side==='buy'?'买入':'卖出');this.pendingOrder=payload;
  $('#orderConfirmBody').innerHTML=`<div class="confirm-hero ${this.side}"><span>${action}</span><strong>${p.base}/USDT</strong><em>${this.engine.product==='perp'?`${this.leverage}x · ${this.marginMode==='cross'?'全仓':'逐仓'}`:'现货'}</em></div><dl><div><dt>订单类型</dt><dd>${this.orderType==='market'?'市价委托':this.orderType==='limit'?'限价委托':'条件委托'}</dd></div><div><dt>预计数量</dt><dd>${fmt(qty,6)} ${p.base}</dd></div><div><dt>参考价格</dt><dd>${fmt(price,p.decimals)} USDT</dd></div><div><dt>有效期</dt><dd>${this.tif}${this.postOnly?' · Post Only':''}${this.reduceOnly?' · Reduce Only':''}</dd></div></dl>`;
  this.openReleaseSheet('orderConfirmSheet')
 }
 executeConfirmedOrder(){if(!this.pendingOrder)return;const result=this.engine.placeOrder(this.pendingOrder);this.closeReleaseSheet('orderConfirmSheet',true);this.toast(result.message);if(result.ok){this.showTradeSuccess(result);$('#orderAmount').value='';$('#amountSlider').value=0;$('#amountSlider').style.setProperty('--range','0%');this.pendingOrder=null;this.renderAll()}}
 showTradeSuccess(result){const box=$('#tradeSuccess');$('#tradeSuccessTitle').textContent=result.order?.status==='open'?'委托已提交':'模拟成交成功';$('#tradeSuccessText').textContent=result.order?.status==='open'?'订单正在等待市场价格触发':'资产、持仓和交易记录已同步';box.hidden=false;requestAnimationFrame(()=>box.classList.add('show'));setTimeout(()=>{box.classList.remove('show');setTimeout(()=>box.hidden=true,200)},1450);navigator.vibrate?.(20)}
 openReleaseSheet(id){const e=$('#'+id);if(!e)return;e.hidden=false;document.body.style.overflow='hidden';requestAnimationFrame(()=>e.classList.add('open'));history.pushState({releaseSheet:id},'')}
 closeReleaseSheet(id,fromAction=false){const e=$('#'+id);if(!e||e.hidden)return;e.classList.remove('open');setTimeout(()=>{e.hidden=true;document.body.style.overflow=''},220);if(!fromAction&&history.state?.releaseSheet===id)history.back()}
 renderAccount(){
  if(!this.releaseReady)return super.renderAccount();
  const a=this.engine.account,positions=Object.values(a.positions),orders=a.orders,trades=a.trades,e=this.engine.equity();$('#positionCount').textContent=positions.length;$('#orderCount').textContent=orders.length;$$('#accountTabs button').forEach(b=>b.classList.toggle('active',b.dataset.accountTab===this.accountTab));
  $('#overviewEquity').textContent=money(e.equity);$('#overviewCash').textContent=money(a.cash);$('#overviewPnl').textContent=money(e.unrealized);$('#overviewFrozen').textContent=money(a.frozen||0);$('#overviewPnl').className=e.unrealized>=0?'positive':'negative';
  let html='';if(this.accountTab==='positions'){html=positions.length?positions.map(p=>{const pair=this.engine.pairs.find(x=>x.base===p.base),px=this.engine.currentMarket(p.base).last||p.avg,pnl=(px-p.avg)*p.qty,roe=p.type==='perp'?pnl/Math.max(p.margin,1)*100:pnl/Math.max(p.avg*Math.abs(p.qty),1)*100,liq=this.engine.liquidationPrice?.(p),ratio=this.engine.marginRatio?.(p)||0;return`<article class="position-card"><header><div><b>${p.base}/USDT</b><span>${p.type==='spot'?'现货':`${p.marginMode==='cross'?'全仓':'逐仓'} · ${p.leverage}x · ${p.qty>0?'多':'空'}`}</span></div><strong class="${pnl>=0?'positive':'negative'}">${pnl>=0?'+':''}${money(pnl)}<small>${pct(roe)}</small></strong></header><div class="position-metrics"><span>数量<b>${fmt(Math.abs(p.qty),6)}</b></span><span>开仓均价<b>${fmt(p.avg,pair.decimals)}</b></span><span>标记价格<b>${fmt(px,pair.decimals)}</b></span><span>强平价格<b>${liq?fmt(liq,pair.decimals):'--'}</b></span></div>${p.type==='perp'?`<div class="margin-risk"><i style="width:${clamp(ratio,2,100)}%"></i><span>保证金率 ${ratio.toFixed(2)}%</span></div>`:''}<footer><button data-position-tpsl="${p.key}">止盈止损</button><button data-close-position="${p.key}" class="primary">平仓</button></footer></article>`}).join(''):'<div class="empty-state premium"><span>暂无持仓</span><p>完成一笔模拟交易后，仓位与盈亏会在这里实时更新。</p></div>'}
  else if(this.accountTab==='orders'){html=orders.length?orders.map(o=>{const pair=this.engine.pairs.find(x=>x.base===o.base),progress=o.qty?o.filledQty/o.qty*100:0;return`<article class="order-card"><header><div><b>${o.base}/USDT</b><span>${o.product==='spot'?'现货':'永续'} · ${o.side==='buy'?'买入/做多':'卖出/做空'}</span></div><em>${o.status==='partial'?'部分成交':o.status==='conditional'?'等待触发':'等待成交'}</em></header><div class="order-metrics"><span>委托价<b>${fmt(o.price,pair.decimals)}</b></span><span>委托数量<b>${fmt(o.qty,6)}</b></span><span>已成交<b>${fmt(o.filledQty||0,6)}</b></span><span>有效期<b>${o.tif||'GTC'}</b></span></div><div class="order-progress"><i style="width:${progress}%"></i></div><footer><span>${new Date(o.createdAt).toLocaleTimeString('zh-CN',{hour12:false})}</span><button data-cancel-order="${o.id}">撤单</button></footer></article>`}).join(''):'<div class="empty-state premium"><span>暂无当前委托</span><p>限价单、条件单和部分成交订单会显示在这里。</p></div>'}
  else{html=trades.length?trades.slice(0,40).map(t=>{const pair=this.engine.pairs.find(x=>x.base===t.base);return`<article class="trade-record"><div><b>${t.base}/USDT</b><span>${t.product==='spot'?'现货':'永续'} · ${t.side==='buy'?'买入/做多':'卖出/做空'}${t.maker?' · Maker':' · Taker'}</span></div><div><b>${fmt(t.price,pair.decimals)}</b><span>${fmt(t.qty,6)} · 手续费 ${fmt(t.fee,2)}</span></div><time>${new Date(t.filledAt).toLocaleString('zh-CN',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></article>`}).join(''):'<div class="empty-state premium"><span>暂无成交记录</span><p>每次模拟撮合都会记录成交价格、数量和手续费。</p></div>'}
  $('#accountList').innerHTML=html;$$('[data-close-position]').forEach(b=>b.onclick=()=>{this.engine.closePosition(b.dataset.closePosition);this.toast('仓位已平')});$$('[data-cancel-order]').forEach(b=>b.onclick=()=>{this.engine.cancelOrder(b.dataset.cancelOrder);this.toast('委托已撤销')});$$('[data-position-tpsl]').forEach(b=>b.onclick=()=>this.toast('止盈止损可在下单区修改'))
 }
 renderConvert(){const input=+($('#convertPay')?.value||0),to=this.engine.pairs.find(p=>p.base===this.convertTo)||this.engine.pairs[0],toPx=this.engine.currentMarket(to.base).last||to.seed,fromPx=this.convertFrom==='USDT'?1:(this.engine.currentMarket(this.convertFrom).last||1),usdt=input*fromPx,receive=usdt/toPx;if($('#convertReceive'))$('#convertReceive').value=receive>0?receive.toFixed(6):'';if($('#convertRate'))$('#convertRate').textContent=`1 ${to.base} ≈ ${fmt(toPx,2)} USDT · 预计手续费 ${fmt(usdt*.001,2)} USDT`}
 executeConvert(){const input=+($('#convertPay').value||0);if(!input||input<=0)return this.toast('请输入兑换数量');const to=this.engine.pairs.find(p=>p.base===this.convertTo);if(!to)return;const px=this.engine.currentMarket(to.base).last||to.seed;if(this.convertFrom==='USDT'){const result=this.engine.executeTrade({base:to.base,product:'spot',side:'buy',positionAction:'open',qty:input/px,price:px,leverage:1});this.toast(result.message);if(result.ok)this.showTradeSuccess({order:{status:'filled'}})}else{const fromPos=this.engine.account.positions[`${this.convertFrom}-spot`];if(!fromPos||fromPos.qty<input)return this.toast(`${this.convertFrom} 可用数量不足`);const fromPx=this.engine.currentMarket(this.convertFrom).last;const sold=this.engine.executeTrade({base:this.convertFrom,product:'spot',side:'sell',positionAction:'close',qty:input,price:fromPx,leverage:1});if(!sold.ok)return this.toast(sold.message);const result=this.engine.executeTrade({base:to.base,product:'spot',side:'buy',positionAction:'open',qty:input*fromPx/px,price:px,leverage:1});this.toast(result.message)}this.renderAll()}
 addDemoFunds(){this.engine.account.cash+=10000;this.engine.ledger?.('deposit','增加模拟资金',10000,{});this.engine.saveAccount();this.toast('已增加 10,000 USDT 模拟资金');this.renderHome?.()}
 renderHome(){if(!$('#homeEquity'))return;const e=this.engine.equity(),ret=(e.equity-this.engine.account.initial)/this.engine.account.initial*100;$('#homeEquity').textContent=money(e.equity);$('#homeReturn').textContent=pct(ret);$('#homeReturn').className=ret>=0?'positive':'negative';const markets=this.engine.pairs.map(p=>({p,m:this.engine.currentMarket(p.base)})).sort((a,b)=>b.m.volumeQuote-a.m.volumeQuote).slice(0,5);$('#homeMarkets').innerHTML=markets.map(({p,m})=>`<button data-home-pair="${p.base}"><span><i style="background:${p.color}">${p.icon}</i><b>${p.base}/USDT<small>${compact(m.volumeQuote)}</small></b></span><span><b>${fmt(m.last,p.decimals)}</b><em class="${m.change>=0?'positive':'negative'}">${pct(m.change)}</em></span></button>`).join('');$$('[data-home-pair]').forEach(b=>b.onclick=()=>{this.engine.setPair(b.dataset.homePair);this.navigateBottom('trade')});const a=this.engine.account,positions=Object.values(a.positions);$('#homeAccount').innerHTML=`<div><span>可用余额</span><b>${money(a.cash)}</b></div><div><span>持仓数量</span><b>${positions.length}</b></div><div><span>当前委托</span><b>${a.orders.length}</b></div><div><span>累计手续费</span><b>${money(a.fees||0)}</b></div>`;const activity=(a.ledger||[]).slice(0,5);$('#homeActivity').innerHTML=activity.length?activity.map(x=>`<article><i class="${x.amount>=0?'in':'out'}"></i><span><b>${escape(x.label)}</b><small>${new Date(x.ts).toLocaleString('zh-CN',{hour12:false})}</small></span><strong class="${x.amount>=0?'positive':'negative'}">${x.amount>=0?'+':''}${money(x.amount)}</strong></article>`).join(''):'<div class="empty-state">完成交易后，最近活动会显示在这里。</div>'}
 renderMarkets(){const q=$('#marketSearch')?.value.trim().toLowerCase()||'';let rows=this.engine.pairs.filter(p=>!q||p.base.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)).map(p=>({p,m:this.engine.currentMarket(p.base)}));if(this.marketSort==='change')rows.sort((a,b)=>b.m.change-a.m.change);else if(this.marketSort==='loss')rows.sort((a,b)=>a.m.change-b.m.change);else if(this.marketSort==='name')rows.sort((a,b)=>a.p.base.localeCompare(b.p.base));else rows.sort((a,b)=>b.m.volumeQuote-a.m.volumeQuote);$('#marketList').innerHTML=rows.map(({p,m},idx)=>{const points=Array.from({length:18},(_,i)=>50+Math.sin((i+idx)*.55)*16+(m.change||0)*i/4),path=points.map((v,i)=>`${i?'L':'M'}${(i/(points.length-1)*92).toFixed(1)},${(44-v*.5).toFixed(1)}`).join(' ');return`<article class="market-item enhanced"><div class="coin"><i class="coin-icon" style="background:${p.color}">${p.icon}</i><span><b>${p.base}/USDT</b><small>${p.name}</small></span></div><svg class="mini-spark" viewBox="0 0 92 44"><path d="${path}" class="${m.change>=0?'up':'down'}"/></svg><span><b>${fmt(m.last,p.decimals)}</b><small>${compact(m.volumeQuote)}</small></span><span class="${m.change>=0?'positive':'negative'}"><b>${pct(m.change)}</b></span><button data-market-trade="${p.base}">交易</button></article>`}).join('');$$('[data-market-trade]').forEach(b=>b.onclick=()=>{this.engine.setPair(b.dataset.marketTrade);this.navigateBottom('trade')})}
 renderAssets(){super.renderAssets();if(!$('#ledgerList'))return;const a=this.engine.account,e=this.engine.equity();const summary=$('.asset-summary');if(summary){summary.querySelector('div').innerHTML=`<span>可用余额<b id="assetCash">${money(a.cash)}</b></span><span>冻结资金<b>${money(a.frozen||0)}</b></span><span>未实现盈亏<b id="assetPnl" class="${e.unrealized>=0?'positive':'negative'}">${money(e.unrealized)}</b></span><span>累计手续费<b>${money(a.fees||0)}</b></span>`}$('#ledgerList').innerHTML=(a.ledger||[]).length?a.ledger.slice(0,60).map(x=>`<article><span><b>${escape(x.label)}</b><small>${new Date(x.ts).toLocaleString('zh-CN',{hour12:false})}</small></span><strong class="${x.amount>=0?'positive':'negative'}">${x.amount>=0?'+':''}${money(x.amount)}</strong></article>`).join(''):'<div class="empty-state">暂无资金流水</div>'}
 renderAnalysis(){super.renderAnalysis();if(!$('#equityCurveCanvas'))return;const a=this.engine.account,e=this.engine.equity(),trades=a.trades||[],wins=trades.filter(t=>(t.realized||0)>0).length,losses=trades.filter(t=>(t.realized||0)<0).length,grossWin=trades.filter(t=>(t.realized||0)>0).reduce((s,t)=>s+t.realized,0),grossLoss=Math.abs(trades.filter(t=>(t.realized||0)<0).reduce((s,t)=>s+t.realized,0)),metrics=[['总权益',money(e.equity)],['可用资金',money(a.cash)],['累计手续费',money(a.fees||0)],['资金费',money(a.funding||0)],['成交次数',trades.length],['胜率',trades.length?`${(wins/trades.length*100).toFixed(1)}%`:'--'],['盈亏比',grossLoss?(grossWin/grossLoss).toFixed(2):'--'],['未实现盈亏',money(e.unrealized)]];$('#analysisMetrics').innerHTML=metrics.map(x=>`<article class="metric-card"><span>${x[0]}</span><b>${x[1]}</b></article>`).join('');this.drawEquityCurve()}
 drawEquityCurve(){const c=$('#equityCurveCanvas');if(!c)return;const data=this.engine.account.equityHistory||[],r=c.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);if(!r.width||!r.height)return;c.width=r.width*d;c.height=r.height*d;const ctx=c.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,r.width,r.height);const arr=data.length>1?data:[{equity:this.engine.account.initial},{equity:this.engine.equity().equity}],min=Math.min(...arr.map(x=>x.equity)),max=Math.max(...arr.map(x=>x.equity)),spread=max-min||1,pad=14;ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;for(let i=0;i<4;i++){const y=pad+(r.height-pad*2)*i/3;ctx.beginPath();ctx.moveTo(0,y+.5);ctx.lineTo(r.width,y+.5);ctx.stroke()}const grad=ctx.createLinearGradient(0,0,0,r.height);grad.addColorStop(0,'rgba(123,201,0,.22)');grad.addColorStop(1,'rgba(123,201,0,0)');ctx.beginPath();arr.forEach((x,i)=>{const px=pad+(r.width-pad*2)*i/Math.max(arr.length-1,1),py=pad+(max-x.equity)/spread*(r.height-pad*2);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.strokeStyle='#78bd00';ctx.lineWidth=2;ctx.stroke();ctx.lineTo(r.width-pad,r.height-pad);ctx.lineTo(pad,r.height-pad);ctx.closePath();ctx.fillStyle=grad;ctx.fill()}
 updateChartLevels(){if(!this.chart.setLevels)return;const levels=[];for(const p of Object.values(this.engine.account.positions||{})){if(p.base!==this.engine.pair.base)continue;levels.push({price:p.avg,label:`${p.type==='perp'?'开仓均价':'持仓成本'} ${fmt(p.avg,this.engine.pair.decimals)}`,color:p.qty>=0?'#4f68ff':'#9b5de5',dash:[6,4]});if(p.takeProfit)levels.push({price:p.takeProfit,label:`止盈 ${fmt(p.takeProfit,this.engine.pair.decimals)}`,color:'#78bd00'});if(p.stopLoss)levels.push({price:p.stopLoss,label:`止损 ${fmt(p.stopLoss,this.engine.pair.decimals)}`,color:'#f33d66'})}for(const o of this.engine.account.orders||[]){if(o.base===this.engine.pair.base&&o.price)levels.push({price:o.price,label:`委托 ${fmt(o.price,this.engine.pair.decimals)}`,color:'#ff8a00',dash:[3,3]})}this.chart.setLevels(levels)}
 renderRelease(){if(!this.releaseReady)return;this.chart.setTimeframe?.(this.engine.timeframe);this.updateChartLevels();this.renderQuote();this.renderHome();this.renderMarkets();this.renderTradeTape();this.renderOrderForm();this.renderAccount();this.renderAssets();this.renderAnalysis();this.updateConnectionBadge()}
 updateConnectionBadge(){const s=this.engine.connectionState||'degraded',d=this.engine.currentDerivatives?.()||{},box=$('#connectionStatus');if(!box)return;box.dataset.state=s;box.innerHTML=`<i></i><span>${s==='live'?'实时':s==='reconnecting'?'重连中':'缓存行情'}</span><em>${d.latency||0}ms</em>`}
 animatePrice(){const m=this.engine.currentMarket(),el=$('#summaryLast');if(!el)return;if(this.lastPrice!=null&&m.last!==this.lastPrice){el.classList.remove('tick-up','tick-down');void el.offsetWidth;el.classList.add(m.last>this.lastPrice?'tick-up':'tick-down')}this.lastPrice=m.last}
}
window.AtlasUI=AtlasReleaseUI;
})();

;
(()=>{
'use strict';
function start(){
 const engine=new AtlasEngine();
 const chart=new AtlasProChart(document.getElementById('chartCanvas'),document.getElementById('chartOverlay'));
 const ui=new AtlasUI(engine,chart);
 window.__ATLAS_V14={engine,chart,ui,version:'V14'};
 chart.setData(engine.candles);
 document.getElementById('chartLoading').classList.add('hide');
 engine.start();
 const audit=()=>{
  const root=document.documentElement,host=document.getElementById('chartHost'),checks={viewport:`${innerWidth}x${innerHeight}`,horizontalOverflow:Math.max(0,root.scrollWidth-innerWidth),chartHeight:Math.round(host?.getBoundingClientRect().height||0),candles:chart.data.length,buttons:[...document.querySelectorAll('button')].length,unlabeledButtons:[...document.querySelectorAll('button')].filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')).length,openSheets:[...document.querySelectorAll('.sheet.open')].length,ts:Date.now()};checks.ok=checks.horizontalOverflow<3&&checks.chartHeight>240&&checks.candles>20&&checks.unlabeledButtons===0;document.body.dataset.audit=checks.ok?'pass':'review';try{localStorage.setItem('atlas-v14-last-audit',JSON.stringify(checks))}catch{}return checks};
 window.__ATLAS_V14.audit=audit;[600,1800,4200].forEach(t=>setTimeout(audit,t));window.addEventListener('resize',()=>setTimeout(audit,150),{passive:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

;
(()=>{
'use strict';
const $=(s,p=document)=>p.querySelector(s),$$=(s,p=document)=>[...p.querySelectorAll(s)];
const wait=()=>new Promise(resolve=>{const t=setInterval(()=>{if(window.__ATLAS_V14){clearInterval(t);resolve(window.__ATLAS_V14)}},12);setTimeout(()=>{clearInterval(t);resolve(window.__ATLAS_V14)},5000)});
wait().then(ctx=>{
 if(!ctx)return;window.__ATLAS_RELEASE={...ctx,version:'RC1',errors:[],audits:[]};
 const {engine,chart,ui}=ctx;
 const injectDetailSheet=()=>{if($('#featureDetailSheet'))return;document.body.insertAdjacentHTML('beforeend',`<div id="featureDetailSheet" class="sheet" hidden><div class="sheet-backdrop" data-feature-close></div><section class="sheet-panel feature-detail-panel"><header><div><span id="featureEyebrow">MODULE</span><b id="featureTitle">功能详情</b></div><button class="icon-btn" data-feature-close aria-label="关闭"><svg><use href="#i-close"/></svg></button></header><div id="featureDetailBody"></div></section></div>`);$$('[data-feature-close]').forEach(x=>x.onclick=()=>closeFeature())};
 const openFeature=(title,type)=>{injectDetailSheet();const sheet=$('#featureDetailSheet'),body=$('#featureDetailBody');$('#featureTitle').textContent=title;$('#featureEyebrow').textContent=type==='strategy'?'STRATEGY SIMULATION':'ONCHAIN MONITOR';body.innerHTML=type==='strategy'?`<section class="feature-config"><div class="feature-kpi"><span>模拟状态</span><b>待启动</b></div><div class="feature-kpi"><span>投入资金</span><b>5,000 USDT</b></div><label><span>价格区间</span><div><input value="58,000"><em>—</em><input value="72,000"></div></label><label><span>网格数量</span><input type="range" min="5" max="50" value="20"><b>20</b></label><div class="feature-metrics"><span>预估年化<b>18.4%</b></span><span>最大回撤<b>6.2%</b></span><span>运行频率<b>中等</b></span></div><button id="featurePrimary" class="primary-action">启动模拟策略</button><p>策略仅在本地模拟，不会发送真实订单。</p></section>`:`<section class="chain-detail"><div class="chain-status"><i></i><span>网络运行正常</span><b>12.4 TPS</b></div><div class="feature-metrics"><span>平均确认<b>11.8s</b></span><span>网络费用<b>$0.42</b></span><span>拥堵等级<b>低</b></span></div><div class="chain-blocks">${Array.from({length:6},(_,i)=>`<article><span>区块 #${(21300490-i).toLocaleString()}</span><b>${12+i*2} 笔交易</b><time>${i*12+4}s 前</time></article>`).join('')}</div><button id="featurePrimary" class="primary-action">刷新网络状态</button></section>`;sheet.hidden=false;requestAnimationFrame(()=>sheet.classList.add('open'));document.body.style.overflow='hidden';history.pushState({releaseFeature:true},'');$('#featurePrimary').onclick=()=>{ui.toast(type==='strategy'?'模拟策略已启动':'网络状态已刷新');if(type==='strategy')$('#featurePrimary').textContent='模拟运行中'} };
 const closeFeature=(pop=false)=>{const s=$('#featureDetailSheet');if(!s||s.hidden)return;s.classList.remove('open');setTimeout(()=>{s.hidden=true;document.body.style.overflow='';if(!pop&&history.state?.releaseFeature)history.back()},220)};
 setTimeout(()=>{$$('[data-feature-action]').forEach(b=>{const strategy=b.dataset.featureAction.includes('策略')||b.closest('#strategyGrid');b.onclick=()=>openFeature(b.dataset.featureAction,strategy?'strategy':'chain')})},60);
 window.addEventListener('popstate',e=>{if($('#featureDetailSheet')&&!$('#featureDetailSheet').hidden&&!e.state?.releaseFeature)closeFeature(true)});
 setInterval(()=>ui.updateFundingCountdown?.(),1000);
 const audit=()=>{
  const root=document.documentElement,host=$('#chartHost'),visibleButtons=$$('button').filter(b=>b.offsetParent!==null),checks={time:new Date().toISOString(),viewport:`${innerWidth}x${innerHeight}`,overflowX:Math.max(0,root.scrollWidth-innerWidth),chartHeight:Math.round(host?.getBoundingClientRect().height||0),candles:chart.data?.length||0,unlabelled:visibleButtons.filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')).length,openSheets:$$('.sheet.open').length,emptyLinks:$$('a[href="#"]').length,connection:engine.connectionState,errors:window.__ATLAS_RELEASE.errors.length};const chartVisible=!!host?.offsetParent;checks.pass=checks.overflowX<3&&(!chartVisible||checks.chartHeight>250)&&checks.candles>20&&checks.unlabelled===0&&checks.errors===0;window.__ATLAS_RELEASE.audits.push(checks);if(window.__ATLAS_RELEASE.audits.length>30)window.__ATLAS_RELEASE.audits.shift();document.body.dataset.releaseAudit=checks.pass?'pass':'review';try{localStorage.setItem('atlas-release-last-audit',JSON.stringify(checks))}catch{}return checks};
 window.__ATLAS_RELEASE.audit=audit;[450,1200,3200,7000].forEach(t=>setTimeout(audit,t));window.addEventListener('resize',()=>setTimeout(audit,120),{passive:true});
 window.addEventListener('error',e=>window.__ATLAS_RELEASE.errors.push({message:e.message,source:e.filename,line:e.lineno,ts:Date.now()}));window.addEventListener('unhandledrejection',e=>window.__ATLAS_RELEASE.errors.push({message:String(e.reason),ts:Date.now()}));
 const motion=()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)document.body.classList.add('reduce-motion');else document.body.classList.remove('reduce-motion')};motion();
 document.addEventListener('pointerdown',e=>{const b=e.target.closest('button');if(b){b.classList.add('pressed');setTimeout(()=>b.classList.remove('pressed'),150)}},{passive:true});
});
})();
