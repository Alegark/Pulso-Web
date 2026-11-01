(async () => {
  const failures=[]; const checks=[];
  const assert=(ok,name)=>{checks.push({name,pass:!!ok});if(!ok)failures.push(name)};
  const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
  const tx=db.transaction('tickets');
  const all=req=>new Promise(resolve=>{req.onsuccess=()=>resolve(req.result)});
  const [keys,tickets]=await Promise.all([all(tx.objectStore('tickets').getAllKeys()),all(tx.objectStore('tickets').getAll())]);db.close();
  const held=(await navigator.locks.query()).held.map(x=>x.name);
  const key=keys[tickets.findIndex(t=>t.assetId==='fixture-A'&&held.includes(t.ownerProof))];
  assert(!!key,'ticket publicado sobrevive reapertura');
  const path='/_pulso/media/'+key;
  for(const [range,status,length,contentRange] of [
    ['bytes=0-1',206,2,'bytes 0-1/16527'],
    ['bytes=3-',206,16524,'bytes 3-16526/16527'],
    ['bytes=-3',206,3,'bytes 16524-16526/16527'],
    ['bytes=999999999-',416,0,'bytes */16527'],
    ['bytes=0-1,4-5',200,16527,null]]) {
    const response=await fetch(path,{headers:{Range:range}});
    assert(response.status===status&&(await response.arrayBuffer()).byteLength===length&&response.headers.get('Content-Range')===contentRange,range);
  }
  const head=await fetch(path,{method:'HEAD'});
  assert(head.status===200&&head.headers.get('Content-Length')==='16527'&&(await head.arrayBuffer()).byteLength===0,'HEAD');
  const bad=await fetch('/_pulso/media/00000000-0000-0000-0000-000000000000');
  assert(bad.status===403&&(await bad.arrayBuffer()).byteLength===0,'ticket ajeno sin bytes');
  const response=await fetch(path); const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
  assert(response.status===200&&response.headers.get('X-Content-Type-Options')==='nosniff'&&response.headers.get('Content-Type')==='audio/mpeg','GET completo y MIME seguro');
  return {checks,passed:failures.length===0,digest,userAgent:navigator.userAgent,secureContext:isSecureContext};
})()
