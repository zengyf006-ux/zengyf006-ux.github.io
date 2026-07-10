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
  this.options={ema:true,volume:true};this.onSelect=null;this.onHover=null;this.onSeries=null;this.onViewChange=null;
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
 fit(){this.offset=0;this.visibleCount=clamp(Math.min(72,this.data.length||72),24,120);this.selected=-1;this.hover=-1;this.schedule()}
 clearSelection(){this.selected=-1;this.hover=-1;this.drawOverlay()}
 resize(){const host=this.canvas.parentElement,r=host.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);if(!r.width||!r.height)return;for(const c of [this.canvas,this.overlay]){c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);c.style.width=r.width+'px';c.style.height=r.height+'px'}this.dpr=d;this.width=r.width;this.height=r.height;this.schedule()}
 schedule(){if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw()})}
 visible(){const end=Math.max(0,this.data.length-this.offset),start=Math.max(0,end-this.visibleCount);return{items:this.data.slice(start,end),start,end}}
 calcBounds(items){const mobile=this.width<600,pad={l:0,r:mobile?64:76,t:38,b:this.options.volume?(mobile?68:78):35},mainH=Math.max(110,this.height-pad.t-pad.b);let min=Math.min(...items.map(x=>x.low)),max=Math.max(...items.map(x=>x.high));if(!Number.isFinite(min)||!Number.isFinite(max)){min=0;max=1}let spread=max-min||Math.max(1,max*.01);min-=spread*.075;max+=spread*.08;spread=max-min;const plotW=this.width-pad.l-pad.r,candleW=plotW/Math.max(1,items.length);return{...pad,mainH,min,max,spread,plotW,candleW,volumeTop:pad.t+mainH+8,volumeH:this.options.volume?(mobile?34:43):0}}
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
  if(this.options.ema){const closes=items.map(x=>x.close),e10=this.ema(closes,10),e20=this.ema(closes,20);this.drawLine(e10,b,'#ff8a00',1.5);this.drawLine(e20,b,'#f33d94',1.45);this.onSeries?.({ema10:e10.at(-1),ema20:e20.at(-1)})}
  const hi=Math.max(...items.map(x=>x.high)),lo=Math.min(...items.map(x=>x.low)),hiIdx=items.findIndex(x=>x.high===hi),loIdx=items.findIndex(x=>x.low===lo);this.marker(ctx,this.xFor(hiIdx,b),this.yFor(hi,b),formatNumber(hi),true,w,b);this.marker(ctx,this.xFor(loIdx,b),this.yFor(lo,b),formatNumber(lo),false,w,b);
  const last=items.at(-1),ly=this.yFor(last.close,b),color=last.close>=last.open?green:red;ctx.strokeStyle='#656a72';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,ly+.5);ctx.lineTo(w-b.r,ly+.5);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fff';ctx.strokeStyle='#8c9096';ctx.strokeRect(w-b.r+3,ly-22,b.r-7,44);ctx.fillRect(w-b.r+4,ly-21,b.r-9,42);ctx.fillStyle='#51565d';ctx.textAlign='center';ctx.font='700 12px -apple-system';ctx.fillText(formatNumber(last.close),w-b.r/2,ly-8);ctx.font='11px -apple-system';ctx.fillText(this.countdown(last.time),w-b.r/2,ly+10);
  this.startIndex=start;this.drawOverlay();
 }
 drawLine(vals,b,color,width){const ctx=this.ctx;ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;let begun=false;vals.forEach((v,i)=>{if(v==null)return;const x=this.xFor(i,b),y=this.yFor(v,b);if(!begun){ctx.moveTo(x,y);begun=true}else ctx.lineTo(x,y)});ctx.stroke();ctx.lineWidth=1}
 ema(a,n){const k=2/(n+1);let p=null;return a.map(v=>(p=p==null?v:v*k+p*(1-k)))}
 marker(ctx,x,y,text,top,w,b){const right=x>w*.68,dir=right?-1:1,len=42;ctx.strokeStyle='#2d3035';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dir*len,y);ctx.stroke();ctx.fillStyle='#555a61';ctx.textAlign=right?'right':'left';ctx.fillText(text,x+dir*(len+4),y+(top?-9:11))}
 countdown(ts){const sec=Math.max(0,3600-(Math.floor(Date.now()/1000)-ts));return`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}
 indexAt(clientX){const r=this.overlay.getBoundingClientRect(),x=clientX-r.left,b=this.bounds;if(!b)return 0;return clamp(Math.floor((x-b.l)/b.candleW),0,Math.max(0,this.visible().items.length-1))}
 updateHover(x,y){const r=this.overlay.getBoundingClientRect();if(x<r.left||x>r.right||y<r.top||y>r.bottom)return;this.hover=this.indexAt(x);this.drawOverlay();const c=this.visible().items[this.hover];if(c)this.onHover?.(c)}
 selectAt(x,y){const r=this.overlay.getBoundingClientRect();if(y<r.top||y>r.bottom)return;this.selected=this.indexAt(x);const c=this.visible().items[this.selected];if(c){this.onSelect?.(c);this.drawOverlay()}}
 drawOverlay(){const d=this.dpr||1,ctx=this.octx,w=this.width||1,h=this.height||1;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);const idx=this.selected>=0?this.selected:this.hover,{items}=this.visible(),b=this.bounds;if(idx<0||!items[idx]||!b)return;const c=items[idx],x=this.xFor(idx,b),y=this.yFor(c.close,b);ctx.strokeStyle='rgba(69,73,80,.64)';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x,b.t);ctx.lineTo(x,b.t+b.mainH+b.volumeH+8);ctx.moveTo(0,y);ctx.lineTo(w-b.r,y);ctx.stroke();ctx.setLineDash([]);const time=new Date(c.time*1000).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});ctx.font='11px -apple-system';ctx.textAlign='center';const tw=Math.min(154,ctx.measureText(time).width+18),tx=clamp(x-tw/2,3,w-b.r-tw-3);ctx.fillStyle='#4c5056';ctx.fillRect(tx,h-28,tw,24);ctx.fillStyle='#fff';ctx.fillText(time,tx+tw/2,h-16);ctx.fillStyle='#4c5056';ctx.fillRect(w-b.r+3,y-13,b.r-7,26);ctx.fillStyle='#fff';ctx.fillText(formatNumber(c.close),w-b.r/2,y)}
 destroy(){this.resizeObserver.disconnect();cancelAnimationFrame(this.raf)}
}
window.AtlasProChart=AtlasProChart;
})();
