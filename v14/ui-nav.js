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
