(()=>{'use strict';
const files=['./chart-b64/01.txt?v=1302','./chart-b64/02.txt?v=1302','./chart-b64/03.txt?v=1302'];
const decode=b64=>{const raw=atob(b64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new TextDecoder().decode(bytes)};
Promise.all(files.map(async src=>{const r=await fetch(src,{cache:'force-cache'});if(!r.ok)throw new Error(src+' HTTP '+r.status);return r.text()})).then(parts=>{new Function(decode(parts.join(''))+'\n//# sourceURL=atlas-v13-chart.js')();window.__ATLAS_V13_CHART_READY=true;document.dispatchEvent(new CustomEvent('atlas-v13-chart-ready'))}).catch(e=>{console.error('V13 chart load failed',e);document.dispatchEvent(new CustomEvent('atlas-v13-load-error',{detail:e}))});
})();