(()=>{'use strict';
const files=['01','02','03','04','05','06','07'].map(n=>`./app-b64/${n}.txt?v=1302`);
const enter=document.getElementById('introEnter');
let queued=false;
const queue=e=>{
 if(window.__ATLAS_V13_APP_READY)return;
 e.preventDefault();
 e.stopImmediatePropagation();
 queued=true;
 if(enter)enter.textContent='正在进入终端…';
};
enter?.addEventListener('click',queue,true);
const decode=b64=>{
 const raw=atob(b64),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 return new TextDecoder().decode(bytes);
};
const chartReady=window.__ATLAS_V13_CHART_READY?Promise.resolve():new Promise((resolve,reject)=>{
 let timer;
 const cleanup=()=>{
  document.removeEventListener('atlas-v13-chart-ready',done);
  document.removeEventListener('atlas-v13-load-error',fail);
  clearTimeout(timer);
 };
 const done=()=>{cleanup();resolve()};
 const fail=e=>{cleanup();reject(e.detail||new Error('图表模块加载失败'))};
 document.addEventListener('atlas-v13-chart-ready',done,{once:true});
 document.addEventListener('atlas-v13-load-error',fail,{once:true});
 timer=setTimeout(()=>{cleanup();reject(new Error('图表模块加载超时'))},15000);
});
Promise.all([chartReady,...files.map(async src=>{
 const r=await fetch(src,{cache:'force-cache'});
 if(!r.ok)throw new Error(src+' HTTP '+r.status);
 return r.text();
})]).then(([, ...parts])=>{
 new Function(decode(parts.join(''))+'\n//# sourceURL=atlas-v13-app.js')();
 window.__ATLAS_V13_APP_READY=true;
 enter?.removeEventListener('click',queue,true);
 if(queued)enter?.click();
}).catch(error=>{
 console.error('V13 app load failed',error);
 if(enter){enter.textContent='重新加载终端';enter.onclick=()=>location.reload()}
});
})();