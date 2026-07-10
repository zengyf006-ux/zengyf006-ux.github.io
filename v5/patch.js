const $=(s,p=document)=>p.querySelector(s);
const fire=(el,type='input')=>el?.dispatchEvent(new Event(type,{bubbles:true}));
setTimeout(()=>{
  const select=$('#leverage'),range=$('#leverageRange'),value=$('#leverageValue'),confirm=$('#confirmLeverage');
  const ensureOption=()=>{
    if(!select||!range)return;
    const v=`${range.value}x`;
    if(![...select.options].some(o=>o.value===v))select.add(new Option(v,v));
    select.value=v;
  };
  select?.addEventListener('change',()=>{
    const n=parseInt(select.value,10)||1;
    range.value=String(n);if(value)value.textContent=`${n}x`;
    confirm?.click();setTimeout(ensureOption,0);
  });
  confirm?.addEventListener('click',()=>setTimeout(ensureOption,0));

  document.addEventListener('click',e=>{
    const row=e.target.closest('.book-row');
    if(row){
      const price=row.querySelector('span')?.textContent?.replace(/,/g,'');
      const input=$('#orderPrice');
      if(price&&input){input.value=price;fire(input);if(innerWidth<700)$('#orderAmount')?.scrollIntoView({behavior:'smooth',block:'center'})}
    }
    if(e.target.closest('#lastPrice')){
      const input=$('#orderPrice'),v=$('#lastPrice')?.textContent?.replace(/,/g,'');
      if(input&&v&&!v.includes('-')){input.value=v;fire(input)}
    }
  });

  $('#lastPrice')?.setAttribute('title','点击将最新价填入委托价格');
  $('#fitBtn')?.setAttribute('title','适配全部K线（快捷键 F）');
  $('#realtimeBtn')?.setAttribute('title','回到最新K线（快捷键 R）');
  $('#bookPrecision')?.setAttribute('title','调整盘口价格聚合精度');
},300);
