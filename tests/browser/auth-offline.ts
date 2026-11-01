import {AuthCoordinator,bindAuthPort,type OfflineAuthDriver} from '../../src/telegram/auth-state';
import {parseReply,type AuthCommand,type AuthReply,type AuthScope} from '../../src/telegram/auth-protocol';
import {CONTROL_DB,IndexedAuthScopeStore,sessionDatabase} from '../../src/telegram/auth-scope-store';
const check=(value:unknown,label:string)=>{if(!value)throw new Error(label);};
const id=()=>crypto.randomUUID();
const scope=():AuthScope=>({sessionSlotId:id(),ownerId:id(),generation:id(),accountId:null,namespaceId:null});
const pause=()=>new Promise(r=>setTimeout(r,60));
function open(name:string):Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('fixture');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('fixture-open'));});}
function request<T>(r:IDBRequest<T>):Promise<T>{return new Promise((a,b)=>{r.onsuccess=()=>a(r.result);r.onerror=()=>b(Error('fixture-read'));});}
function cmd(s:AuthScope,type:string,extra:object={},operationId=id()){return {version:1,requestId:id(),operationId,scope:s,type,...extra};}
async function run(){
 const cases:string[]=[],replies:unknown[]=[],workers:Worker[]=[];let attempts=0;
 const nativeFetch=fetch;window.fetch=((...args:Parameters<typeof fetch>)=>{attempts++;return Promise.reject(Error('network-blocked'));}) as typeof fetch;
 window.WebSocket=class {constructor(){attempts++;throw Error('network-blocked');}} as unknown as typeof WebSocket;
 const start=(s:AuthScope)=>{const worker=new Worker(new URL('./auth-offline.worker.ts',import.meta.url),{type:'module'}),channel=new MessageChannel(),messages:AuthReply[]=[];workers.push(worker);channel.port1.onmessage=e=>{replies.push(e.data);messages.push(e.data);};channel.port1.start();worker.postMessage({scope:s},[channel.port2]);return {worker,port:channel.port1,messages};};
 const send=async(h:ReturnType<typeof start>,c:ReturnType<typeof cmd>,phase?:string)=>{
  h.port.postMessage(c);const until=performance.now()+5000;
  while(performance.now()<until){const r=h.messages.find(r=>r.requestId===c.requestId&&(phase===undefined||phase==='error'&&r.type==='error'||r.type==='state'&&r.state.phase===phase));if(r){check(parseReply(r,c as AuthCommand),'incoming-parser');return r;}await new Promise(r=>setTimeout(r,5));}throw Error('reply-timeout-'+c.type+'-'+phase);
 };
 try{
  const a=scope(),b=scope();const fixtureA=await open(sessionDatabase(a.sessionSlotId));fixtureA.close();const other=await open(sessionDatabase(b.sessionSlotId));
  const local=await open('pulso-web-local-v1');const tx=local.transaction('fixture','readwrite');tx.objectStore('fixture').put('LOCAL_CANARY','canary');await new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=j;});
  const bStore=new IndexedAuthScopeStore(indexedDB),bNamespace=id();await bStore.register(b,()=>true);await bStore.bind(b,'456789',bNamespace,()=>true);
  const h=start(a),op=id();let r=await send(h,cmd(a,'begin-phone',{phone:'SYNTHETIC_PHONE_CANARY'},op),'waiting-code');check(r.type==='state','challenge');if(r.type!=='state')throw 0;let current=r.state.scope;
  r=await send(h,cmd(current,'submit-code',{code:'SYNTHETIC_CODE_CANARY'},op),'waiting-password');if(r.type!=='state')throw 0;current=r.state.scope;
  r=await send(h,cmd(current,'submit-password',{password:'SYNTHETIC_PASSWORD_CANARY'},op),'ready');if(r.type!=='state')throw 0;current=r.state.scope;
  check(current.accountId==='123456'&&current.namespaceId!==null,'internal-binding');
  const control=await request(indexedDB.open(CONTROL_DB));const row=await request(control.transaction('slots').objectStore('slots').get(a.sessionSlotId));check(row.scope.accountId==='123456'&&row.scope.namespaceId===current.namespaceId,'durable-bind-reopen');control.close();cases.push('real Worker + MessageChannel, synthetic phone/code/password, verified binding and control reopen');
  const second=new MessageChannel();let secondReplies=0;second.port1.onmessage=()=>secondReplies++;h.worker.postMessage({scope:a},[second.port2]);second.port1.postMessage(cmd(a,'status'));await pause();check(secondReplies===0,'second-port');second.port1.close();cases.push('second port cannot replace bound capability');
  const blocker=await open(sessionDatabase(a.sessionSlotId));
  r=await send(h,cmd(current,'disconnect',{mode:'remote-and-local'}),'failed');if(r.type!=='state')throw 0;current=r.state.scope;check(r.state.localSession==='cleanup-pending'&&r.state.revocation==='unconfirmed','blocked-logout');
  const pendingControl=await request(indexedDB.open(CONTROL_DB));const tombstone=await request(pendingControl.transaction('slots').objectStore('slots').get(a.sessionSlotId));check(tombstone.tombstone&&!tombstone.deleted,'durable-tombstone-before-delete');pendingControl.close();
  const denied=await send(h,cmd(current,'begin-phone',{phone:'B'}),'error');check(denied.type==='error','quarantine');blocker.close();await pause();
  r=await send(h,cmd(current,'disconnect',{mode:'local-only'}),'disconnected');check(r.type==='state'&&r.state.localSession==='absent','explicit-retry');
  let aRecreated=false;const ar=indexedDB.open(sessionDatabase(a.sessionSlotId),1);ar.onupgradeneeded=()=>{aRecreated=true;ar.result.createObjectStore('fixture');};const reopened=await request(ar);check(aRecreated,'exact-session-deleted');check(reopened.objectStoreNames.length===1&&reopened.objectStoreNames[0]==='fixture','session-empty-reopen');reopened.close();cases.push('blocked connection, durable tombstone, quarantine and explicit state refresh after late completion');
  check(other.objectStoreNames.contains('fixture'),'other-account-preserved');check(await request(local.transaction('fixture').objectStore('fixture').get('canary'))==='LOCAL_CANARY','local-preserved');other.close();local.close();const bControl=await request(indexedDB.open(CONTROL_DB));const bRow=await request(bControl.transaction('slots').objectStore('slots').get(b.sessionSlotId));check(bRow.scope.accountId==='456789'&&bRow.scope.namespaceId===bNamespace&&!bRow.tombstone,'other-binding-preserved');bControl.close();cases.push('other account session/binding/namespace and local library canary intact');
  const crash=scope(),store=new IndexedAuthScopeStore(indexedDB);await store.register(crash,()=>true);(await open(sessionDatabase(crash.sessionSlotId))).close();await store.tombstone(crash);
  // New store instance after simulated interruption; no session restoration/login.
  check(await new IndexedAuthScopeStore(indexedDB).cleanup(crash),'crash-resume');let recreated=false;const cr=indexedDB.open(sessionDatabase(crash.sessionSlotId));cr.onupgradeneeded=()=>{recreated=true;};const db=await request(cr);check(recreated,'deleted-exact-crash-slot');db.close();cases.push('store instance reopen preserves tombstone; explicit cleanup (no auth/session crash tested)');
  const aborted=scope();await store.register(aborted,()=>true);const controller=new AbortController();const write=store.bind(aborted,'789',id(),()=>!controller.signal.aborted,controller.signal);controller.abort();let rejected=false;try{await write;}catch{rejected=true;}check(rejected,'aborted-bind-rejected');const inspect=await request(indexedDB.open(CONTROL_DB));const untouched=await request(inspect.transaction('slots').objectStore('slots').get(aborted.sessionSlotId));check(untouched.scope.accountId===null,'no-stale-binding-write');inspect.close();cases.push('aborted binding cannot commit an obsolete account');
  for(const malformed of [{...cmd(scope(),'status'),version:0},{...cmd(scope(),'status'),session:'EXFIL_CANARY'}]){
   const s=scope(),m=start(s);m.port.postMessage(malformed);await pause();m.port.postMessage(cmd(s,'status'));await pause();check(m.messages.length===0,'malformed-closes-port');m.port.close();
  }cases.push('incompatible version and malformed secret fields close admission without replies');
  const closed=start(scope());closed.port.close();closed.worker.terminate();cases.push('explicit port.close and worker.terminate only (no peer-loss detection tested)');
  for(const w of workers.filter(w=>w!==closed.worker)){
   const report=await new Promise<{externalAttempts:number}>(resolve=>{w.onmessage=e=>resolve(e.data);w.postMessage({diagnostics:true});});check(report.externalAttempts===0,'worker-zero-network');
  }
  const text=JSON.stringify(replies);for(const marker of ['SYNTHETIC_PHONE_CANARY','SYNTHETIC_CODE_CANARY','SYNTHETIC_PASSWORD_CANARY','SYNTHETIC_HASH_CANARY','EXFIL_CANARY'])check(!text.includes(marker),'reply-secret-canary');check(attempts===0,'page-zero-network');cases.push('zero fetch/WebSocket attempts in page/workers and zero secret canaries in replies');
  return {passed:true,cases,externalAttempts:attempts,workerExternalAttempts:0,secretReplyLeaks:0,realAuth:false,sdkIdbStorage:'PENDING: gate open; own control/session fixture IDB only'};
 }finally{for(const w of workers)w.terminate();window.fetch=nativeFetch;}
}
async function lifecycle(){
 const cases:string[]=[],unhandled:string[]=[];
 const onUnhandled=(e:PromiseRejectionEvent)=>{unhandled.push('rejection');e.preventDefault();};window.addEventListener('unhandledrejection',onUnhandled);
 const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
 const wait=async(fn:()=>boolean)=>{for(let n=0;n<80;n++){if(fn())return;await pause();}throw Error('lifecycle-timeout');};
 let deletes=0;
 const factory={open:(n:string,v?:number)=>indexedDB.open(n,v),deleteDatabase:(n:string)=>{deletes++;return indexedDB.deleteDatabase(n);}} as IDBFactory;
 const store=new IndexedAuthScopeStore(factory);
 const row=async(s:AuthScope)=>{const db=await request(indexedDB.open(CONTROL_DB));try{return await request(db.transaction('slots').objectStore('slots').get(s.sessionSlotId));}finally{db.close();}};
 const canaries:IDBDatabase[]=[];
 for(const name of ['r8-local-canary',sessionDatabase(id())]){const db=await open(name),tx=db.transaction('fixture','readwrite');tx.objectStore('fixture').put('R8_CANARY','canary');await new Promise(r=>tx.oncomplete=r);canaries.push(db);}
 const send=(c:AuthCoordinator,type:string,extra:object={})=>c.handle(cmd(c.snapshot().scope,type,extra));
 try{
  for(const mode of ['direct-close','port-stop','malformed-port','messageerror-port']){
   let alive=false,closes=0;const gate=deferred<void>();
   const driver:OfflineAuthDriver={begin:async()=>{alive=true;return {kind:'verified-user',accountId:'123',isBot:false};},code:async()=>({kind:'password-needed'}),password:async()=>({kind:'password-needed'}),close:async()=>{closes++;await gate.promise;alive=false;}};
   const c=new AuthCoordinator(scope(),store,driver);await send(c,'begin-phone',{phone:'SYNTHETIC_PHONE_CANARY'});check(c.snapshot().phase==='ready','r8-ready');
   const own=c.snapshot().scope,session=await open(sessionDatabase(own.sessionSlotId));const tx=session.transaction('fixture','readwrite');tx.objectStore('fixture').put('SESSION_CANARY','canary');await new Promise(r=>tx.oncomplete=r);
   const beforeRow=JSON.stringify(await row(own)),ch=new MessageChannel(),messages:unknown[]=[];ch.port1.onmessage=e=>messages.push(e.data);const stop=bindAuthPort(ch.port2,c);
   if(mode==='direct-close')c.close();else if(mode==='port-stop')stop();else if(mode==='malformed-port')ch.port1.postMessage({...cmd(own,'status'),version:0});else ch.port2.dispatchEvent(new MessageEvent('messageerror'));
   if(mode==='malformed-port')await wait(()=>c.snapshot().scope.generation!==own.generation);
   check(c.snapshot().scope.generation!==own.generation&&c.snapshot().phase!=='ready'&&c.snapshot().remote!=='connected','r8-sync-invalidation');
   const close=c.close();check(c.close()===close&&c.retryClose()===close,'r8-single-pending');await pause();check(alive&&closes===1,'r8-pending-not-confirmed');
   check(await send(c,'disconnect',{mode:'local-only'})===null,'r8-closed-admission');const state=JSON.stringify(c.snapshot());
   ch.port1.postMessage(cmd(c.snapshot().scope,'status'));gate.resolve();check(await close,'r8-release-confirmed');await stop();await pause();
   check(!alive&&closes===1&&messages.length===0&&JSON.stringify(c.snapshot())===state,'r8-no-late-state-reply');
   check(JSON.stringify(await row(own))===beforeRow&&deletes===0,'r8-no-tombstone-journal-delete');check(await request(session.transaction('fixture').objectStore('fixture').get('canary'))==='SESSION_CANARY','r8-session-preserved');session.close();ch.port1.close();cases.push('R7-01 '+mode+' ready, observed idempotent resource close, real IDB/MessageChannel; messageerror explicitly injected');
  }
  // Ignoring close/stop promises is supported, including raw synchronous and async driver errors.
  for(const sync of [false,true]){
   let calls=0;const driver:OfflineAuthDriver={begin:async()=>({kind:'verified-user',accountId:'123',isBot:false}),code:async()=>({kind:'password-needed'}),password:async()=>({kind:'password-needed'}),close:()=>{if(++calls===1){if(sync)throw Error('RAW_SECRET_CANARY');return Promise.reject(Error('RAW_SECRET_CANARY'));}return Promise.resolve();}};
   const c=new AuthCoordinator(scope(),store,driver);await send(c,'begin-phone',{phone:'SYNTHETIC'});const ch=new MessageChannel(),stop=bindAuthPort(ch.port2,c);stop();await pause();check(await c.close()===false&&calls===1,'r8-failure-observed-no-auto-retry');
   const state=JSON.stringify(c.snapshot());check(await c.retryClose()&&calls===2,'r8-explicit-retry');check(await send(c,'status')===null&&JSON.stringify(c.snapshot())===state,'r8-retry-no-readmission');ch.port1.close();
  }cases.push('safe sync/async close failures without awaiting stop, explicit success retry, no readmission/unhandled rejection');
  // Bounded observation of a deliberately unresolved promise, then test-only release.
  const hang=deferred<void>();let hangs=0,settled=false;
  const base:OfflineAuthDriver={begin:async()=>({kind:'verified-user',accountId:'123',isBot:false}),code:async()=>({kind:'password-needed'}),password:async()=>({kind:'password-needed'}),close:()=>{hangs++;return hang.promise;}};
  const hanging=new AuthCoordinator(scope(),store,base);await send(hanging,'begin-phone',{phone:'SYNTHETIC'});const pending=hanging.close();void pending.then(()=>settled=true);await pause();check(!settled&&hangs===1&&hanging.retryClose()===pending,'r8-hang-no-false-confirmation');hang.resolve();await pending;
  cases.push('controlled never-resolving driver close stays pending, concurrent retry shares operation; fixture released after observation');
  // disconnect starts real durable marking, close supersedes its publication/deletion authority.
  for(const fail of [false,true]){
   const closeGate=deferred<void>(),markGate=deferred<void>();let calls=0;
   const c=new AuthCoordinator(scope(),{register:store.register.bind(store),bind:store.bind.bind(store),tombstone:async s=>{await markGate.promise;await store.tombstone(s);},cleanup:store.cleanup.bind(store)},{...base,close:()=>{calls++;return closeGate.promise;}});
   await send(c,'begin-phone',{phone:'SYNTHETIC'});const logout=send(c,'disconnect',{mode:'remote-and-local'});await pause();const closing=c.close(),state=JSON.stringify(c.snapshot());check(calls===1,'r8-disconnect-shares-close');markGate.resolve();if(fail)closeGate.reject(Error('RAW_CANARY'));else closeGate.resolve();
   check(await closing===!fail&&await logout===null,'r8-stale-disconnect');check(JSON.stringify(c.snapshot())===state&&deletes===0,'r8-no-stale-cleanup');check((await row(c.snapshot().scope)).tombstone,'r8-authorized-mark-only');
  }cases.push('close versus pending disconnect shares close, stale success/error cannot cleanup or publish; only authorized disconnect tombstones');
  // Driver ignores AbortSignal and returns verified result after close and a new scope is ready.
  for(const error of [false,true]){
   const late=deferred<Awaited<ReturnType<OfflineAuthDriver['begin']>>>();let signal:AbortSignal|null=null;
   const old=new AuthCoordinator(scope(),store,{...base,begin:(_p,s)=>{signal=s;return late.promise;},close:async()=>{}}),ch=new MessageChannel(),messages:unknown[]=[];ch.port1.onmessage=e=>messages.push(e.data);const stop=bindAuthPort(ch.port2,old);
   ch.port1.postMessage(cmd(old.snapshot().scope,'begin-phone',{phone:'SYNTHETIC'}));await wait(()=>signal!==null);await stop();const state=JSON.stringify(old.snapshot()),count=messages.length;
   const fresh=new AuthCoordinator(scope(),store,{...base,close:async()=>{}});await send(fresh,'begin-phone',{phone:'SYNTHETIC'});const freshState=JSON.stringify(fresh.snapshot()),freshRow=JSON.stringify(await row(fresh.snapshot().scope));
   if(error)late.reject(Error('RAW_SECRET_CANARY'));else late.resolve({kind:'verified-user',accountId:'789',isBot:false});await pause();
   check(signal!.aborted&&messages.length===count&&JSON.stringify(old.snapshot())===state,'r8-ignore-abort-fenced');check((await row(old.snapshot().scope)).scope.accountId===null,'r8-no-late-bind');check(JSON.stringify(fresh.snapshot())===freshState&&JSON.stringify(await row(fresh.snapshot().scope))===freshRow,'r8-new-scope-preserved');await fresh.close();ch.port1.close();
  }cases.push('real port stop with ignored abort, late verified/error cannot bind/reply/mutate fresh scope');
  for(const db of canaries)check(await request(db.transaction('fixture').objectStore('fixture').get('canary'))==='R8_CANARY','r8-other-local-canaries');
  await pause();check(unhandled.length===0&&deletes===0,'r8-no-unhandled-or-deletes');
  cases.push('session/local/other canaries preserved, no close deletion or new journal, no unhandledrejection');
  // Already issued delete cannot be cancelled by close. Its late journal completion is store-only.
  let closeCalls=0;const deleting=new AuthCoordinator(scope(),store,{...base,close:async()=>{closeCalls++;}});await send(deleting,'begin-phone',{phone:'SYNTHETIC'});
  const deletingScope=deleting.snapshot().scope,blocker=await open(sessionDatabase(deletingScope.sessionSlotId));
  const blocked=await send(deleting,'disconnect',{mode:'local-only'});check(blocked?.type==='state'&&blocked.state.localSession==='cleanup-pending'&&deletes===1,'r8-already-issued-delete');
  await deleting.close();const closedState=JSON.stringify(deleting.snapshot());blocker.close();
  for(let n=0;n<80;n++){if((await row(deletingScope)).deletion==='completed')break;await pause();}
  check((await row(deletingScope)).deletion==='completed'&&JSON.stringify(deleting.snapshot())===closedState&&closeCalls===1,'r8-late-delete-only-journal');
  const recreated=await open(sessionDatabase(deletingScope.sessionSlotId)),tx=recreated.transaction('fixture','readwrite');tx.objectStore('fixture').put('RECREATED_CANARY','canary');await new Promise(r=>tx.oncomplete=r);recreated.close();
  check(await store.cleanup(deletingScope)&&deletes===1,'r8-no-second-delete');
  const inspect=await open(sessionDatabase(deletingScope.sessionSlotId));check(await request(inspect.transaction('fixture').objectStore('fixture').get('canary'))==='RECREATED_CANARY','r8-late-recreated-preserved');inspect.close();
  for(const db of canaries)check(await request(db.transaction('fixture').objectStore('fixture').get('canary'))==='R8_CANARY','r8-late-other-preserved');
  cases.push('close after real blocked logout delete: late native success updates only journal; recreated/local/other canaries preserved');return cases;
 }finally{for(const db of canaries)db.close();window.removeEventListener('unhandledrejection',onUnhandled);}
}

async function regressions(){
 const cases:string[]=[];
 const driver:OfflineAuthDriver={begin:async()=>({kind:'verified-user',accountId:'123',isBot:false}),code:async()=>({kind:'password-needed'}),password:async()=>({kind:'password-needed'}),close:async()=>{}};
 const send=(c:AuthCoordinator,type:string,extra:object={})=>c.handle(cmd(c.snapshot().scope,type,extra));
 const readRow=async(slot:string)=>{const db=await request(indexedDB.open(CONTROL_DB));try{return await request(db.transaction('slots').objectStore('slots').get(slot));}finally{db.close();}};
 const wait=async(fn:()=>Promise<boolean>)=>{const end=performance.now()+5000;while(performance.now()<end){if(await fn())return;await pause();}throw Error('reconcile-timeout');};
 // Expiry occurs in register's IDB event: abort listener runs before guard throws.
 let ticks=0,calls=0;
 const expiry=new AuthCoordinator(scope(),new IndexedAuthScopeStore(indexedDB),{...driver,begin:async()=>{calls++;return {kind:'password-needed'};}},()=>++ticks>=3?40000:0);
 check(await send(expiry,'begin-phone',{phone:'SYNTHETIC'})===null,'expiry-null');check(calls===0&&expiry.snapshot().phase==='failed','expiry-no-driver');await pause();
 cases.push('R5-02 real IDB guard expires and catch tolerates already aborted transaction');
 // A committed transaction has removed its AbortSignal listener.
 const listenerScope=scope(),controller=new AbortController();let adds=0,removes=0;
 const add=controller.signal.addEventListener.bind(controller.signal),remove=controller.signal.removeEventListener.bind(controller.signal);
 controller.signal.addEventListener=((...args:Parameters<AbortSignal['addEventListener']>)=>{adds++;return add(...args);}) as AbortSignal['addEventListener'];
 controller.signal.removeEventListener=((...args:Parameters<AbortSignal['removeEventListener']>)=>{removes++;return remove(...args);}) as AbortSignal['removeEventListener'];
 await new IndexedAuthScopeStore(indexedDB).register(listenerScope,()=>true,controller.signal);controller.abort();check(adds===1&&removes===1,'listener-cleanup');
 cases.push('IDB completed transaction removes abort listener before later abort');
 // Blocked deletion completes WITHOUT retry; coordinator remains conservative until explicit refresh.
 const store=new IndexedAuthScopeStore(indexedDB),c=new AuthCoordinator(scope(),store,driver);await send(c,'begin-phone',{phone:'SYNTHETIC'});
 const own=c.snapshot().scope,blocker=await open(sessionDatabase(own.sessionSlotId));
 const otherScope=scope(),other=await open(sessionDatabase(otherScope.sessionSlotId)),local=await open('r6-local-canary');
 for(const db of [blocker,other,local]){const tx=db.transaction('fixture','readwrite');tx.objectStore('fixture').put('R6_CANARY','canary');await new Promise((a,b)=>{tx.oncomplete=a;tx.onabort=b;});}
 const pending=await send(c,'disconnect',{mode:'remote-and-local'});check(pending?.type==='state'&&pending.state.localSession==='cleanup-pending','blocked-pending');
 const before=c.snapshot();check((await readRow(own.sessionSlotId)).deletion==='pending','durable-pending');
 check(!await new IndexedAuthScopeStore(indexedDB).cleanup(own),'reopen-pending-no-second-delete');
 blocker.close();await wait(async()=>{const row=await readRow(own.sessionSlotId);return row.deleted&&row.deletion==='completed'&&row.tombstone;});
 check(JSON.stringify(c.snapshot())===JSON.stringify(before),'late-result-no-ui-change');
 let recreated=false;const r=indexedDB.open(sessionDatabase(own.sessionSlotId),1);r.onupgradeneeded=()=>{recreated=true;r.result.createObjectStore('fixture');};const db=await request(r);check(recreated,'deleted-without-retry');
 const tx=db.transaction('fixture','readwrite');tx.objectStore('fixture').put('REOPEN_CANARY','canary');await new Promise(a=>tx.oncomplete=a);db.close();
 check(await new IndexedAuthScopeStore(indexedDB).cleanup(own),'reopen-reconciled-completed');
 const retained=await open(sessionDatabase(own.sessionSlotId));check(await request(retained.transaction('fixture').objectStore('fixture').get('canary'))==='REOPEN_CANARY','no-repeat-delete-after-completion');retained.close();
 for(const db of [other,local]){check(await request(db.transaction('fixture').objectStore('fixture').get('canary'))==='R6_CANARY','other-db-preserved');db.close();}
 const refreshed=await send(c,'disconnect',{mode:'local-only'});check(refreshed?.type==='state'&&refreshed.state.localSession==='absent','explicit-refresh');
 cases.push('R5-04 blocked request reconciles completed without retry; reopen does not re-delete; coordinator unchanged; other DB canaries preserved');
 // Close failure is separate from tombstone storage failure: durable marker alone cannot authorize delete.
 let failClose=true,closeAttempts=0;
 const closing=new AuthCoordinator(scope(),new IndexedAuthScopeStore(indexedDB),{...driver,close:async()=>{closeAttempts++;if(failClose)throw Error('synthetic-close-failure');}});
 await send(closing,'begin-phone',{phone:'SYNTHETIC'});const closingScope=closing.snapshot().scope;
 const closeDb=await open(sessionDatabase(closingScope.sessionSlotId));const closeTx=closeDb.transaction('fixture','readwrite');closeTx.objectStore('fixture').put('CLOSE_CANARY','canary');await new Promise(a=>closeTx.oncomplete=a);closeDb.close();
 check((await send(closing,'disconnect',{mode:'remote-and-local'}))?.type==='error','close-failure');
 const closeRow=await readRow(closingScope.sessionSlotId);check(closeRow.tombstone&&!closeRow.deleted&&closeRow.deletion===undefined,'close-failure-tombstone-no-delete');
 const closeInspect=await open(sessionDatabase(closingScope.sessionSlotId));check(await request(closeInspect.transaction('fixture').objectStore('fixture').get('canary'))==='CLOSE_CANARY','close-failure-preserves-session');closeInspect.close();
 const closeDenied=await send(closing,'begin-phone',{phone:'SYNTHETIC'});check(closeDenied?.type==='error'&&closeDenied.error.code==='cleanup','close-failure-quarantine');
 failClose=false;const closeRetry=await send(closing,'disconnect',{mode:'local-only'});check(closeRetry?.type==='state'&&closeRetry.state.localSession==='absent'&&closeAttempts===2,'close-failure-retry');
 cases.push('synthetic driver close failure with real durable tombstone preserves session canary and quarantine until explicit retry');
 // Inject only delete request events; control persistence and exact-slot retry use real IDB.
 let emitError=()=>{},deleteCalls=0;
 const errorFactory={open:indexedDB.open.bind(indexedDB),deleteDatabase:(name:string)=>{
  deleteCalls++;if(deleteCalls>1)return indexedDB.deleteDatabase(name);
  const r={onblocked:null,onerror:null} as unknown as IDBOpenDBRequest;
  setTimeout(()=>r.onblocked?.call(r,new Event('blocked') as IDBVersionChangeEvent),0);
  emitError=()=>r.onerror?.call(r,new Event('error'));return r;
 }} as IDBFactory;
 const errorScope=scope(),errorStore=new IndexedAuthScopeStore(errorFactory);await errorStore.register(errorScope,()=>true);await errorStore.tombstone(errorScope);
 (await open(sessionDatabase(errorScope.sessionSlotId))).close();check(!await errorStore.cleanup(errorScope),'injected-blocked');emitError();
 await wait(async()=>(await readRow(errorScope.sessionSlotId)).deletion==='error');
 check(!(await readRow(errorScope.sessionSlotId)).deleted,'late-error-not-completed');
 check(await new IndexedAuthScopeStore(errorFactory).cleanup(errorScope),'late-error-explicit-retry');check(deleteCalls===2,'late-error-exact-retry-count');
 cases.push('injected late delete error reconciles error durably in real IDB; explicit retry completes exact slot');
 // Force real VersionError at ready. Test-only factory permits reopening v2 on explicit repair.
 let repaired=false,closes=0,deletes=0;
 const factory={open:(name:string,version?:number)=>indexedDB.open(name,repaired&&name===CONTROL_DB?2:version),deleteDatabase:(name:string)=>{deletes++;return indexedDB.deleteDatabase(name);}} as IDBFactory;
 const faultStore=new IndexedAuthScopeStore(factory),fault=new AuthCoordinator(scope(),faultStore,{...driver,close:async()=>{closes++;}});
 await send(fault,'begin-phone',{phone:'SYNTHETIC'});check(fault.snapshot().phase==='ready','fault-ready');
 const faultScope=fault.snapshot().scope,session=await open(sessionDatabase(faultScope.sessionSlotId));session.close();
 (await request(indexedDB.open(CONTROL_DB,2))).close();
 const generation=fault.snapshot().scope.generation,disconnect=send(fault,'disconnect',{mode:'remote-and-local'});
 check(fault.snapshot().scope.generation!==generation&&fault.snapshot().localSession==='cleanup-pending','sync-quarantine');
 const failed=await disconnect;check(failed?.type==='error'&&closes===1&&deletes===0,'close-despite-tombstone-failure');
 check(!(await readRow(faultScope.sessionSlotId)).tombstone,'failed-tombstone-not-faked');
 const denied=await send(fault,'begin-phone',{phone:'SYNTHETIC'});check(denied?.type==='error'&&denied.error.code==='cleanup','quarantine-after-failure');
 const storage=new AuthCoordinator(scope(),new IndexedAuthScopeStore(indexedDB),driver),storageError=await send(storage,'begin-phone',{phone:'SYNTHETIC_SECRET_CANARY'});
 check(storageError?.type==='error'&&storageError.error.family==='storage-unavailable'&&storageError.error.code==='storage','safe-storage-error');
 check(!JSON.stringify(storageError).includes('VersionError')&&!JSON.stringify(storageError).includes('SYNTHETIC_SECRET_CANARY'),'safe-storage-boundary');
 repaired=true;const retry=await send(fault,'disconnect',{mode:'local-only'});check(retry?.type==='state'&&retry.state.localSession==='absent'&&closes===1&&deletes===1,'quarantine-explicit-repair-retry');
 check((await readRow(faultScope.sessionSlotId)).tombstone,'retry-durable-tombstone');
 cases.push('R5-01 tombstone VersionError still closes ready driver, invalidates synchronously, prohibits delete, quarantines and permits explicit repaired retry');
 cases.push('R5-03 real VersionError maps storage-unavailable/storage with no raw exception or secret');
 // Real delete succeeds but its journal write gets real VersionError: never re-delete uncertain pending.
 let journalBroken=false,uncertainDeletes=0;
 const uncertainFactory={open:(name:string,version?:number)=>indexedDB.open(name,name===CONTROL_DB?(journalBroken?1:2):version),deleteDatabase:(name:string)=>{
  uncertainDeletes++;const r=indexedDB.deleteDatabase(name);r.addEventListener('success',()=>{journalBroken=true;});return r;
 }} as IDBFactory;
 const uncertainStore=new IndexedAuthScopeStore(uncertainFactory),uncertainScope=scope();await uncertainStore.register(uncertainScope,()=>true);await uncertainStore.tombstone(uncertainScope);
 (await open(sessionDatabase(uncertainScope.sessionSlotId))).close();check(!await uncertainStore.cleanup(uncertainScope),'journal-uncertain');
 check((await readRow(uncertainScope.sessionSlotId)).deletion==='pending','uncertain-pending-durable');
 const preserved=await open(sessionDatabase(uncertainScope.sessionSlotId));const preserveTx=preserved.transaction('fixture','readwrite');preserveTx.objectStore('fixture').put('UNCERTAIN_CANARY','canary');await new Promise(a=>preserveTx.oncomplete=a);preserved.close();
 journalBroken=false;check(!await new IndexedAuthScopeStore(uncertainFactory).cleanup(uncertainScope),'uncertain-no-automatic-retry');check(uncertainDeletes===1,'uncertain-no-second-delete');
 const inspect=await open(sessionDatabase(uncertainScope.sessionSlotId));check(await request(inspect.transaction('fixture').objectStore('fixture').get('canary'))==='UNCERTAIN_CANARY','uncertain-reopen-canary');inspect.close();
 cases.push('real late journal VersionError leaves durable pending and prevents re-delete after storage repair/reopen');
 return cases;
}
(window as unknown as {authOffline:Promise<unknown>}).authOffline=run().then(async result=>({...result,cases:[...result.cases,...await lifecycle(),...await regressions()]})).catch(e=>({passed:false,failure:e instanceof Error?e.message:'test-failure'}));
