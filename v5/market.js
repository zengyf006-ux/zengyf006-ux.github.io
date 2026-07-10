export const PAIRS=[
  {instId:'BTC-USDT',swapId:'BTC-USDT-SWAP',base:'BTC',name:'Bitcoin',icon:'₿',cls:'btc',decimals:2},
  {instId:'ETH-USDT',swapId:'ETH-USDT-SWAP',base:'ETH',name:'Ethereum',icon:'◆',cls:'eth',decimals:2},
  {instId:'SOL-USDT',swapId:'SOL-USDT-SWAP',base:'SOL',name:'Solana',icon:'S',cls:'sol',decimals:3},
  {instId:'BNB-USDT',swapId:null,base:'BNB',name:'BNB',icon:'B',cls:'bnb',decimals:2},
  {instId:'XRP-USDT',swapId:'XRP-USDT-SWAP',base:'XRP',name:'XRP',icon:'X',cls:'xrp',decimals:4},
  {instId:'DOGE-USDT',swapId:'DOGE-USDT-SWAP',base:'DOGE',name:'Dogecoin',icon:'Ð',cls:'doge',decimals:5},
  {instId:'ADA-USDT',swapId:'ADA-USDT-SWAP',base:'ADA',name:'Cardano',icon:'A',cls:'ada',decimals:4}
];
export const PAIR_MAP=Object.fromEntries(PAIRS.map(p=>[p.instId,p]));
export const BARS={'1m':'1m','5m':'5m','15m':'15m','1H':'1H','4H':'4H','1D':'1D'};
const WS_BAR={'1m':'candle1m','5m':'candle5m','15m':'candle15m','1H':'candle1H','4H':'candle4H','1D':'candle1D'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function json(url,timeout=8000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout),start=performance.now();
  try{
    const r=await fetch(url,{cache:'no-store',signal:c.signal,headers:{'accept':'application/json'}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    return{data,latency:Math.round(performance.now()-start)};
  }finally{clearTimeout(t)}
}
function ticker(x){
  const last=+x.last||0,open=+x.open24h||+x.sodUtc0||last;
  return{instId:x.instId,last,open,high:+x.high24h||0,low:+x.low24h||0,volume:+x.vol24h||0,volumeQuote:+x.volCcy24h||0,change:open?(last-open)/open*100:0,bid:+x.bidPx||0,ask:+x.askPx||0,ts:+x.ts||Date.now()}
}
function candle(x){return{time:Math.floor(+x[0]/1000),open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5]}}
function bookRows(rows=[]){return rows.map(x=>[+x[0],+x[1],+x[2]||0]).filter(x=>x[0]&&x[1])}

export class MarketEngine{
  constructor(hooks={}){
    this.hooks=hooks;this.markets=new Map();this.current='BTC-USDT';this.bar='1H';
    this.ws=null;this.wsUrlIndex=0;this.reconnect=null;this.poll=null;this.fastPoll=null;this.contractPoll=null;this.ping=null;
    this.lastMessage=0;this.connected=false;this.book={asks:[],bids:[]};this.trades=[];this.candles=[];this.source='OKX';this.latency=0;
    this.contract={mark:0,index:0,fundingRate:null,nextFundingTime:0,openInterest:0,ts:0}
  }
  emit(name,...args){try{this.hooks[name]?.(...args)}catch(e){console.error(name,e)}}
  get(id=this.current){return this.markets.get(id)||{instId:id,last:0,change:0,high:0,low:0,volumeQuote:0,bid:0,ask:0,ts:0}}
  async init(){
    await this.fetchMarkets();
    await Promise.all([this.loadCandles(),this.loadBook(),this.loadTrades(),this.loadContractStats()]);
    this.connect();this.startPolling();return this
  }
  async fetchMarkets(){
    const {data:d,latency}=await json('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
    if(d.code!=='0'||!Array.isArray(d.data))throw new Error('bad ticker');
    const allowed=new Set(PAIRS.map(p=>p.instId));
    d.data.filter(x=>allowed.has(x.instId)).forEach(x=>this.markets.set(x.instId,ticker(x)));
    this.source='OKX';this.latency=latency;this.emit('onMarkets',this.markets);this.status(true,'OKX 实时行情');return true
  }
  async loadCandles(){
    const {data:d}=await json(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(this.current)}&bar=${encodeURIComponent(this.bar)}&limit=300`);
    if(d.code!=='0'||!Array.isArray(d.data))throw new Error('bad candles');
    this.candles=d.data.map(candle).reverse();this.emit('onCandles',this.candles);return this.candles
  }
  async loadBook(){
    try{
      const {data:d}=await json(`https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(this.current)}&sz=50`);
      const b=d.data?.[0];if(!b)throw new Error('bad book');
      this.book={asks:bookRows(b.asks),bids:bookRows(b.bids)};this.emit('onBook',this.book)
    }catch(e){console.warn(e)}
    return this.book
  }
  async loadTrades(){
    try{
      const {data:d}=await json(`https://www.okx.com/api/v5/market/trades?instId=${encodeURIComponent(this.current)}&limit=80`);
      this.trades=(d.data||[]).map(x=>({price:+x.px,qty:+x.sz,side:x.side,ts:+x.ts}));
      this.emit('onTrades',this.trades)
    }catch(e){console.warn(e)}
    return this.trades
  }
  async loadContractStats(){
    const p=PAIR_MAP[this.current];
    if(!p?.swapId){
      this.contract={mark:this.get().last,index:this.get().last,fundingRate:null,nextFundingTime:0,openInterest:0,ts:Date.now()};
      this.emit('onContract',this.contract);return this.contract
    }
    const endpoints=[
      json(`https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${encodeURIComponent(p.swapId)}`).catch(()=>null),
      json(`https://www.okx.com/api/v5/market/index-tickers?instId=${encodeURIComponent(p.instId)}`).catch(()=>null),
      json(`https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(p.swapId)}`).catch(()=>null),
      json(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${encodeURIComponent(p.swapId)}`).catch(()=>null)
    ];
    const [mark,index,funding,oi]=await Promise.all(endpoints);
    const m=mark?.data?.data?.[0],idx=index?.data?.data?.[0],f=funding?.data?.data?.[0],o=oi?.data?.data?.[0];
    this.contract={
      mark:+m?.markPx||this.get().last,
      index:+idx?.idxPx||this.get().last,
      fundingRate:f?.fundingRate!==undefined?+f.fundingRate:null,
      nextFundingTime:+f?.nextFundingTime||0,
      openInterest:+o?.oiCcy||+o?.oi||0,
      ts:Date.now()
    };
    this.emit('onContract',this.contract);return this.contract
  }
  status(ok,label){this.connected=ok;this.emit('onStatus',{ok,label,source:this.source,latency:this.latency,ts:Date.now()})}
  close(){
    clearTimeout(this.reconnect);clearInterval(this.poll);clearInterval(this.fastPoll);clearInterval(this.contractPoll);clearInterval(this.ping);
    if(this.ws){this.ws.onclose=null;try{this.ws.close()}catch{}}
    this.ws=null
  }
  startPolling(){
    clearInterval(this.poll);clearInterval(this.fastPoll);clearInterval(this.contractPoll);
    this.poll=setInterval(()=>this.fetchMarkets().catch(()=>{}),12000);
    this.fastPoll=setInterval(async()=>{
      if(Date.now()-this.lastMessage<5500)return;
      try{
        await Promise.all([this.fetchMarkets(),this.loadBook(),this.loadTrades()]);
        const {data:latest}=await json(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(this.current)}&bar=${encodeURIComponent(this.bar)}&limit=2`);
        const c=latest.data?.[0];if(c)this.applyCandle(candle(c));
        this.status(true,'OKX 轮询实时')
      }catch{this.status(false,'网络连接异常')}
    },3200);
    this.contractPoll=setInterval(()=>this.loadContractStats().catch(()=>{}),10000)
  }
  connect(){
    if(this.ws){this.ws.onclose=null;try{this.ws.close()}catch{}}
    const urls=['wss://ws.okx.com:8443/ws/v5/public','wss://ws.okx.com/ws/v5/public'];
    const url=urls[this.wsUrlIndex%urls.length];let opened=false;const ws=new WebSocket(url);this.ws=ws;
    const guard=setTimeout(()=>{if(!opened){try{ws.close()}catch{}this.wsUrlIndex++;this.scheduleReconnect()}},5500);
    ws.onopen=()=>{
      opened=true;clearTimeout(guard);this.lastMessage=Date.now();this.status(true,'OKX WebSocket 实时');
      const args=PAIRS.map(p=>({channel:'tickers',instId:p.instId}));
      args.push({channel:WS_BAR[this.bar],instId:this.current},{channel:'books5',instId:this.current},{channel:'trades',instId:this.current});
      ws.send(JSON.stringify({op:'subscribe',args}));
      clearInterval(this.ping);this.ping=setInterval(()=>{if(ws.readyState===1)ws.send('ping')},20000)
    };
    ws.onmessage=e=>{
      this.lastMessage=Date.now();if(e.data==='pong')return;
      let m;try{m=JSON.parse(e.data)}catch{return}
      const ch=m.arg?.channel;if(!ch||!m.data)return;
      if(ch==='tickers')this.applyTicker(m.arg.instId,m.data[0]);
      else if(ch.startsWith('candle'))this.applyCandle(candle(m.data[0]));
      else if(ch==='books5'){const b=m.data[0],fast={asks:bookRows(b.asks),bids:bookRows(b.bids)};this.book={asks:[...fast.asks,...this.book.asks].slice(0,50),bids:[...fast.bids,...this.book.bids].slice(0,50)};this.emit('onBook',this.book)}
      else if(ch==='trades'){const incoming=m.data.map(x=>({price:+x.px,qty:+x.sz,side:x.side,ts:+x.ts}));this.trades=[...incoming,...this.trades].slice(0,100);this.emit('onTrades',this.trades)}
    };
    ws.onerror=()=>this.status(false,'实时连接异常');
    ws.onclose=()=>{clearTimeout(guard);clearInterval(this.ping);if(this.ws===ws){this.wsUrlIndex++;this.status(false,'正在重连');this.scheduleReconnect()}}
  }
  scheduleReconnect(){clearTimeout(this.reconnect);this.reconnect=setTimeout(()=>this.connect(),2200)}
  applyTicker(id,x){if(!PAIR_MAP[id])return;const t=ticker({...x,instId:id});this.markets.set(id,t);this.emit('onTicker',id,t);this.emit('onMarkets',this.markets)}
  applyCandle(c){
    const last=this.candles[this.candles.length-1];
    if(last&&last.time===c.time)this.candles[this.candles.length-1]=c;
    else if(!last||c.time>last.time)this.candles.push(c);
    if(this.candles.length>400)this.candles.shift();
    this.emit('onCandle',c,this.candles)
  }
  async selectPair(id){
    if(!PAIR_MAP[id]||id===this.current)return;
    this.current=id;this.book={asks:[],bids:[]};this.trades=[];this.emit('onBook',this.book);this.emit('onTrades',this.trades);
    await Promise.all([this.loadCandles(),this.loadBook(),this.loadTrades(),this.loadContractStats()]);this.connect()
  }
  async setBar(bar){if(!BARS[bar]||bar===this.bar)return;this.bar=bar;await this.loadCandles();this.connect()}
  async retry(){for(let i=0;i<3;i++){try{await this.init();return true}catch{await sleep(1400*(i+1))}}return false}
}
