(async()=>{
 const checks=[];const assert=(ok,name)=>checks.push({name,pass:!!ok});
 const db=await new Promise((r,j)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
 const get=(store,key)=>new Promise((r,j)=>{const q=db.transaction(store).objectStore(store).get(key);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
 const put=(store,key,value)=>new Promise((r,j)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=r;tx.onabort=()=>j(tx.error)});
 const all=store=>new Promise(r=>{const q=db.transaction(store).objectStore(store).getAll();q.onsuccess=()=>r(q.result)});
 const keys=await new Promise(r=>{const q=db.transaction('tickets').objectStore('tickets').getAllKeys();q.onsuccess=()=>r(q.result)});
 const tickets=await all('tickets');const held=(await navigator.locks.query()).held.map(x=>x.name);
 const index=tickets.findIndex(t=>t.assetId==='fixture-A'&&held.includes(t.ownerProof));
 const token=keys[index];const ticket=tickets[index];const path='/_pulso/media/'+token;
 const manifest=await get('assets','fixture-A');const key=[manifest.storageKey,0];const original=await get('chunks',key);
 try {
   const corrupt=original.slice();corrupt[0]^=255;await put('chunks',key,corrupt);
   const response=await fetch(path);assert(response.status===409&&(await response.arrayBuffer()).byteLength===0,'bytes corruptos no entregados');
 }finally{await put('chunks',key,original);}
 try {
   await put('assets','fixture-A',{...manifest,chunks:-1});const response=await fetch(path);
   assert(response.status===404&&(await response.arrayBuffer()).byteLength===0,'manifiesto corrupto rechazado');
 }finally{await put('assets','fixture-A',manifest);}
 const restored=await fetch(path);assert(restored.status===200&&(await restored.arrayBuffer()).byteLength===manifest.bytes,'copia original conservada');
 const channel=new MessageChannel();const replacement=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('ticket timeout')),10000);
   channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data)};
   navigator.serviceWorker.controller.postMessage({version:1,type:'fixture-tickets',ownerProof:ticket.ownerProof,assetIds:['fixture-A','fixture-B','fixture-C']},[channel.port2]);
 });
 const old=await fetch(path);assert(old.status===403&&(await old.arrayBuffer()).byteLength===0,'ticket de generación anterior revocado');
 const next=await fetch('/_pulso/media/'+replacement.tokens?.[0]);assert(next.status===200&&(await next.arrayBuffer()).byteLength===manifest.bytes,'ticket nuevo autorizado');
 db.close();return {checks,passed:checks.every(x=>x.pass),userAgent:navigator.userAgent};
})()
