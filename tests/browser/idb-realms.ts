import {DATABASE,openDatabase,closeDatabase,request,committed,registerDatabaseOpenGuard,subscribeDatabaseLifecycle,registerDatabaseAdmissionPolicy,revalidateDatabaseRealm,assertDatabaseUse,readRecord,registerDatabaseUseGuard} from '../../src/storage/database';
import {beginWorkerAttempt,activeDatabaseWorkerAttempts,registerDatabaseRealmHost,revokeDatabaseWorkerAttempts,type RealmAttempt,type RealmKind} from '../../src/storage/database-realms';
import {importFileDetailed} from '../../src/imports/import-file';
import {importOperations,recoverImportOperationDetailed,cleanupOperation,updateOperation} from '../../src/storage/import-operations';
import {storeEmbeddedArtwork} from '../../src/library/artwork';
import {storeEmbeddedLyrics} from '../../src/library/lyrics';
import {runCopyWorker} from '../../src/library/local-copy-client';
import {createLocalBatch,runLocalBatch,readLocalBatch} from '../../src/library/local-batches';
import {createPlaylist,changePlaylist} from '../../src/library/library';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean){for(let n=0;n<250;n++){if(check())return;await pause();}throw Error('barrier timeout');}
export function wav():File {
 const raw=new Uint8Array(200044),d=new DataView(raw.buffer),text=(at:number,s:string)=>{for(let i=0;i<s.length;i++)raw[at+i]=s.charCodeAt(i);};
 text(0,'RIFF');d.setUint32(4,raw.length-8,true);text(8,'WAVEfmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,16000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);text(36,'data');d.setUint32(40,raw.length-44,true);return new File([raw],'synthetic.wav',{type:'audio/wav'});
}
async function seed(version:number){const r=indexedDB.open(DATABASE,version);r.onupgradeneeded=()=>{for(const name of ['assets','chunks','jobs','settings','tracks','playlists','extra-canary',...(version>=2?['tickets']:[])])r.result.createObjectStore(name);r.transaction!.objectStore('settings').put('kept','canary');r.transaction!.objectStore('extra-canary').put('extra','canary');};const db=await request(r);return db;}
async function inspect(){const r=indexedDB.open(DATABASE);let absent=false;r.onupgradeneeded=()=>{absent=true;r.transaction!.abort();};try{const db=await request(r);const version=db.version,names=[...db.objectStoreNames];const tx=db.transaction('settings'),done=committed(tx),canary=await request(tx.objectStore('settings').get('canary'));await done;db.close();return {absent:false,version,names,canary};}catch{if(!absent)throw Error('inspection failed');return {absent:true};}}
const makeWorker=(kind:RealmKind)=>{
 switch(kind){case 'import':return new Worker(new URL('../../src/imports/import.worker.ts',import.meta.url),{type:'module'});case 'recovery':return new Worker(new URL('../../src/imports/recovery.worker.ts',import.meta.url),{type:'module'});case 'batch':return new Worker(new URL('../../src/imports/local-batch.worker.ts',import.meta.url),{type:'module'});case 'copies':return new Worker(new URL('../../src/imports/local-copy.worker.ts',import.meta.url),{type:'module'});}
};
const domain=(kind:RealmKind)=>{const id=crypto.randomUUID();return kind==='import'?{version:2,type:'import',operationId:id,file:wav()}:kind==='recovery'?{version:2,type:'recover',requestId:id,operationId:crypto.randomUUID(),revision:1,action:'resume'}:kind==='batch'?{version:2,type:'start',requestId:id,jobId:crypto.randomUUID(),expectedRevision:1}:{version:1,type:'inventory',requestId:id,token:crypto.randomUUID()};};
function hostFixture(){let ends=0,begins=0,current=true;const states:string[]=[];const unregister=registerDatabaseRealmHost({capture:(_kind,caller)=>{begins++;return {current:()=>current&&caller(),onLifecycle:s=>states.push(s),end:()=>{ends++;}};},onLifecycle:s=>states.push(s)});return {states,get ends(){return ends;},get begins(){return begins;},invalidate(){current=false;},close:unregister};}
async function realWorker(kind:RealmKind,send=domain(kind)){
 const h=hostFixture(),w=makeWorker(kind),messages:any[]=[];let realm:RealmAttempt|undefined;
 try{w.onmessage=e=>messages.push(e.data);realm=await beginWorkerAttempt(kind,w,()=>true);w.postMessage(send);await until(()=>messages.some(m=>['error','complete','done','failure','inventory','verified'].includes(m.type)));await pause();return {messages,states:[...h.states],current:realm.current()};}
 finally{w.terminate();realm?.closeAfterSettlement();h.close();assert(h.ends===h.begins,'resource released once');assert(activeDatabaseWorkerAttempts()===0,'no live attempts');}
}
async function run(name:string){
 const facts:Record<string,unknown>={};
 if(name.startsWith('schema-')){
  const [,kind,version]=name.split('-') as [string,RealmKind,string];if(version!=='absent'){const db=await seed(Number(version));db.close();}
  const result=await realWorker(kind);facts.result=result;facts.database=await inspect();
  if(version==='absent')assert((facts.database as any).absent,'worker created schema');
  else{assert((facts.database as any).version===Number(version),'schema changed');assert((facts.database as any).canary==='kept','canary lost');}
  assert(!result.current,'closed attempt still current');
  if(version==='3')assert(result.states.includes('version-incompatible'),'future anomaly missing');
  assert(!result.messages.some(m=>m.type==='complete'||m.type==='done'||m.type==='inventory'),'no false domain success');
 }else if(name.startsWith('retry-')){
  const kind=name.slice(6) as RealmKind;const denied=await realWorker(kind);assert(!denied.current,'absent worker stayed admitted');const db=await openDatabase();closeDatabase(db);const after=await realWorker(kind);facts.after=after;assert(after.current,'fresh schema-ready worker denied');assert(kind==='import'?after.messages.some(m=>m.type==='complete'):kind==='copies'?after.messages.some(m=>m.type==='inventory'):after.messages.some(m=>m.type==='error'),'domain after explicit DOM initialization');
 }else if(name.startsWith('ack-')){
  const backend=name.endsWith('opfs')?'opfs':'idb';const result=await importFileDetailed(wav(),new AbortController().signal,()=>{},{backend});assert(result.kind==='confirmed','seed');const asset=await readRecord<any>('assets',result.result.track.assetId),h=hostFixture(),w=makeWorker('copies'),requestId=crypto.randomUUID(),token=crypto.randomUUID();let realm:RealmAttempt|undefined;const messages:any[]=[];let materialized=false,offset=0;let stage='materialize';
  try{w.onmessage=e=>{const m=e.data;messages.push(m);if(m.type==='start')w.postMessage({version:1,type:'credit',requestId,token,offset});if(m.type==='chunk'){offset+=m.buffer.byteLength;w.postMessage({version:1,type:'credit',requestId,token,offset});}if(m.type==='materialize')materialized=true;};realm=await beginWorkerAttempt('copies',w,()=>true);w.postMessage({version:1,type:'export',requestId,token,asset});await until(()=>materialized);stage='versionchange';const upgraded=await request(indexedDB.open(DATABASE,3));upgraded.close();await until(()=>h.states.includes('versionchange'));assert(!realm.current(),'lifecycle missing');stage='terminal-after-ack';w.postMessage({version:1,type:'ack',requestId,token,offset});await until(()=>messages.some(m=>m.type==='failure'));assert(!messages.some(m=>m.type==='ready'),'late ACK published ready');facts.messages=messages.map(m=>({type:m.type,failure:m.failure}));facts.states=h.states;
  }catch(error){throw Error('ACK '+stage+' '+JSON.stringify({types:messages.map(m=>m.type),states:h.states,error:String(error)}));}finally{w.terminate();realm?.closeAfterSettlement();h.close();assert(h.ends===h.begins,'ack release once');}
 }else if(name==='prebind'){
  for(const kind of ['import','recovery','batch','copies'] as RealmKind[]){const w=makeWorker(kind),messages:any[]=[];try{w.onmessage=e=>messages.push(e.data);w.postMessage(domain(kind));await pause(100);facts[kind]=messages;}finally{w.terminate();}}
  assert((await inspect()).absent,'prebind mutated schema');
 }else if(name==='blocked-retry'){
  const blocker=await seed(1),h=hostFixture(),w=makeWorker('import');let realm:RealmAttempt|undefined;let ready=true;const states:string[]=[];
  const remove=registerDatabaseOpenGuard(()=>ready);const unsub=subscribeDatabaseLifecycle(s=>{states.push(s);ready=false;});
  try{realm=await beginWorkerAttempt('import',w,()=>true);const messages:any[]=[];w.onmessage=e=>messages.push(e.data);w.postMessage(domain('import'));const first=openDatabase().catch(()=>null),queued=openDatabase().catch(()=>null);await until(()=>states.includes('blocked'));blocker.close();await Promise.all([first,queued]);await until(()=>messages.some(m=>m.type==='error'));await pause(50);assert((await inspect()).version===1,'late queued migration');ready=true;const db=await openDatabase();assert(db.version===2,'explicit root retry failed');closeDatabase(db);facts.states=states;facts.workerStates=h.states;facts.database=await inspect();}
  finally{blocker.close();w.terminate();realm?.closeAfterSettlement();h.close();remove();unsub();}
 }else if(['versionchange-tx','commit-winner','abnormal-close','normal-close'].includes(name)){
  const db=await seed(2);db.close();const h=hostFixture(),w=new Worker(new URL('./realm-fixture.ts',import.meta.url),{type:'module'}),messages:any[]=[];let realm:RealmAttempt|undefined;
  try{w.onmessage=e=>messages.push(e.data);realm=await beginWorkerAttempt('import',w,()=>true);
   const cmd=name==='versionchange-tx'?{fixture:'hold',tx:true}:name==='commit-winner'?{fixture:'commit'}:{fixture:name};w.postMessage(cmd);
   if(name==='versionchange-tx'||name==='commit-winner'){
    await until(()=>messages.some(m=>m.fixture===(name==='commit-winner'?'committed':'held')));const upgrade=indexedDB.open(DATABASE,3);const upgraded=await request(upgrade);upgraded.close();await until(()=>h.states.includes('versionchange'));assert(!realm.current(),'attempt not revoked');if(name==='versionchange-tx')await until(()=>messages.some(m=>m.fixture==='tx'));const native=indexedDB.open(DATABASE);const view=await request(native),tx=view.transaction('settings'),done=committed(tx);facts.active=await request(tx.objectStore('settings').get('active-canary'));facts.commit=await request(tx.objectStore('settings').get('commit-canary'));await done;view.close();assert(name==='commit-winner'?facts.commit==='winner':facts.active===undefined,'native terminal not preserved');
   }else{await until(()=>messages.some(m=>m.fixture===(name==='normal-close'?'normal':'closed')));assert(name==='normal-close'?realm.current():!realm.current(),'normal/abnormal close classification');}
   facts.messages=messages;facts.states=h.states;
  }finally{w.terminate();realm?.closeAfterSettlement();h.close();assert(h.ends===1,'end once');}
 }else if(name==='terminal-import'||name==='terminal-recovery'){
  let message:any;let operationId=crypto.randomUUID();
  if(name==='terminal-recovery'){
   let publishing=false;const nativePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='jobs'&&value?.state==='publishing')publishing=true;return nativePut.call(this,value,key!);};const deny=registerDatabaseUseGuard(kind=>kind!=='publish'||!publishing);let staged;
   try{staged=await importFileDetailed(wav(),new AbortController().signal,()=>{},{backend:'idb',operationId});}finally{deny();IDBObjectStore.prototype.put=nativePut;}
   assert(staged.kind==='failed'&&staged.outcome.recoveryRequired,'recovery fixture not uncertain');const job=(await importOperations())[0];assert(job.asset&&job.state==='uncertain','not resumable');message={version:2,type:'recover',requestId:crypto.randomUUID(),operationId,revision:job.revision,action:'resume'};
  }else{const db=await openDatabase();closeDatabase(db);message={version:2,type:'import',operationId,file:wav()};}
  const kind=name==='terminal-import'?'import':'recovery',h=hostFixture(),w=makeWorker(kind);let realm:RealmAttempt|undefined;let held:any=null;
  try{w.onmessage=e=>{if(e.data.type==='complete'||e.data.type==='recovered'||e.data.type==='error')held=e.data;};realm=await beginWorkerAttempt(kind,w,()=>true);w.postMessage(message);await until(()=>!!held);assert(held.type!=='error'&&held.outcome.writeState==='published','native publication not confirmed');const job=(await importOperations()).find(j=>j.operationId===operationId);assert(job?.state==='sealed','not durably sealed');realm.revoke();await pause(40);assert(!realm.current(),'revoke still admitted');const reread=(await importOperations()).find(j=>j.operationId===operationId);assert(JSON.stringify(job)===JSON.stringify(reread),'late lifecycle undid commit');facts.heldOutcome=held.outcome;facts.job=reread?.state;facts.barrier='TESTONLY window withholds domain callback after actual worker native commit; control revoke is cooperative, not native versionchange';
  }finally{w.terminate();realm?.closeAfterSettlement();h.close();assert(h.ends===h.begins,'terminal release once');}
 }else if(name==='metadata-guards'){
  const result=await importFileDetailed(wav(),new AbortController().signal,()=>{},{backend:'idb'});assert(result.kind==='confirmed','seed import');const asset=await readRecord<any>('assets',result.result.track.assetId);const positive=await storeEmbeddedArtwork(result.result.track.id,asset.sha256,async()=>({state:'absent'}));assert(positive.state==='absent','positive optional metadata failed');assert(await readRecord('settings',`artwork:v1:${result.result.track.id}`),'positive metadata not stored');let current=true,release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>{started=r;}),barrier=new Promise<void>(r=>{release=r;});
  const pending=storeEmbeddedArtwork(result.result.track.id,asset.sha256,async()=>{started();await barrier;return {state:'absent'};},()=>current).catch(()=>null);await entered;current=false;release();assert(await pending===null,'stale artwork wrote');
  current=true;let deliveries=0;const remove=registerDatabaseOpenGuard(phase=>{if(phase==='deliver'&&++deliveries===2)current=false;return true;});try{await storeEmbeddedArtwork(result.result.track.id,asset.sha256,async()=>({state:'absent'}),()=>current).then(()=>{throw Error('post-open metadata guard missed');},()=>{});assert(deliveries===2,'post-open barrier not reached');}finally{remove();}
  let extracted=0;const lyrics=await storeEmbeddedLyrics(result.result.track.id,asset.sha256,async()=>{extracted++;return {state:'absent',scope:'riff-id3'};},undefined,()=>false).catch(()=>null);assert(lyrics===null&&extracted===0,'stale lyrics inspected');facts.job=(await importOperations())[0].state;assert(facts.job==='sealed','confirmed audio changed');
 }else if(name==='cleanup-recovery-guards'){
  const file=wav(),signal=new AbortController();const result=await importFileDetailed(file,signal.signal,()=>{throw Error('TESTONLY transport uncertain');},{backend:'idb'});assert(result.kind==='failed'&&result.outcome.recoveryRequired,'uncertain import');const [job]=await importOperations();assert(job&&!['sealed','discarded'].includes(job.state),'job not durable');let clean=job;if(job.state!=='cleanup')clean=await updateOperation(job,{state:'cleanup'});const old=JSON.stringify(clean);await cleanupOperation(clean,()=>false).then(()=>{throw Error('guard permitted cleanup');},()=>{});assert(JSON.stringify((await importOperations())[0])===old,'cleanup changed job');const recovery=await recoverImportOperationDetailed(clean.operationId,clean.revision,'discard',()=>false);assert(recovery.kind==='failed','guard permitted recovery');assert(JSON.stringify((await importOperations())[0])===old,'recovery wrote');facts.outcome=recovery.outcome;
 }else if(name.startsWith('copies-')){
  const backend=name.endsWith('opfs')?'opfs':'idb';const result=await importFileDetailed(wav(),new AbortController().signal,()=>{},{backend});assert(result.kind==='confirmed','seed');const asset=await readRecord<any>('assets',result.result.track.assetId),h=hostFixture();
  try{const output=await runCopyWorker('export',asset,{current:()=>true,signal:new AbortController().signal});assert(output.kind==='export','export');assert(output.blob.size===asset.bytes,'materialize length');assert(new Uint8Array(await output.blob.arrayBuffer())[0]===82,'materialize bytes');facts.bytes=output.blob.size;}finally{h.close();assert(h.ends===h.begins,'copies release');}
 }else if(name==='batch-revoke'){
  const result=await importFileDetailed(wav(),new AbortController().signal,()=>{},{backend:'idb'});assert(result.kind==='confirmed','seed');const p=await createPlaylist('synthetic');await changePlaylist(p.id,p.revision,{type:'add',trackId:result.result.track.id});const batch=await createLocalBatch(p.id,p.revision+1),h=hostFixture();
  try{const outcome=await runLocalBatch(batch.id,new AbortController().signal,()=>{revokeDatabaseWorkerAttempts();}).then(v=>({confirmed:true,state:v.state}),e=>({confirmed:false,error:String(e)}));facts.outcome=outcome;facts.journal=await readLocalBatch(batch.id);assert((facts.journal as any).state==='verifying','revocation rewrote uncertain batch');}finally{h.close();assert(h.ends===h.begins,'batch release');}
 }else if(name==='revalidate'){
  let retry=false;const unsub=registerDatabaseAdmissionPolicy({open:p=>p!=='upgrade',use:()=>true,revalidate:()=>retry});const db=await seed(2);db.close();const delivered=await openDatabase();delivered.dispatchEvent(new Event('close')); // INJECTION abnormal-close event only.
  let denied=false;try{assertDatabaseUse('read');}catch{denied=true;}assert(denied,'no local latch');await revalidateDatabaseRealm().then(()=>{throw Error('unpermitted retry');},()=>{});retry=true;await revalidateDatabaseRealm();assertDatabaseUse('read');unsub();facts.revalidated=true;
 }else if(name==='rollback'){
  const old=await seed(1);old.close();
  // TESTONLY native migration abort is driven by the upgrade guard via a native
  // event listener, without changing the production migrator.
  const original=IDBFactory.prototype.open;
  IDBFactory.prototype.open=function(...args:Parameters<IDBFactory['open']>){const r=Reflect.apply(original,this,args) as IDBOpenDBRequest;r.addEventListener('upgradeneeded',()=>{r.transaction!.objectStore('settings').put('tentative','rollback-canary');r.transaction!.abort();});return r;};
  try{await openDatabase().then(()=>{throw Error('upgrade succeeded');},()=>{});}finally{IDBFactory.prototype.open=original;}
  const before=await inspect();assert(before.version===1&&before.canary==='kept','rollback lost v1');const next=await openDatabase();assert(next.version===2&&next.objectStoreNames.contains('extra-canary'),'additive retry');closeDatabase(next);facts.before=before;
 }else throw Error('unknown case '+name);
 assert(activeDatabaseWorkerAttempts()===0,'live attempt leaked');return {name,passed:true,facts};
}
(globalThis as any).idbRealms={run};
