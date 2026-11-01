(async()=>{
 const db=await new Promise((r,j)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
 const collect=(store,keys=false)=>new Promise(r=>{const s=db.transaction(store).objectStore(store);const q=keys?s.getAllKeys():s.getAll();q.onsuccess=()=>r(q.result)});
 const [keys,tickets,assets]=await Promise.all([collect('tickets',true),collect('tickets'),collect('assets')]);db.close();
 const held=(await navigator.locks.query()).held.map(x=>x.name);const i=tickets.findIndex(t=>held.includes(t.ownerProof)&&assets.some(a=>a.id===t.assetId&&['idb','opfs'].includes(a.backend)));
 if(i<0)throw new Error('No hay selección local preparada');const asset=assets.find(a=>a.id===tickets[i].assetId);const path='/_pulso/media/'+keys[i];
 const checks=[];const ok=(pass,name)=>checks.push({name,pass});
 const response=await fetch(path);const bytes=await response.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');ok(response.status===200&&bytes.byteLength===asset.bytes&&hash===asset.sha256,'archivo importado completo e íntegro');
 for(const [range,status,size] of [['bytes=0-1',206,2],['bytes=-3',206,3],['bytes=3-',206,asset.bytes-3],[`bytes=${asset.bytes}-`,416,0]]){const r=await fetch(path,{headers:{Range:range}});ok(r.status===status&&(await r.arrayBuffer()).byteLength===size,range.startsWith('bytes=')?range.replace(String(asset.bytes),'EOF'):range);}
 const head=await fetch(path,{method:'HEAD'});ok(head.status===200&&head.headers.get('Content-Length')===String(asset.bytes)&&(await head.arrayBuffer()).byteLength===0,'HEAD sin cuerpo');
 return {passed:checks.every(c=>c.pass),backend:asset.backend,checks,userAgent:navigator.userAgent};
})()
