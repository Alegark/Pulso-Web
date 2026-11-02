/** TESTONLY native browser IDB/OPFS seed, before loading product MAIN.
 * No import UI is reintroduced. No product guards/transactions are replaced.
 */
export async function seedLibrary({pending=false}={}){
 const req=indexedDB.open('pulso-web-local-v1',2);
 const db=await new Promise((resolve,reject)=>{req.onupgradeneeded=()=>{for(const s of ['assets','chunks','jobs','tickets','settings','tracks','playlists'])req.result.createObjectStore(s);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 const tracks=[],assets=[],chunks=[];
 for(const [i,file]of ['tone.wav','tone.mp3'].entries()){
  const bytes=new Uint8Array(await(await fetch('/__r124/'+file)).arrayBuffer());
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const id=`12400000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,storageKey=`12400000-0000-4000-9000-${String(i+1).padStart(12,'0')}`;
  const backend=i===0?'idb':'opfs';
  if(backend==='opfs'){const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1',{create:true});const writer=await(await dir.getFileHandle(storageKey,{create:true})).createWritable();await writer.write(bytes);await writer.close();}
  else for(let n=0;n<Math.ceil(bytes.length/65536);n++)chunks.push([[storageKey,n],bytes.slice(n*65536,(n+1)*65536)]);
  assets.push({id,namespace:'local',storageKey,bytes:bytes.length,sha256,mime:i?'audio/mpeg':'audio/wav',chunks:Math.ceil(bytes.length/65536),chunkSize:65536,state:'complete',revision:1,retention:'kept',backend});
  tracks.push({id,assetId:id,title:`R124 tono ${i?'MP3 OPFS':'WAV IDB'}`,artist:'Fixture propia NoTelegram',album:'R124',duration:45,favorite:i===0,revision:1,createdAt:'2026-01-01T00:00:00.000Z',manualOverrides:{}});
 }
 const tx=db.transaction(['tracks','assets','chunks','settings','playlists','jobs'],'readwrite');
 const done=new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=()=>j(tx.error);});
 for(const t of tracks)tx.objectStore('tracks').put(t,t.id);
 for(const [i,a]of assets.entries()){
  tx.objectStore('assets').put(a,a.id);
  // Complete fictional publication history for this test-owned fixture. This
  // native seed is created before MAIN, never by granting a live root guard.
  const operationId=`12400000-0000-4000-c000-${String(i+1).padStart(12,'0')}`,owner='12400000-0000-4000-d000-000000000001';
  tx.objectStore('settings').put({operationId,owner,everPublished:true},['asset-ownership',a.backend,a.storageKey]);
  tx.objectStore('jobs').put({version:1,operationId,owner,revision:1,state:'sealed',backend:a.backend,storageKey:a.storageKey,bytes:a.bytes,expectedBytes:a.bytes,asset:a,track:tracks[i],expectedAssetRevision:0,result:{track:tracks[i],duplicate:false}},operationId);
 }
 for(const [key,value]of chunks)tx.objectStore('chunks').put(value,key);
 tx.objectStore('settings').put('dark','theme');
 tx.objectStore('playlists').put({id:'12400000-0000-4000-a000-000000000001',name:'R124 conservada',entries:tracks.map((t,i)=>({id:`12400000-0000-4000-b000-${String(i+1).padStart(12,'0')}`,trackId:t.id})),revision:1},'12400000-0000-4000-a000-000000000001');
 if(pending)tx.objectStore('jobs').put({TESTONLY:'R124 invalid import retained, never recover/delete'},'r124-pending');
 await done;db.close();return {tracks,assets,pending};
}

/** Detached, full byte-aware native musical snapshot; no product storage wrapper. */
export async function musicalSnapshot(){
 const databases=await indexedDB.databases();
 const req=indexedDB.open('pulso-web-local-v1',2);const db=await new Promise((r,j)=>{req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error);});
 const out={databases:databases.map(d=>({name:d.name,version:d.version})).sort((a,b)=>a.name.localeCompare(b.name)),stores:{},opfs:[],localStorage:{...localStorage},sessionStorage:{...sessionStorage}};
 const requests=[];const tx=db.transaction([...db.objectStoreNames]);
 for(const name of db.objectStoreNames){const store=tx.objectStore(name);requests.push(new Promise((r,j)=>{const values=store.getAll(),keys=store.getAllKeys();values.onerror=()=>j(values.error);keys.onerror=()=>j(keys.error);let n=0;const done=()=>{if(++n===2){out.stores[name]=keys.result.map((key,i)=>[key,values.result[i]]);r();}};values.onsuccess=done;keys.onsuccess=done;}));}
 await Promise.all(requests);db.close();for(const rows of Object.values(out.stores))for(const row of rows)if(row[1] instanceof Uint8Array){const b=row[1];row[1]={R124nativeBytes:b.byteLength,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('')};}
 const walk=async(dir,prefix='')=>{for await(const [name,h]of dir.entries()){if(h.kind==='directory')await walk(h,prefix+name+'/');else{const b=await(await h.getFile()).arrayBuffer();out.opfs.push([prefix+name,b.byteLength,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('')]);}}};
 await walk(await navigator.storage.getDirectory());out.opfs.sort();return out;
}
