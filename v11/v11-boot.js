(()=>{'use strict';const X=window.ATLAS_V11=window.ATLAS_V11||{};
function bind(){X.bindUI?.();X.bindTap?.(window.__ATLAS_V7?.chart);X.startAudit?.();const api=window.__ATLAS_V7;api?.market?.on?.(type=>{if(['pair','candles'].includes(type))setTimeout(()=>X.bindTap?.(api.chart),40)});setTimeout(()=>{document.querySelector('#v11boot')?.remove();document.body.classList.add('v11-loaded');X.audit?.('loaded')},850);window.__ATLAS_V11_READY=X}
const old=typeof bindV7==='function'?bindV7:null;if(old){bindV7=function(){old();bind()}}else document.addEventListener('DOMContentLoaded',bind);
})();
