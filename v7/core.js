'use strict';
const $=(s,p=document)=>p.querySelector(s),$$=(s,p=document)=>[...p.querySelectorAll(s)];
const fmt=(n,d=2)=>Number.isFinite(+n)?Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'--';
const money=(n,d=2)=>Number.isFinite(+n)?'$'+fmt(n,d):'--';
const pct=n=>Number.isFinite(+n)?`${+n>=0?'+':''}${(+n).toFixed(2)}%`:'--';
const compact=n=>Number.isFinite(+n)?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(+n):'--';
const time=ts=>new Date(+ts||Date.now()).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const uid=()=>`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const css=n=>getComputedStyle(document.body).getPropertyValue(n).trim();
const PAIRS=[
 {base:'BTC',name:'Bitcoin',icon:'₿',cls:'btc',decimals:2,spotId:'BTC-USDT',perpId:'BTC-USDT-SWAP',binance:'BTCUSDT'},
 {base:'ETH',name:'Ethereum',icon:'◆',cls:'eth',decimals:2,spotId:'ETH-USDT',perpId:'ETH-USDT-SWAP',binance:'ETHUSDT'},
 {base:'SOL',name:'Solana',icon:'S',cls:'sol',decimals:3,spotId:'SOL-USDT',perpId:'SOL-USDT-SWAP',binance:'SOLUSDT'},
 {base:'BNB',name:'BNB',icon:'B',cls:'bnb',decimals:2,spotId:'BNB-USDT',perpId:'BNB-USDT-SWAP',binance:'BNBUSDT'},
 {base:'XRP',name:'XRP',icon:'X',cls:'xrp',decimals:4,spotId:'XRP-USDT',perpId:'XRP-USDT-SWAP',binance:'XRPUSDT'},
 {base:'DOGE',name:'Dogecoin',icon:'Ð',cls:'doge',decimals:5,spotId:'DOGE-USDT',perpId:'DOGE-USDT-SWAP',binance:'DOGEUSDT'},
 {base:'ADA',name:'Cardano',icon:'A',cls:'ada',decimals:4,spotId:'ADA-USDT',perpId:'ADA-USDT-SWAP',binance:'ADAUSDT'}
];
const byBase=Object.fromEntries(PAIRS.map(p=>[p.base,p]));
const byId={};PAIRS.forEach(p=>{byId[p.spotId]={...p,product:'spot',instId:p.spotId};byId[p.perpId]={...p,product:'perp',instId:p.perpId}});
const BARS={'1m':'1m','5m':'5m','15m':'15m','1H':'1H','4H':'4H','1D':'1D'};
const WS_BAR={'1m':'candle1m','5m':'candle5m','15m':'candle15m','1H':'candle1H','4H':'candle4H','1D':'candle1D'};
const BINANCE_BAR={'1m':'1m','5m':'5m','15m':'15m','1H':'1h','4H':'4h','1D':'1d'};
const COLORS=['#6d8cff','#62e0c1','#f1ba55','#9878ff','#ff7b8a','#4eb6ff','#7e8999'];

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove('show'),2300)}
function coin(p){return`<span class="coin ${p.cls}">${p.icon}</span>`}
function sign(el,n){if(!el)return;el.classList.toggle('positive',+n>=0);el.classList.toggle('negative',+n<0)}
async function json(url,timeout=8000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{cache:'no-store',signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}finally{clearTimeout(t)}}
function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)})}
async function ensureCharts(){if(window.LightweightCharts)return;const urls=['https://unpkg.com/lightweight-charts@4.2.2/dist/lightweight-charts.standalone.production.js','https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.2/dist/lightweight-charts.standalone.production.js'];let err;for(const u of urls){try{await loadScript(u);if(window.LightweightCharts)return}catch(e){err=e}}throw err||new Error('chart library unavailable')}

class ChartController{
 constructor(){this.chart=null;this.candles=null;this.volume=null;this.ma7=null;this.ma25=null;this.data=[];this.lines=[];this.showMA=true;this.showVolume=true;this.ro=null}
 init(){this.destroy();const host=$('#chartHost'),bg=css('--panel'),text=css('--muted'),grid=css('--line');this.chart=LightweightCharts.createChart(host,{width:host.clientWidth,height:host.clientHeight,layout:{background:{type:'solid',color:bg},textColor:text,fontFamily:'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',fontSize:11},grid:{vertLines:{color:grid},horzLines:{color:grid}},crosshair:{mode:LightweightCharts.CrosshairMode.Normal,vertLine:{color:'#7386aa',width:1,style:3,labelBackgroundColor:'#394761'},horzLine:{color:'#7386aa',width:1,style:3,labelBackgroundColor:'#394761'}},rightPriceScale:{borderColor:grid,scaleMargins:{top:.07,bottom:.22}},timeScale:{borderColor:grid,timeVisible:true,secondsVisible:false,rightOffset:4,barSpacing:8,minBarSpacing:2,fixLeftEdge:true},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},kineticScroll:{mouse:true,touch:true},localization:{locale:'zh-CN'}});
  this.candles=this.chart.addCandlestickSeries({upColor:'#2dcc9a',downColor:'#ff6378',borderVisible:false,wickUpColor:'#2dcc9a',wickDownColor:'#ff6378',priceLineVisible:true,lastValueVisible:true});
  this.volume=this.chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});this.chart.priceScale('volume').applyOptions({scaleMargins:{top:.78,bottom:0}});
  this.ma7=this.chart.addLineSeries({color:'#f1ba55',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});this.ma25=this.chart.addLineSeries({color:'#9878ff',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
  this.chart.subscribeCrosshairMove(p=>{if(!p?.time)return;const d=p.seriesData.get(this.candles);if(d)this.legend({...d,volume:p.seriesData.get(this.volume)?.value||0})});this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(host);$('#chartStatus').textContent='可拖动、缩放、双指缩放与十字光标';return this}
 ma(n){const out=[];let sum=0;for(let i=0;i<this.data.length;i++){sum+=this.data[i].close;if(i>=n)sum-=this.data[i-n].close;if(i>=n-1)out.push({time:this.data[i].time,value:sum/n})}return out}
 setData(data,fit=true){this.data=data||[];if(!this.chart)this.init();this.candles.setData(this.data.map(x=>({time:x.time,open:x.open,high:x.high,low:x.low,close:x.close})));this.volume.setData(this.data.map(x=>({time:x.time,value:x.volume,color:x.close>=x.open?'#2dcc9a44':'#ff637844'})));this.ma7.setData(this.ma(7));this.ma25.setData(this.ma(25));this.applyVisibility();if(fit)this.chart.timeScale().fitContent();const last=this.data.at(-1);if(last)this.legend(last)}
 update(c){if(!this.chart)return;const last=this.data.at(-1);if(last&&last.time===c.time)this.data[this.data.length-1]=c;else if(!last||c.time>last.time)this.data.push(c);this.candles.update({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close});this.volume.update({time:c.time,value:c.volume,color:c.close>=c.open?'#2dcc9a44':'#ff637844'});const m7=this.ma(7).at(-1),m25=this.ma(25).at(-1);if(m7)this.ma7.update(m7);if(m25)this.ma25.update(m25);this.legend(c)}
 legend(d){const f=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:8});$('#chartLegend').innerHTML=`<span>O <b>${f(d.open)}</b></span><span>H <b>${f(d.high)}</b></span><span>L <b>${f(d.low)}</b></span><span>C <b class="${d.close>=d.open?'positive':'negative'}">${f(d.close)}</b></span><span>Vol <b>${fmt(d.volume||0,2)}</b></span>`}
 applyVisibility(){this.ma7?.applyOptions({visible:this.showMA});this.ma25?.applyOptions({visible:this.showMA});this.volume?.applyOptions({visible:this.showVolume})}
 toggleMA(){this.showMA=!this.showMA;this.applyVisibility();return this.showMA}toggleVolume(){this.showVolume=!this.showVolume;this.applyVisibility();return this.showVolume}
 fit(){this.chart?.timeScale().fitContent()}realtime(){this.chart?.timeScale().scrollToRealTime()}resize(){const h=$('#chartHost');if(this.chart&&h.clientWidth&&h.clientHeight)this.chart.applyOptions({width:h.clientWidth,height:h.clientHeight})}
 restyle(){if(!this.chart)return;const bg=css('--panel'),text=css('--muted'),grid=css('--line');this.chart.applyOptions({layout:{background:{type:'solid',color:bg},textColor:text},grid:{vertLines:{color:grid},horzLines:{color:grid}},rightPriceScale:{borderColor:grid},timeScale:{borderColor:grid}})}
 setLines(items=[]){if(!this.candles)return;for(const l of this.lines){try{this.candles.removePriceLine(l)}catch{}}this.lines=[];for(const it of items){if(!it.price)continue;this.lines.push(this.candles.createPriceLine({price:it.price,color:it.color||'#6d8cff',lineWidth:1,lineStyle:it.dashed?2:0,axisLabelVisible:true,title:it.title||''}))}}
 destroy(){this.ro?.disconnect();if(this.chart){try{this.chart.remove()}catch{}}this.chart=this.candles=this.volume=this.ma7=this.ma25=null;this.lines=[]}
}
