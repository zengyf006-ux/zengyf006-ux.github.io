const KEY='atlas-x-v5-account';
const uid=()=>`${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const freshAccount=()=>({initial:100000,cash:100000,positions:{},orders:[],trades:[],journal:[],fees:0,equityHistory:[{t:Date.now(),v:100000}],createdAt:Date.now()});
export function loadAccount(){try{const a=JSON.parse(localStorage.getItem(KEY));return a?{...freshAccount(),...a,positions:a.positions||{},orders:a.orders||[],trades:a.trades||[],journal:a.journal||[],equityHistory:a.equityHistory||[]}:freshAccount()}catch{return freshAccount()}}
export class AccountEngine{
  constructor(priceFn){this.priceFn=priceFn;this.data=loadAccount();this.listeners=[]}
  on(fn){this.listeners.push(fn);return()=>this.listeners=this.listeners.filter(x=>x!==fn)}
  emit(){this.save();for(const fn of this.listeners)try{fn(this.snapshot())}catch(e){console.error(e)}}
  save(){try{localStorage.setItem(KEY,JSON.stringify(this.data))}catch{}}
  reset(){this.data=freshAccount();this.emit()}
  addFunds(v){const n=Number(v);if(!n||n<=0)return false;this.data.cash+=n;this.data.initial+=n;this.data.journal.unshift({id:uid(),type:'fund',text:`增加模拟资金 ${n.toFixed(2)} USDT`,ts:Date.now()});this.emit();return true}
  price(instId){return Number(this.priceFn(instId)||0)}
  snapshot(){
    let spot=0,perpMargin=0,unrealized=0;
    for(const p of Object.values(this.data.positions)){
      const px=this.price(p.instId)||p.avg;
      if(p.type==='spot'){spot+=px*p.qty;unrealized+=(px-p.avg)*p.qty}
      else{perpMargin+=p.margin;unrealized+=(px-p.avg)*p.qty}
    }
    const equity=this.data.cash+spot+perpMargin+unrealized;
    const ret=this.data.initial?(equity-this.data.initial)/this.data.initial*100:0;
    return{...this.data,equity,spot,perpMargin,positionValue:spot+perpMargin,unrealized,returnRate:ret}
  }
  available(){return this.data.cash}
  order(input){
    const o={id:uid(),instId:input.instId,base:input.base,product:input.product||'spot',type:input.type||'limit',side:input.side||'buy',amount:Number(input.amount),price:Number(input.price),trigger:Number(input.trigger||0),leverage:Number(input.leverage||1),tp:Number(input.tp||0),sl:Number(input.sl||0),marginMode:input.marginMode||'cross',postOnly:!!input.postOnly,reduceOnly:!!input.reduceOnly,status:'open',createdAt:Date.now()};
    if(!o.amount||o.amount<=0)return{ok:false,error:'请输入有效数量'};
    const market=this.price(o.instId);if(!market)return{ok:false,error:'实时价格尚未加载'};
    if(o.type==='limit'&&!o.price)return{ok:false,error:'请输入委托价格'};
    if(o.type==='trigger'&&!o.trigger)return{ok:false,error:'请输入触发价格'};
    if(o.product==='spot'&&o.reduceOnly)return{ok:false,error:'现货不支持只减仓'};
    if(o.product==='perp'&&o.reduceOnly){
      const p=this.data.positions[`${o.base}-PERP`];
      const closes=p&&((p.qty>0&&o.side==='sell')||(p.qty<0&&o.side==='buy'));
      if(!closes)return{ok:false,error:'只减仓订单不能增加或反向建立仓位'}
    }
    if(o.type==='market')return this.execute(o,market);
    if(o.postOnly){
      const wouldFill=o.side==='buy'?o.price>=market:o.price<=market;
      if(wouldFill)return{ok:false,error:'Post Only 委托会立即成交，请调整价格'}
    }
    this.data.orders.unshift(o);
    this.data.journal.unshift({id:uid(),type:'order',text:`提交${o.product==='spot'?'现货':`${o.marginMode==='cross'?'全仓':'逐仓'}永续`}${o.side==='buy'?'买入/做多':'卖出/做空'}委托 ${o.amount} ${o.base}`,ts:Date.now()});
    this.emit();return{ok:true,order:o}
  }
  execute(o,fill){
    const total=o.amount*fill,feeRate=o.product==='spot'?.001:.0005,fee=total*feeRate;let realized=0;
    if(o.product==='spot'){
      const key=`${o.base}-SPOT`,p=this.data.positions[key];
      if(o.side==='buy'){
        if(this.data.cash<total+fee)return{ok:false,error:'模拟余额不足'};
        this.data.cash-=total+fee;const q=p?.qty||0,c=p?q*p.avg:0;
        this.data.positions[key]={key,type:'spot',instId:o.instId,base:o.base,qty:q+o.amount,avg:(c+total)/(q+o.amount),tp:o.tp,sl:o.sl,marginMode:'cash'}
      }else{
        if(!p||p.qty+1e-12<o.amount)return{ok:false,error:`${o.base} 可用持仓不足`};
        realized=(fill-p.avg)*o.amount-fee;this.data.cash+=total-fee;p.qty-=o.amount;if(p.qty<=1e-10)delete this.data.positions[key]
      }
    }else{
      const key=`${o.base}-PERP`,signed=o.side==='buy'?o.amount:-o.amount,lev=Math.max(1,o.leverage||1);let p=this.data.positions[key];
      if(o.reduceOnly){
        if(!p)return{ok:false,error:'当前没有可减少的永续仓位'};
        const closing=(p.qty>0&&signed<0)||(p.qty<0&&signed>0);
        if(!closing)return{ok:false,error:'只减仓方向错误'}
      }
      if(!p||Math.sign(p.qty)===Math.sign(signed)){
        if(o.reduceOnly)return{ok:false,error:'只减仓订单不能增加仓位'};
        const margin=total/lev;if(this.data.cash<margin+fee)return{ok:false,error:'模拟保证金不足'};
        this.data.cash-=margin+fee;
        if(!p)this.data.positions[key]={key,type:'perp',instId:o.instId,base:o.base,qty:signed,avg:fill,leverage:lev,margin,tp:o.tp,sl:o.sl,marginMode:o.marginMode||'cross'};
        else{const a=Math.abs(p.qty),b=Math.abs(signed);p.avg=(p.avg*a+fill*b)/(a+b);p.qty+=signed;p.margin+=margin;p.leverage=lev;p.tp=o.tp||p.tp;p.sl=o.sl||p.sl;p.marginMode=o.marginMode||p.marginMode}
      }else{
        const close=Math.min(Math.abs(p.qty),Math.abs(signed)),dir=Math.sign(p.qty),release=p.margin*(close/Math.abs(p.qty));
        realized=(fill-p.avg)*close*dir-fee;this.data.cash+=release+realized;p.margin-=release;p.qty-=dir*close;
        const remain=Math.abs(signed)-close;
        if(Math.abs(p.qty)<=1e-10)delete this.data.positions[key];
        if(remain>1e-10&&!o.reduceOnly){
          const margin=remain*fill/lev;
          if(this.data.cash>=margin){this.data.cash-=margin;this.data.positions[key]={key,type:'perp',instId:o.instId,base:o.base,qty:Math.sign(signed)*remain,avg:fill,leverage:lev,margin,tp:o.tp,sl:o.sl,marginMode:o.marginMode||'cross'}}
        }
      }
    }
    this.data.fees+=fee;
    const trade={...o,status:'filled',fillPrice:fill,fee,realizedPnl:realized,filledAt:Date.now()};
    this.data.trades.unshift(trade);this.data.orders=this.data.orders.filter(x=>x.id!==o.id);
    this.data.journal.unshift({id:uid(),type:'trade',text:`${o.side==='buy'?'买入/做多':'卖出/做空'} ${o.amount} ${o.base} 成交于 ${fill}`,ts:Date.now(),pnl:realized});
    this.recordEquity();this.emit();return{ok:true,trade}
  }
  check(instId){
    const px=this.price(instId);if(!px)return;
    for(const o of [...this.data.orders]){
      if(o.instId!==instId)continue;let hit=false;
      if(o.type==='limit')hit=o.side==='buy'?px<=o.price:px>=o.price;
      else if(o.type==='trigger')hit=o.side==='buy'?px>=o.trigger:px<=o.trigger;
      if(hit)this.execute(o,o.type==='limit'?o.price:px)
    }
    for(const p of Object.values({...this.data.positions})){
      if(p.instId!==instId)continue;
      const long=p.type==='spot'||p.qty>0;
      if(p.tp&&((long&&px>=p.tp)||(!long&&px<=p.tp)))this.close(p.key,'止盈触发');
      else if(p.sl&&((long&&px<=p.sl)||(!long&&px>=p.sl)))this.close(p.key,'止损触发')
    }
  }
  cancel(id){const o=this.data.orders.find(x=>x.id===id);if(!o)return false;this.data.orders=this.data.orders.filter(x=>x.id!==id);this.data.journal.unshift({id:uid(),type:'cancel',text:`撤销 ${o.base} 委托`,ts:Date.now()});this.emit();return true}
  close(key,reason='手动平仓'){
    const p=this.data.positions[key];if(!p)return{ok:false,error:'持仓不存在'};
    const o={id:uid(),instId:p.instId,base:p.base,product:p.type,type:'market',side:p.type==='spot'?'sell':p.qty>0?'sell':'buy',amount:Math.abs(p.qty),leverage:p.leverage||1,marginMode:p.marginMode||'cross',reduceOnly:p.type==='perp',createdAt:Date.now()};
    const r=this.execute(o,this.price(p.instId)||p.avg);if(r.ok)this.data.journal.unshift({id:uid(),type:'close',text:`${reason}：${p.base}`,ts:Date.now()});this.save();return r
  }
  recordEquity(){const s=this.snapshot(),last=this.data.equityHistory.at(-1);if(!last||Date.now()-last.t>30000)this.data.equityHistory.push({t:Date.now(),v:s.equity});else last.v=s.equity;if(this.data.equityHistory.length>500)this.data.equityHistory.shift()}
  metrics(){
    const s=this.snapshot(),closed=this.data.trades.filter(x=>Number.isFinite(x.realizedPnl)&&x.realizedPnl!==0),wins=closed.filter(x=>x.realizedPnl>0),losses=closed.filter(x=>x.realizedPnl<0),grossWin=wins.reduce((a,x)=>a+x.realizedPnl,0),grossLoss=Math.abs(losses.reduce((a,x)=>a+x.realizedPnl,0));
    let peak=this.data.initial,maxDD=0;for(const x of this.data.equityHistory){peak=Math.max(peak,x.v);maxDD=Math.min(maxDD,(x.v-peak)/peak*100)}
    let streak=0,maxStreak=0;for(const x of closed){if(x.realizedPnl<0){streak++;maxStreak=Math.max(maxStreak,streak)}else streak=0}
    const alloc=[];for(const p of Object.values(this.data.positions)){const px=this.price(p.instId)||p.avg,value=p.type==='spot'?px*p.qty:p.margin+(px-p.avg)*p.qty;alloc.push({name:p.base,value:Math.max(0,value),type:p.type})}
    alloc.push({name:'USDT',value:Math.max(0,this.data.cash),type:'cash'});
    const maxAlloc=s.equity?Math.max(0,...alloc.filter(x=>x.name!=='USDT').map(x=>x.value/s.equity*100)):0;
    const perpExposure=Object.values(this.data.positions).filter(x=>x.type==='perp').reduce((a,p)=>a+Math.abs(p.qty)*(this.price(p.instId)||p.avg),0);
    const risk=Math.round(Math.min(100,maxAlloc*.75+Math.min(35,perpExposure/Math.max(1,s.equity)*12)+Math.min(15,Math.abs(maxDD))));
    return{...s,closed,wins,losses,winRate:closed.length?wins.length/closed.length*100:null,profitFactor:grossLoss?grossWin/grossLoss:null,maxDrawdown:maxDD,lossStreak:maxStreak,allocation:alloc,maxAllocation:maxAlloc,perpExposure,risk}
  }
  export(){
    const blob=new Blob([JSON.stringify({generatedAt:new Date().toISOString(),account:this.data,metrics:this.metrics(),notice:'模拟账户数据，不构成投资建议。'},null,2)],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=`atlas-x-v5-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
  }
}
