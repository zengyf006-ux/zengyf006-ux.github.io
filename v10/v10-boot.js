(()=>{'use strict';const X=window.ATLAS_V10;
function backgroundChecks(){const api=window.__ATLAS_V7;if(!api)return;setInterval(()=>{if(document.hidden)return;const positions=Object.values(api.account?.data?.positions||{});for(const p of positions)api.account.check?.(p.instId);X.updateChartFooter?.(api.chart)},1000)}
function bind(){X.bindUI?.();X.bindChart?.(window.__ATLAS_V7?.chart);backgroundChecks();setTimeout(()=>{document.querySelector('#v10boot')?.remove();document.body.classList.add('v10-loaded')},720);window.__ATLAS_V10_READY=X}
const old=typeof bindV7==='function'?bindV7:null;if(old){bindV7=function(){old();bind()}}else document.addEventListener('DOMContentLoaded',bind);
})();
