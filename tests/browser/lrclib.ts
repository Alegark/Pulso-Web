import {readLrclib,type LrclibOptions} from '../../src/library/lrclib';
declare global {
 interface Window {
  lrclibFixture:(mode:string)=>Promise<{requests:number;blocked:number;unsafeHeaders:number;redirectTargets:number}>;
  pulsoLrclib?:{passed:boolean;results:{name:string;passed:boolean}[]};
 }
}
const input=Object.freeze({title:'Órbita (Live)',artist:'Taller Δ',album:'Luz',durationSeconds:120});
const options:LrclibOptions={enabled:true,current:()=>true};
const results:{name:string;passed:boolean}[]=[];
function check(ok:unknown):asserts ok {if(!ok)throw new Error('assertion');}
async function group(name:string,work:()=>Promise<void>){try{await work();results.push({name,passed:true});}catch{results.push({name,passed:false});}}
async function read(mode:string,extra:Partial<LrclibOptions>={}){await window.lrclibFixture(mode);return readLrclib(input,{...options,...extra});}
async function main(){
 await group('B01 disabled/missing-input, zero fetch and immutable Track canary',async()=>{
  const before=await window.lrclibFixture('normal');
  check((await readLrclib(input,{...options,enabled:false})).state==='disabled');
  check((await readLrclib({...input,title:''},options)).state==='missing-input');
  const after=await window.lrclibFixture('normal');check(before.requests===after.requests);
  // No product storage imported. A real own IDB tracks canary is created only by the test.
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('lrclib-r57-canary',1);r.onupgradeneeded=()=>r.result.createObjectStore('tracks');r.onerror=()=>reject();r.onsuccess=()=>resolve(r.result);});
  try {
   await new Promise<void>((resolve,reject)=>{const tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').put({...input,favorite:true,revision:57},'canary');tx.oncomplete=()=>resolve();tx.onabort=()=>reject();});
   check((await read('normal')).state==='candidate');
   const canary=await new Promise<{revision:number;favorite:boolean}>((resolve,reject)=>{const r=db.transaction('tracks').objectStore('tracks').get('canary');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject();});
   check(canary.revision===57&&canary.favorite===true&&Object.isFrozen(input));
  }finally{db.close();await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('lrclib-r57-canary');r.onsuccess=()=>resolve();r.onerror=()=>reject();});}
 });
 await group('B02 native fetch single response: lyrics/metadata, inert DOM, mismatch',async()=>{
  const before=await window.lrclibFixture('normal');const r=await readLrclib(input,options);
  const after=await window.lrclibFixture('normal');check(after.requests===before.requests+1);
  check(r.state==='candidate');check(r.record.origin.provider==='lrclib'&&r.record.origin.recordId===57);
  check(r.record.syncedLyrics?.kind==='timed'&&r.record.syncedLyrics.cues.length===1);
  const text=r.record.plainLyrics;check(text&&'text' in text);document.querySelector('#text')!.textContent=text.text;
  check(document.querySelector('#text img')===null&&!Object.hasOwn(globalThis,'pwned'));
  const mismatch=await read('conflict');check(mismatch.state==='conflict'&&mismatch.contrast.title==='conflict');
 });
 await group('B03 plain, instrumental and not-found are distinct',async()=>{
  const plain=await read('plain');check(plain.state==='candidate'&&plain.record.syncedLyrics===null&&plain.record.plainLyrics?.kind==='plain');
  check((await read('instrumental')).state==='instrumental');check((await read('not-found')).state==='not-found');
 });
 await group('B04 MIME/JSON/stream byte bound, native network and redirect deny',async()=>{
  for(const mode of ['bad-mime','bad-json','oversize']){const r=await read(mode);check(r.state==='unavailable'&&r.reason==='protocol-invalid');}
  const network=await read('network');check(network.state==='unavailable'&&network.reason==='network');
  const redirect=await read('redirect');check(redirect.state==='unavailable'&&redirect.reason==='network');
  const stats=await window.lrclibFixture('normal');check(stats.redirectTargets===0&&stats.blocked===0&&stats.unsafeHeaders===0);
 });
 await group('B05 cancellation/current/timeout with real pending fetch and no late success',async()=>{
  const signal=new AbortController();signal.abort();check((await read('normal',{signal:signal.signal})).state==='cancelled');
  for(const reason of ['signal','stale','timeout']){
   const c=new AbortController();let current=true;await window.lrclibFixture('hold');
   const timer=setTimeout(()=>{if(reason==='signal')c.abort();if(reason==='stale')current=false;},5);
   try {
    const r=await readLrclib(input,{...options,signal:c.signal,current:()=>current,timeoutMs:reason==='timeout'?10:1000});
    if(reason==='timeout')check(r.state==='unavailable'&&r.reason==='timeout');else check(r.state==='cancelled'&&r.reason===reason);
   }finally{clearTimeout(timer);}
  }
  // Revocation at the first read boundary after native fetch: checkpoint counter is
  // deterministic instrumentation, distinct from real network cancellation above.
  let checks=0;const late=await read('normal',{current:()=>++checks<8});check(late.state==='cancelled'&&late.reason==='stale');
 });
 await group('B06 Retry-After exposed from synthetic 429/503; no retries or credentials',async()=>{
  for(const mode of ['429','503']){
   const before=await window.lrclibFixture(mode);const r=await readLrclib(input,options);const after=await window.lrclibFixture(mode);
   check(r.state==='unavailable'&&r.retryAfterSeconds===12);check(after.requests===before.requests+1&&after.unsafeHeaders===0);
  }
  const stats=await window.lrclibFixture('normal');check(stats.blocked===0&&stats.redirectTargets===0);
 });
 window.pulsoLrclib={passed:results.length===6&&results.every(r=>r.passed),results};
 document.querySelector('#result')!.textContent=JSON.stringify(window.pulsoLrclib);
}
void main().catch(()=>{window.pulsoLrclib={passed:false,results};});
