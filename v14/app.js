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
