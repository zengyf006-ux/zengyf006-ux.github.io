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
 intro(){const intro=$('#presentationIntro'),app=$('#app'),enter=()=>{if(intro.classList.contains('hide'))return;intro.classList.add('hide');app.classList.add('ready');app.setAttribute('aria-hidden','false');setTimeout(()=>{intro.hidden=true;this.chart.resize()},190)};$('#enterDemo').onclick=enter;setTimeout(enter,680)}
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
