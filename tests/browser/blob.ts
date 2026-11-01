import {boundedBlobSources,releaseBlobSources} from '../../src/playback/blob-source';
import {importFile as importCore} from '../../src/imports/import-file';
// These legacy regressions intentionally exercise IDB-specific fault injection.
const backend=new URL(location.href).searchParams.get('backend')==='opfs'?'opfs':'idb';
const importFile:typeof importCore=(file,signal,progress,options)=>importCore(file,signal,progress,{...options,backend});
import {demoMusic} from '../../src/demo-music';
import {readRecord,writeRecord} from '../../src/storage/database';
import {assetDirectory} from '../../src/storage/asset-reader';
import type {LocalAsset} from '../../src/library/library';
const checks:{name:string;pass:boolean}[]=[];
const assert=(pass:boolean,name:string)=>{checks.push({name,pass});if(!pass)throw new Error(name);};
const ids:string[]=[];const proof=`pulso-web:local:owner:${crypto.randomUUID()}`;
await navigator.locks.request('pulso-web:local:playback',async()=>navigator.locks.request(proof,async()=>{
 for(const sample of demoMusic){const file=new File([await(await fetch(sample.file)).arrayBuffer()],sample.id+'.mp3',{type:sample.mime});const result=await importFile(file,new AbortController().signal);ids.push(result.track.assetId);}
 const memory=()=>((performance as Performance&{memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??null);
 const heapBefore=memory();const urls=await boundedBlobSources(ids,proof);const heapAfter=memory();let total=0;
 for(let i=0;i<urls.length;i++){const bytes=await(await fetch(urls[i])).arrayBuffer();total+=bytes.byteLength;const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');assert(hash===demoMusic[i].sha256&&bytes.byteLength===demoMusic[i].bytes,`muestra ${i+1} íntegra`);}
 releaseBlobSources(urls);let revoked=false;try{await fetch(urls[0]);}catch{revoked=true;}assert(revoked,'URLs liberadas después del consumidor');
 let rejected=false;try{await boundedBlobSources(ids,'pulso-web:local:owner:invalid');}catch{rejected=true;}assert(rejected,'owner inválido rechazado');
 const asset=await readRecord<LocalAsset>('assets',ids[1]);if(!asset)throw new Error('missing');
 const handle=backend==='opfs'?await(await assetDirectory()).getFileHandle(asset.storageKey):null;
 const key=[asset.storageKey,0];const original=handle?new Uint8Array(await(await handle.getFile()).arrayBuffer()):await readRecord<Uint8Array>('chunks',key);if(!original)throw new Error('missing bytes');
 const replace=async(bytes:Uint8Array)=>{if(handle){const writer=await handle.createWritable();await writer.write(new Uint8Array(bytes));await writer.close();}else await writeRecord('chunks',key,bytes);};
 const bad=original.slice();bad[0]^=255;await replace(bad);let corruptRejected=false;try{await boundedBlobSources(ids,proof);}catch{corruptRejected=true;}finally{await replace(original);}assert(corruptRejected,'bytes corruptos no reproducibles');
 if(handle){const padded=new Uint8Array(original.length+1);padded.set(original);await replace(padded);let rejected=false;try{await boundedBlobSources(ids,proof);}catch{rejected=true;}finally{await replace(original);}assert(rejected,'longitud OPFS sobrante rechazada');}
 (window as unknown as {pulsoBlob:unknown}).pulsoBlob={backend,passed:checks.every(c=>c.pass),checks,totalAudioBytes:total,heapBefore,heapAfter,userAgent:navigator.userAgent};
}));
document.querySelector('#results')!.textContent=JSON.stringify((window as unknown as {pulsoBlob:unknown}).pulsoBlob,null,2)+'\nCOMPLETADO';
