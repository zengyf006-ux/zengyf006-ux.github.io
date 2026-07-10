(()=>{'use strict';
const files=['./bundle/01.txt?v=rc1','./bundle/02.txt?v=rc1','./bundle/03.txt?v=rc1','./bundle/04.txt?v=rc1','./bundle/05.txt?v=rc1','./bundle/06.txt?v=rc1','./bundle/07.txt?v=rc1','./bundle/08.txt?v=rc1'];
const enter=document.getElementById('enterDemo');let queued=false;
const hold=e=>{if(window.__ATLAS_BOOT_READY)return;e.preventDefault();e.stopImmediatePropagation();queued=true;if(enter)enter.textContent='正在进入终端…'};
enter?.addEventListener('click',hold,true);
const decode=async b64=>{const raw=atob(b64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);if(!('DecompressionStream'in window))throw new Error('浏览器不支持本地解压');const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return new TextDecoder().decode(await new Response(stream).arrayBuffer())};
Promise.all(files.map(async src=>{const r=await fetch(src,{cache:'force-cache'});if(!r.ok)throw new Error(src+' HTTP '+r.status);return r.text()})).then(parts=>decode(parts.join(''))).then(source=>{new Function(source+'\n//# sourceURL=atlas-x-release.js')();window.__ATLAS_BOOT_READY=true;enter?.removeEventListener('click',hold,true);if(queued)enter?.click()}).catch(error=>{console.error('ATLAS X boot failed',error);if(enter){enter.textContent='重新加载终端';enter.onclick=()=>location.reload()}})
})();