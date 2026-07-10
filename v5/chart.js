const css=name=>getComputedStyle(document.body).getPropertyValue(name).trim();
const ma=(data,n)=>{const out=[];let sum=0;for(let i=0;i<data.length;i++){sum+=data[i].close;if(i>=n)sum-=data[i-n].close;if(i>=n-1)out.push({time:data[i].time,value:sum/n})}return out};
const boll=(data,n=20,k=2)=>{
  const mid=[],up=[],down=[];
  for(let i=n-1;i<data.length;i++){
    const slice=data.slice(i-n+1,i+1),m=slice.reduce((a,x)=>a+x.close,0)/n;
    const sd=Math.sqrt(slice.reduce((a,x)=>a+(x.close-m)**2,0)/n);
    mid.push({time:data[i].time,value:m});up.push({time:data[i].time,value:m+k*sd});down.push({time:data[i].time,value:m-k*sd});
  }
  return{mid,up,down}
};
export class ChartController{
  constructor(host,legend,status){
    this.host=host;this.legend=legend;this.status=status;this.chart=null;this.candles=null;this.volume=null;
    this.ma7=null;this.ma25=null;this.bollMid=null;this.bollUp=null;this.bollDown=null;this.data=[];this.showMA=true;this.showBoll=false;this.showVolume=true;this.lines=[];this.resizeObserver=null
  }
  init(){
    if(!window.LightweightCharts)throw new Error('chart library unavailable');
    this.destroy();
    const bg=css('--panel'),text=css('--muted'),grid=css('--line');
    this.chart=LightweightCharts.createChart(this.host,{
      width:this.host.clientWidth,height:this.host.clientHeight,
      layout:{background:{type:'solid',color:bg},textColor:text,fontFamily:'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',fontSize:11},
      grid:{vertLines:{color:grid},horzLines:{color:grid}},
      crosshair:{mode:LightweightCharts.CrosshairMode.Normal,vertLine:{color:'#7386aa',width:1,style:3,labelBackgroundColor:'#394761'},horzLine:{color:'#7386aa',width:1,style:3,labelBackgroundColor:'#394761'}},
      rightPriceScale:{borderColor:grid,scaleMargins:{top:.08,bottom:.22}},
      timeScale:{borderColor:grid,timeVisible:true,secondsVisible:false,rightOffset:4,barSpacing:8,minBarSpacing:2,fixLeftEdge:true},
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},
      kineticScroll:{mouse:true,touch:true},localization:{locale:'zh-CN'}
    });
    this.candles=this.chart.addCandlestickSeries({upColor:'#2dcc9a',downColor:'#ff6378',borderVisible:false,wickUpColor:'#2dcc9a',wickDownColor:'#ff6378',priceLineVisible:true,lastValueVisible:true});
    this.volume=this.chart.addHistogramSeries({color:'#6e8bff55',priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});
    this.chart.priceScale('volume').applyOptions({scaleMargins:{top:.78,bottom:0}});
    this.ma7=this.chart.addLineSeries({color:'#f1ba55',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
    this.ma25=this.chart.addLineSeries({color:'#7c78ff',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
    this.bollMid=this.chart.addLineSeries({color:'#4eb6ff',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,visible:false});
    this.bollUp=this.chart.addLineSeries({color:'#4eb6ff88',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,visible:false});
    this.bollDown=this.chart.addLineSeries({color:'#4eb6ff88',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,visible:false});
    this.chart.subscribeCrosshairMove(p=>this.crosshair(p));
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.host);
    this.status.textContent='K线交互已启用 · 延迟取决于网络';return this
  }
  setData(data,fit=true){
    this.data=data||[];if(!this.chart)this.init();
    this.candles.setData(this.data.map(x=>({time:x.time,open:x.open,high:x.high,low:x.low,close:x.close})));
    this.volume.setData(this.data.map(x=>({time:x.time,value:x.volume,color:x.close>=x.open?'#2dcc9a44':'#ff637844'})));
    this.ma7.setData(ma(this.data,7));this.ma25.setData(ma(this.data,25));
    const b=boll(this.data);this.bollMid.setData(b.mid);this.bollUp.setData(b.up);this.bollDown.setData(b.down);
    this.applyVisibility();if(fit)this.chart.timeScale().fitContent();
    const last=this.data[this.data.length-1];if(last)this.updateLegend(last)
  }
  update(c){
    if(!this.chart)return;
    const prev=this.data[this.data.length-1];
    if(prev&&prev.time===c.time)this.data[this.data.length-1]=c;else if(!prev||c.time>prev.time)this.data.push(c);
    this.candles.update({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close});
    this.volume.update({time:c.time,value:c.volume,color:c.close>=c.open?'#2dcc9a44':'#ff637844'});
    const m7=ma(this.data.slice(-50),7).pop(),m25=ma(this.data.slice(-80),25).pop(),b=boll(this.data.slice(-60));
    if(m7)this.ma7.update(m7);if(m25)this.ma25.update(m25);
    if(b.mid.at(-1)){this.bollMid.update(b.mid.at(-1));this.bollUp.update(b.up.at(-1));this.bollDown.update(b.down.at(-1))}
    this.updateLegend(c)
  }
  crosshair(p){if(!p?.time)return;const d=p.seriesData.get(this.candles);if(d)this.updateLegend({...d,volume:p.seriesData.get(this.volume)?.value||0})}
  updateLegend(d){const f=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:8});this.legend.innerHTML=`<span>O <b>${f(d.open)}</b></span><span>H <b>${f(d.high)}</b></span><span>L <b>${f(d.low)}</b></span><span>C <b class="${d.close>=d.open?'positive':'negative'}">${f(d.close)}</b></span><span>Vol <b>${Number(d.volume||0).toLocaleString('en-US',{maximumFractionDigits:2})}</b></span>`}
  toggleMA(){this.showMA=!this.showMA;this.applyVisibility();return this.showMA}
  toggleBoll(){this.showBoll=!this.showBoll;this.applyVisibility();return this.showBoll}
  toggleVolume(){this.showVolume=!this.showVolume;this.applyVisibility();return this.showVolume}
  applyVisibility(){
    this.ma7?.applyOptions({visible:this.showMA});this.ma25?.applyOptions({visible:this.showMA});this.volume?.applyOptions({visible:this.showVolume});
    this.bollMid?.applyOptions({visible:this.showBoll});this.bollUp?.applyOptions({visible:this.showBoll});this.bollDown?.applyOptions({visible:this.showBoll})
  }
  fit(){this.chart?.timeScale().fitContent()}
  realtime(){this.chart?.timeScale().scrollToRealTime()}
  resize(){if(this.chart&&this.host.clientWidth&&this.host.clientHeight)this.chart.applyOptions({width:this.host.clientWidth,height:this.host.clientHeight})}
  restyle(){if(!this.chart)return;const bg=css('--panel'),text=css('--muted'),grid=css('--line');this.chart.applyOptions({layout:{background:{type:'solid',color:bg},textColor:text},grid:{vertLines:{color:grid},horzLines:{color:grid}},rightPriceScale:{borderColor:grid},timeScale:{borderColor:grid}})}
  setPriceLines(items=[]){
    if(!this.candles)return;
    for(const l of this.lines){try{this.candles.removePriceLine(l)}catch{}}
    this.lines=[];
    for(const item of items){if(!item.price)continue;this.lines.push(this.candles.createPriceLine({price:item.price,color:item.color||'#6e8bff',lineWidth:1,lineStyle:item.dashed?2:0,axisLabelVisible:true,title:item.title||''}))}
  }
  setMarkers(items=[]){try{this.candles?.setMarkers(items.slice(-80))}catch{}}
  destroy(){this.resizeObserver?.disconnect();if(this.chart){try{this.chart.remove()}catch{}}this.chart=null;this.candles=null;this.volume=null;this.ma7=null;this.ma25=null;this.bollMid=null;this.bollUp=null;this.bollDown=null;this.lines=[]}
}
