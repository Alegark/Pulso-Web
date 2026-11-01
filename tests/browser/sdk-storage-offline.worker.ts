// All bytes, account labels and session-like records are SYNTHETIC test fixtures.
// This trusted test driver owns ONLY storage; verified-user is fabricated, never SDK auth.
import {IndexedAuthScopeStore,CONTROL_DB,sessionDatabase} from '../../src/telegram/auth-scope-store';
import {AuthCoordinator,bindAuthPort,type OfflineAuthDriver} from '../../src/telegram/auth-state';
import type {AuthScope} from '../../src/telegram/auth-protocol';
import type {IdbStorage as Storage} from '@mtcute/web';
const env=globalThis as unknown as {fetch:typeof fetch;WebSocket:typeof WebSocket;onmessage:((e:MessageEvent)=>void)|null;postMessage:(v:unknown)=>void;addEventListener:typeof addEventListener};
let networkAttempts=0,unhandled=0;
env.fetch=(()=>{networkAttempts++;return Promise.reject(Error('network-disabled'));}) as typeof fetch;
env.WebSocket=class {constructor(){networkAttempts++;throw Error('network-disabled');}} as unknown as typeof WebSocket;
env.addEventListener('unhandledrejection',e=>{unhandled++;e.preventDefault();});
const id=()=>crypto.randomUUID();
const scope=():AuthScope=>({sessionSlotId:id(),namespaceId:null,accountId:null,generation:id(),ownerId:id()});
function check(v:unknown,label:string):asserts v {if(!v)throw Error(label);}
const req=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('idb-request'));});
const delay=(ms=20)=>new Promise<void>(r=>setTimeout(r,ms));
async function until(fn:()=>boolean|Promise<boolean>,label:string){for(let n=0;n<150;n++){if(await fn())return;await delay();}throw Error(label);}
const equal=(a:Uint8Array|null,b:Uint8Array)=>a!==null&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const seed=(tag:number)=>Uint8Array.from({length:64},(_,i)=>(i*17+tag)%256);
const key='synthetic-session-fixture';
const canaryName='pulso-web:r9:synthetic-local-canary';
type Row={scope:AuthScope;tombstone:boolean;deleted:boolean;deletion?:string};
async function row(s:AuthScope):Promise<Row>{const db=await req(indexedDB.open(CONTROL_DB));try{return await req(db.transaction('slots').objectStore('slots').get(s.sessionSlotId));}finally{db.close();}}
async function raw(name:string){const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('fixture');return req(r);}
async function put(db:IDBDatabase){const tx=db.transaction('fixture','readwrite');tx.objectStore('fixture').put(seed(93),'canary');await new Promise<void>((a,b)=>{tx.oncomplete=()=>a();tx.onabort=()=>b(Error('fixture-abort'));});}
function live(db:IDBDatabase){try{db.transaction(db.objectStoreNames[0]);return true;}catch(e){check(e instanceof DOMException&&e.name==='InvalidStateError','closed-error-family');return false;}}
function command(c:AuthCoordinator,type:string,extra:object={}){return {version:1,requestId:id(),operationId:id(),scope:c.snapshot().scope,type,...extra};}
async function run(){
 const cases:string[]=[],observations:Record<string,unknown>={},opened:IDBDatabase[]=[];
 const allowed=new Set([CONTROL_DB,canaryName]),completedDeletes=new Set<string>(),idbErrors:string[]=[];let deletes=0,opens=0;
 const nativeOpen=IDBFactory.prototype.open,nativeDelete=IDBFactory.prototype.deleteDatabase;
 IDBFactory.prototype.open=function(name:string,version?:number){check(allowed.has(name),'unregistered-database-name');opens++;const r=version===undefined?nativeOpen.call(this,name):nativeOpen.call(this,name,version);r.addEventListener('success',()=>opened.push(r.result));r.addEventListener('error',()=>idbErrors.push(r.error?.name??'unknown'));return r;};
 IDBFactory.prototype.deleteDatabase=function(name:string){check(allowed.has(name)&&name.startsWith('pulso-web:telegram:session:v1:'),'delete-exact-session-only');deletes++;const r=nativeDelete.call(this,name);r.addEventListener('success',()=>completedDeletes.add(name));return r;};
 // The public package is dynamically imported AFTER network instrumentation.
 const {IdbStorage}=await import('@mtcute/web');
 const store=new IndexedAuthScopeStore(indexedDB);
 const register=async()=>{const s=scope();await store.register(s,()=>true);check((await row(s)).scope.sessionSlotId===s.sessionSlotId,'register-before-create');allowed.add(sessionDatabase(s.sessionSlotId));return s;};
 const make=async()=>{const s=await register(),before=opens,storage=new IdbStorage(sessionDatabase(s.sessionSlotId));check(opens===before,'constructor-does-not-open');return {s,storage};};
 const load=async(storage:Storage)=>{await storage.driver.load();check(storage.driver.db.name===storage.dbName,'exact-db-name');};
 const write=async(storage:Storage,tag:number)=>{storage.kv.set(key,seed(tag));await storage.authKeys.set(2,seed(tag+1));await storage.driver.save();};
 const verify=async(storage:Storage,tag:number)=>{check(equal(await storage.kv.get(key),seed(tag)),'synthetic-kv-match');check(equal(await storage.authKeys.get(2),seed(tag+1)),'synthetic-auth-key-match');};
 // Serialization policy for THIS TEST ADAPTER: one load; close waits for it, saves, destroys.
 // No client/platform/crypto setup; the IDB storage path does not require setup(log,platform).
 const adapter=(s:AuthScope,tag:number,gate?:Promise<void>,failFirst=false)=>{
  let storage:Storage|undefined,loading:Promise<void>|undefined,closing:Promise<void>|undefined,closed=false,calls=0;
  const driver:OfflineAuthDriver={
   begin:async()=>{
    check(!closed&&!loading,'adapter-no-readmission');
    loading=(async()=>{check(!(await row(s)).tombstone,'adapter-registered');if(closed)return;storage=new IdbStorage(sessionDatabase(s.sessionSlotId));await load(storage);if(!closed)await write(storage,tag);})();
    await loading;return {kind:'verified-user',accountId:'900001',isBot:false};
   },
   code:async()=>{throw Error('synthetic-method-unused');},password:async()=>{throw Error('synthetic-method-unused');},
   close:()=>{
    closed=true;if(closing)return closing;
    closing=(async()=>{calls++;await gate;if(failFirst&&calls===1)throw Error('synthetic-close-failure');await loading;if(storage){try{await storage.driver.save();}finally{await storage.driver.destroy();}}})();
    void closing.catch(()=>{closing=undefined;});return closing;
   }
  };
  return {driver,get storage(){return storage!;},get calls(){return calls;}};
 };
 try{
  const a=await make(),b=await make();const before=opens;
  check(typeof (a.storage as unknown as {close?:unknown}).close==='undefined','storage-no-close-method');
  check(opens===before,'constructor-does-not-open');
  await load(a.storage);await load(b.storage);await write(a.storage,11);await write(b.storage,27);
  const boundA=await store.bind(a.s,'900011',id(),()=>true),boundB=await store.bind(b.s,'900027',id(),()=>true);
  check(boundA.namespaceId!==boundB.namespaceId,'distinct-synthetic-bindings');
  check(a.storage.driver.db.version===a.storage.driver.calculateVersion(),'schema-version');
  observations.schema={version:a.storage.driver.db.version,stores:Array.from(a.storage.driver.db.objectStoreNames)};
  await a.storage.driver.destroy();await a.storage.driver.destroy();await b.storage.driver.destroy();
  check(!live(a.storage.driver.db)&&!live(b.storage.driver.db)&&deletes===0,'destroy-closes-not-deletes');
  const ar=new IdbStorage(a.storage.dbName),br=new IdbStorage(b.storage.dbName);await load(ar);await load(br);await verify(ar,11);await verify(br,27);
  const local=await raw(canaryName);await put(local);
  cases.push('registered exact UUID slots A/B; SDK synthetic kv/authKeys save, destroy and reopen; distinct synthetic account/namespace bindings; no deletion on close');

  const split=await make();await load(split.storage);split.storage.kv.set(key,seed(31));await split.storage.authKeys.set(2,seed(32));
  check(await split.storage.kv.get(key)===null,'kv-buffered-before-save');check(equal(await split.storage.authKeys.get(2),seed(32)),'authKeys-direct-transaction');
  await split.storage.driver.save();await verify(split.storage,31);
  split.storage.kv.set(key,seed(33));await split.storage.driver.destroy();
  const splitReopen=new IdbStorage(split.storage.dbName);await load(splitReopen);await verify(splitReopen,31);await splitReopen.driver.destroy();
  cases.push('split repositories: kv buffered until save; authKeys uses independent transaction; destroy does not flush queued kv');

  const abort=await make();await load(abort.storage);abort.storage.kv.set(key,seed(44));
  const nativePut=IDBObjectStore.prototype.put;let sawAbort=false;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const r=nativePut.apply(this,args);if(this.transaction.db.name===abort.storage.dbName){const tx=this.transaction;tx.addEventListener('abort',()=>sawAbort=true);r.addEventListener('success',()=>tx.abort());}return r;};
  let saveSettled=false;const abortedSave=Promise.resolve(abort.storage.driver.save()).then(()=>saveSettled=true,()=>saveSettled=true);
  await until(()=>sawAbort,'native-transaction-aborted');IDBObjectStore.prototype.put=nativePut;await delay(60);
  check(!saveSettled,'sdk-save-abort-remains-pending');await abort.storage.driver.save();check(await abort.storage.kv.get(key)===null,'drained-queue-not-replayed');await abort.storage.driver.destroy();void abortedSave;
  observations.transactionAbort={nativeAbort:true,saveSettledDuring60ms:false,secondSaveReplayed:false};
  cases.push('controlled native transaction.abort: SDK save promise remains pending (no onabort handler); buffered batch already drained; second save does not replay');

  const ref=await make();await load(ref.storage);await ref.storage.driver.load();await ref.storage.driver.destroy();check(live(ref.storage.driver.db),'one-destroy-retains-second-load');await ref.storage.driver.destroy();check(!live(ref.storage.driver.db),'balanced-destroy-closes');
  cases.push('sequential driver.load reference counting: two loads require two destroys; wrapper must own one load');

  const concurrent=await make();await Promise.all([concurrent.storage.driver.load(),concurrent.storage.driver.load()]);
  const concurrentDBs=opened.filter(db=>db.name===concurrent.storage.dbName);check(concurrentDBs.length===2,'concurrent-load-two-connections');
  await concurrent.storage.driver.destroy();await concurrent.storage.driver.destroy();
  check(concurrentDBs.filter(live).length===1,'concurrent-load-orphan-connection');for(const db of concurrentDBs)db.close();
  observations.concurrentLoad={successfulConnections:2,liveAfterTwoDestroys:1,orphanManuallyClosed:true};
  cases.push('raw concurrent SDK loads open two native connections; balanced destroys close only driver.db; captured orphan closed by test fixture');

  // Real blocked open, then premature SDK destroy. No synthetic completion callback.
  const race=await make(),blocker=await raw(race.storage.dbName);let blocked=false;
  const onOpen=IDBFactory.prototype.open;
  IDBFactory.prototype.open=function(...args:Parameters<IDBFactory['open']>){const r=onOpen.apply(this,args);if(args[0]===race.storage.dbName)r.addEventListener('blocked',()=>blocked=true);return r;};
  const raceLoad=race.storage.driver.load();await until(()=>blocked,'sdk-load-blocked');await race.storage.driver.destroy();blocker.close();await raceLoad;await race.storage.driver.destroy();
  check(live(race.storage.driver.db),'premature-destroy-does-not-release-late-db');race.storage.driver.db.close();IDBFactory.prototype.open=onOpen;
  observations.prematureDestroy={blockedOpen:true,destroyResolvedBeforeLoad:true,dbLiveAfterLateLoadAndSecondDestroy:true,testFixtureManuallyClosed:true};
  cases.push('SDK raw premature destroy repro: blocked load + destroy + late load + destroy leaves live DB; explicit fixture close required');

  for(const mode of ['direct','stop','malformed','retry']){
   const s=await register();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
   const d=adapter(s,51,gate,mode==='retry'),c=new AuthCoordinator(s,store,d.driver);
   await c.handle(command(c,'begin-phone',{phone:'synthetic-input'}));check(c.snapshot().phase==='ready','synthetic-ready');
   const original=c.snapshot(),beforeRow=JSON.stringify(await row(s));const beforeDeletes:number=deletes;
   const channel=new MessageChannel(),replies:unknown[]=[];channel.port1.onmessage=e=>replies.push(e.data);channel.port1.start();const stop=bindAuthPort(channel.port2,c);
   if(mode==='direct')c.close();else if(mode==='malformed'){channel.port1.postMessage({version:0});await until(()=>c.snapshot().phase==='cancelled','malformed-stop');}else stop();
   check(c.snapshot().phase==='cancelled'&&c.snapshot().remote==='unavailable'&&c.snapshot().scope.generation!==original.scope.generation,'synchronous-invalidation');
   const closing=c.close();check(closing===c.close()&&closing===c.retryClose(),'shared-close');let settled=false;void closing.then(()=>settled=true);await delay();check(!settled&&live(d.storage.driver.db),'pending-close-honest');
   release();if(mode==='retry'){check(await closing===false&&live(d.storage.driver.db),'close-failure-real-db-live');check(await c.close()===false,'cached-close-failure');check(await c.retryClose(),'explicit-retry');}else check(await closing,'close-confirmed');
   await stop();check(!live(d.storage.driver.db)&&d.calls===(mode==='retry'?2:1),'sdk-resource-closed');
   check(JSON.stringify(await row(s))===beforeRow&&deletes===beforeDeletes,'no-close-journal-delete');check(await c.handle(command(c,'status'))===null,'no-readmission');
   channel.port1.postMessage(command(c,'status'));await delay();check(replies.length===0,'no-closed-port-replies');channel.port1.close();
   const reopened=new IdbStorage(sessionDatabase(s.sessionSlotId));await load(reopened);await verify(reopened,51);await reopened.driver.destroy();
   cases.push('storage-only synthetic trusted driver: '+mode+' invalidates capability, waits for real SDK destroy, preserves DB/journal; no auth');
  }
  // A real SDK save that never settles prevents the naive save-then-destroy adapter close.
  // This is a reproduced limitation, NOT a successful close; no auth source is changed.
  const hangScope=await register(),hd=adapter(hangScope,58),hc=new AuthCoordinator(hangScope,store,hd.driver);
  await hc.handle(command(hc,'begin-phone',{phone:'synthetic-input'}));hd.storage.kv.set(key,seed(59));let closeAbort=false;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const r=nativePut.apply(this,args);if(this.transaction.db.name===hd.storage.dbName){const tx=this.transaction;tx.addEventListener('abort',()=>closeAbort=true);r.addEventListener('success',()=>tx.abort());}return r;};
  let hangSettled=false;const hangingClose=hc.close();void hangingClose.then(()=>hangSettled=true);
  await until(()=>closeAbort,'close-native-save-abort');IDBObjectStore.prototype.put=nativePut;await delay(60);
  check(!hangSettled&&live(hd.storage.driver.db)&&hc.snapshot().phase==='cancelled','save-hang-blocks-adapter-resource-close');check(hc.retryClose()===hangingClose,'hang-no-overlapping-retry');
  hd.storage.driver.db.close();check(!live(hd.storage.driver.db)&&!hangSettled,'manual-fixture-close-is-not-adapter-success');
  observations.adapterSaveHang={nativeAbort:true,capabilityInvalidated:true,closeSettledDuring60ms:false,dbLiveUntilManualFixtureClose:true,retrySharesPending:true};
  cases.push('concrete adapter blocker: native SDK save abort leaves close pending and DB live; retry shares pending; test closes captured DB manually without claiming close success');

  // Adapter fix for the raw race: wait for its ONE pending load before destroying.
  const late=await register(),lateBlocker=await raw(sessionDatabase(late.sessionSlotId));let lateBlocked=false;
  IDBFactory.prototype.open=function(...args:Parameters<IDBFactory['open']>){const r=onOpen.apply(this,args);if(args[0]===sessionDatabase(late.sessionSlotId))r.addEventListener('blocked',()=>lateBlocked=true);return r;};
  const ld=adapter(late,61),lc=new AuthCoordinator(late,store,ld.driver);const beginning=lc.handle(command(lc,'begin-phone',{phone:'synthetic-input'}));
  await until(()=>lateBlocked,'adapter-load-blocked');let lateCloseSettled=false;const lateClose=lc.close();void lateClose.then(()=>lateCloseSettled=true);await delay();check(!lateCloseSettled,'adapter-close-waits-load');
  lateBlocker.close();check(await lateClose&&await beginning===null,'adapter-late-close-confirmed');check(!live(ld.storage.driver.db),'adapter-late-resource-closed');
  check((await row(late)).scope.accountId===null&&!((await row(late)).tombstone),'no-late-binding');IDBFactory.prototype.open=onOpen;
  cases.push('test adapter correction: close waits real blocked SDK load, late completion is destroyed and cannot bind synthetic identity');

  // A itself deliberately keeps its SDK connection open, blocking its own authorized cleanup.
  const deleteBefore=deletes;await store.tombstone(boundA);check((await row(boundA)).tombstone,'durable-tombstone');
  check(await store.cleanup(boundA)===false,'real-sdk-connection-blocks-delete');
  check((await row(boundA)).deletion==='pending'&&!(await row(boundA)).deleted,'pending-after-blocked');
  observations.cleanupJournal={blocked:{tombstone:(await row(boundA)).tombstone,deletion:(await row(boundA)).deletion,deleted:(await row(boundA)).deleted}};
  check(await store.cleanup(boundA)===false&&deletes===deleteBefore+1,'no-second-pending-delete');
  check(live(ar.driver.db),'sdk-no-auto-versionchange-close');await ar.driver.destroy();
  await until(async()=>(await row(boundA)).deletion==='completed','late-journal-completed');check((await row(boundA)).deleted,'late-journal-deleted');check(completedDeletes.has(ar.dbName),'native-delete-success-observed');
  observations.cleanupJournal={blocked:{tombstone:true,deletion:'pending',deleted:false},afterNativeCallback:{tombstone:(await row(boundA)).tombstone,deletion:(await row(boundA)).deletion,deleted:(await row(boundA)).deleted}};
  const recreated=await raw(ar.dbName);await put(recreated);check(await store.cleanup(boundA)&&deletes===deleteBefore+1,'completed-no-redelete');
  check(equal(await req(recreated.transaction('fixture').objectStore('fixture').get('canary')),seed(93)),'recreated-preserved');recreated.close();
  await verify(br,27);const rb=await row(boundB);check(!rb.tombstone&&rb.scope.namespaceId===boundB.namespaceId,'B-binding-preserved');
  check(equal(await req(local.transaction('fixture').objectStore('fixture').get('canary')),seed(93)),'local-canary-preserved');local.close();await br.driver.destroy();
  cases.push('native blocked delete by real SDK connection; permanent tombstone and pending before close; SDK destroy permits late completed journal; exact cleanup preserves B/local/recreated canary');

  // Last: a REAL VersionError on final control write, then repair ONLY the test factory routing.
  const uncertain=await make();await load(uncertain.storage);await write(uncertain.storage,71);await store.tombstone(uncertain.s);
  const deletionCount=deletes;check(await store.cleanup(uncertain.s)===false,'uncertain-blocked');
  const upgraded=await req(indexedDB.open(CONTROL_DB,2));upgraded.close();await uncertain.storage.driver.destroy();await until(()=>completedDeletes.has(uncertain.storage.dbName)&&idbErrors.includes('VersionError'),'native-late-delete-and-journal-VersionError-observed');
  check((await row(uncertain.s)).deletion==='pending'&&!(await row(uncertain.s)).deleted,'uncertain-native-VersionError-retains-pending');
  const controlFactory={open:(n:string,v?:number)=>indexedDB.open(n,n===CONTROL_DB&&v===1?2:v),deleteDatabase:(n:string)=>indexedDB.deleteDatabase(n)} as IDBFactory;
  const repaired=new IndexedAuthScopeStore(controlFactory),uncertainRecreated=await raw(uncertain.storage.dbName);await put(uncertainRecreated);
  check(await repaired.cleanup(uncertain.s)===false&&deletes===deletionCount+1,'uncertain-no-redelete-after-factory-repair');
  check(equal(await req(uncertainRecreated.transaction('fixture').objectStore('fixture').get('canary')),seed(93)),'uncertain-recreated-preserved');uncertainRecreated.close();
  observations.uncertainJournal={cause:'real control DB version upgrade 1 to 2 before native late deletion callback; fixed store open(1) fails with VersionError',repair:'test-only factory maps control open(1) to version 2; schema unchanged',nativeDeleteSuccessObserved:completedDeletes.has(uncertain.storage.dbName),nativeErrorObserved:idbErrors.includes('VersionError'),deletion:(await row(uncertain.s)).deletion,reissued:false};
  cases.push('real late delete plus real final-journal VersionError: durable pending survives callback and store reopen; repaired test factory cannot re-delete recreated canary');
  await delay();check(networkAttempts===0&&unhandled===0,'network-unhandled-zero');
  return {passed:true,cases,observations,workerNetworkAttempts:networkAttempts,unhandled,deleteRequests:deletes,SDK:'@mtcute/web 0.32.7 public IdbStorage',syntheticAuthDriver:true,realAuth:false};
 }finally{for(const db of opened)db.close();IDBFactory.prototype.open=nativeOpen;IDBFactory.prototype.deleteDatabase=nativeDelete;}
}
env.onmessage=()=>{env.onmessage=null;void run().then(result=>env.postMessage(result)).catch(error=>env.postMessage({passed:false,failure:error instanceof Error?error.message:'worker-failure',workerNetworkAttempts:networkAttempts,unhandled}));};
