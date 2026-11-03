/** Detached, full byte-aware native musical snapshot; no product storage wrapper. */
export async function musicalSnapshot(){
 const databases=await indexedDB.databases();
 const req=indexedDB.open('pulso-web-local-v1',2);const db=await new Promise((r,j)=>{req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error);});
 const out={databases:databases.map(d=>({name:d.name,version:d.version})).sort((a,b)=>a.name.localeCompare(b.name)),stores:{},opfs:[],localStorage:{...localStorage},sessionStorage:{...sessionStorage}};
 const requests=[];const tx=db.transaction([...db.objectStoreNames]);
 for(const name of db.objectStoreNames){const store=tx.objectStore(name);requests.push(new Promise((r,j)=>{const values=store.getAll(),keys=store.getAllKeys();values.onerror=()=>j(values.error);keys.onerror=()=>j(keys.error);let n=0;const done=()=>{if(++n===2){out.stores[name]=keys.result.map((key,i)=>[key,values.result[i]]);r();}};values.onsuccess=done;keys.onsuccess=done;}));}
 await Promise.all(requests);db.close();for(const rows of Object.values(out.stores))for(const row of rows)if(row[1] instanceof Uint8Array){const b=row[1];row[1]={R146nativeBytes:b.byteLength,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('')};}
 const walk=async(dir,prefix='')=>{for await(const [name,h]of dir.entries()){if(h.kind==='directory')await walk(h,prefix+name+'/');else{const b=await(await h.getFile()).arrayBuffer();out.opfs.push([prefix+name,b.byteLength,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('')]);}}};
 await walk(await navigator.storage.getDirectory());out.opfs.sort();return out;
}
