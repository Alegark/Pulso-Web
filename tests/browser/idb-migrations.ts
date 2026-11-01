import {DATABASE,openDatabase,readRecord,writeRecord,request,committed,subscribeDatabaseLifecycle,type DatabaseLifecycleState} from '../../src/storage/database';
import {issuedFailure} from '../../src/errors/app-failure';

const stores=['assets','chunks','jobs','tickets','settings','tracks','playlists','unknown-store'];
const values:Record<string,unknown>={assets:{id:'synthetic-asset',kept:true},chunks:new Uint8Array([17,29,43,71]),jobs:{state:'synthetic-job'},tickets:{synthetic:true},settings:{entries:['synthetic-track'],paused:true},tracks:{id:'synthetic-track',assetId:'synthetic-asset'},playlists:{entries:['synthetic-track']},'unknown-store':{extra:true}};
function assert(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test:()=>boolean){for(let i=0;i<200&&!test();i++)await wait(5);assert(test(),'event timeout');}
function alive(db:IDBDatabase){try{db.transaction('settings');return true;}catch{return false;}}
async function seed(version=1,missingTickets=true){
 const r=indexedDB.open(DATABASE,version);
 r.onupgradeneeded=()=>{for(const store of stores)if(!(missingTickets&&store==='tickets'))r.result.createObjectStore(store);};
 const db=await request(r);const names=Array.from(db.objectStoreNames);const tx=db.transaction(names,'readwrite');const done=committed(tx);
 for(const store of names)tx.objectStore(store).put(values[store],'canary');await done;return db;
}
async function canaries(db:IDBDatabase,missingTickets=false){
 const names=stores.filter(s=>!(missingTickets&&s==='tickets'));const tx=db.transaction(names);const done=committed(tx);
 const rows=await Promise.all(names.map(async s=>{const value=await request(tx.objectStore(s).get('canary'));const normalize=(v:unknown)=>v instanceof Uint8Array?Array.from(v):v;assert(JSON.stringify(normalize(value))===JSON.stringify(normalize(values[s])),'preserved '+s);return s;}));await done;return rows;
}
async function failure(work:()=>Promise<unknown>,code:string){let caught:unknown;try{await work();}catch(e){caught=e;}const f=issuedFailure(caught);assert(f?.phase==='open'&&f.backend==='idb'&&f.code===code,'typed open failure '+code);return f;}

export async function run(name:string){
 const events:string[]=[];const states:DatabaseLifecycleState[]=[];
 const unsub=subscribeDatabaseLifecycle(state=>states.push(state));
 const originalOpen=IDBFactory.prototype.open,originalClose=IDBDatabase.prototype.close,originalCreate=IDBDatabase.prototype.createObjectStore;
 let extra:unknown;
 try {
 if(name==='normal-helpers'){
  const db=await openDatabase();assert(db.version===2&&db.objectStoreNames.length===7,'normal v2 schema');db.close();assert(!alive(db),'caller closed');
  await writeRecord('settings','canary',{paused:true});assert((await readRecord<{paused:boolean}>('settings','canary'))?.paused,'write/read helpers');
  const again=await openDatabase();const tx=again.transaction('settings','readwrite'),done=committed(tx);void done.catch(()=>{});tx.objectStore('settings').put({temporary:true},'canary');tx.abort();let aborted=false;try{await done;}catch{aborted=true;}assert(aborted,'committed rejects abort');again.close();assert((await readRecord<{paused:boolean}>('settings','canary'))?.paused,'aborted write rolled back');assert(!states.length,'no success notifications');
 }else if(name==='blocked'||name==='blocked-readRecord'){
  const blocker=await seed();blocker.onversionchange=()=>events.push('blocker-held');
  let upgrade:IDBOpenDBRequest|undefined,terminal=false,mutations=0,settlements=0;
  IDBDatabase.prototype.createObjectStore=function(...args){mutations++;return Reflect.apply(originalCreate,this,args);};
  IDBFactory.prototype.open=function(...args){const r=Reflect.apply(originalOpen,this,args) as IDBOpenDBRequest;upgrade=r;r.addEventListener('upgradeneeded',()=>events.push('native-upgrade'));r.addEventListener('error',()=>{terminal=true;events.push('native-error');});return r;};
  const work=name==='blocked'?()=>openDatabase():()=>readRecord('settings','canary');
  const primary=await failure(()=>work().finally(()=>{settlements++;}),'database-blocked');assert(primary.family==='storage-unavailable','blocked family');
  assert(states.join()==='blocked','one blocked notification');assert(mutations===0,'no mutation while blocked');await canaries(blocker,true);blocker.close();
  await until(()=>terminal);assert(upgrade?.error?.name==='AbortError','late upgrade aborted');assert(mutations===0&&settlements===1,'no late migration/settlement');
  IDBFactory.prototype.open=originalOpen;IDBDatabase.prototype.createObjectStore=originalCreate;
  const old=await request(indexedDB.open(DATABASE,1));assert(old.version===1&&!old.objectStoreNames.contains('tickets'),'rejected upgrade rolled back');await canaries(old,true);old.close();
  const retry=await openDatabase();assert(retry.version===2&&retry.objectStoreNames.length===8,'explicit retry additive');await canaries(retry,true);assert(await request(retry.transaction('tickets').objectStore('tickets').count())===0,'missing store empty');retry.close();extra={settlements,mutationsBeforeRetry:mutations};
 }else if(name==='late-success'||name==='late-success-readRecord'){
  // Real request/result; injected blocked event covers defensive success-after-reject
  // independently of native late-upgrade abort (which normally precludes success).
  const seedDB=await seed(2,false);seedDB.close();let late:IDBDatabase|undefined,closed=0,settlements=0,terminal=false;
  IDBDatabase.prototype.close=function(){if(this===late){closed++;events.push('close');}return originalClose.call(this);};
  IDBFactory.prototype.open=function(...args){const r=Reflect.apply(originalOpen,this,args) as IDBOpenDBRequest;
   r.addEventListener('success',()=>{late=r.result;events.push('native-success');});
   queueMicrotask(()=>r.dispatchEvent(new Event('blocked')));
   queueMicrotask(()=>r.addEventListener('success',()=>{terminal=true;r.dispatchEvent(new Event('error'));r.dispatchEvent(new Event('blocked'));}));return r;};
  await failure(()=>(name==='late-success'?openDatabase():readRecord('settings','canary')).finally(()=>{settlements++;}),'database-blocked');
  await until(()=>terminal);assert(late&&!alive(late)&&closed===1,'late native success closed immediately');assert(settlements===1&&states.join()==='blocked','one result and notification');extra={closed,settlements,events};
 }else if(name==='upgrade-abort'){
  const before=await seed();await canaries(before,true);before.close();let changed=false;
  IDBFactory.prototype.open=function(...args){const r=Reflect.apply(originalOpen,this,args) as IDBOpenDBRequest;queueMicrotask(()=>r.addEventListener('upgradeneeded',()=>{changed=r.result.objectStoreNames.contains('tickets');r.transaction!.abort();events.push('injected-abort');}));return r;};
  await failure(()=>openDatabase(),'transaction-aborted');assert(changed,'abort after additive mutation');IDBFactory.prototype.open=originalOpen;
  const rollback=await request(indexedDB.open(DATABASE,1));assert(rollback.version===1&&!rollback.objectStoreNames.contains('tickets'),'atomic schema rollback');await canaries(rollback,true);rollback.close();
  const retry=await openDatabase();await canaries(retry,true);assert(retry.objectStoreNames.contains('tickets'),'reopen migrated');retry.close();
 }else if(name==='existing-seven-extra'){
  const before=await seed(1,false);before.close();const migrated=await openDatabase();assert(migrated.version===2&&migrated.objectStoreNames.length===8,'seven plus extra');await canaries(migrated);migrated.close();
 }else if(name==='future'){
  const future=await seed(3,false);future.close();const f=await failure(()=>openDatabase(),'storage-unavailable');assert(f.family==='storage-unavailable'&&states.join()==='version-incompatible','explicit incompatible state');
  const unchanged=await request(indexedDB.open(DATABASE,3));assert(unchanged.version===3&&unchanged.objectStoreNames.length===8,'future preserved');await canaries(unchanged);unchanged.close();
 }else if(name==='versionchange-listeners'){
  const db=await openDatabase();let synchronous=false,good=0,removed=0;
  const remove=subscribeDatabaseLifecycle(()=>{removed++;});remove();remove();
  const bad=subscribeDatabaseLifecycle(()=>{throw Error('synthetic listener fault');});
  const goodUnsub=subscribeDatabaseLifecycle(state=>{if(state==='versionchange'){synchronous=alive(db);events.push('invalidated');good++;}});
  IDBDatabase.prototype.close=function(){if(this===db){assert(synchronous,'invalidated before close');events.push('close');}return originalClose.call(this);};
  const next=indexedDB.open(DATABASE,3);next.onupgradeneeded=()=>next.transaction!.abort();let aborted=false;try{await request(next);}catch{aborted=true;}
  assert(aborted&&!alive(db)&&good===1&&removed===0,'delivered connection closed despite throwing listener');assert(events.join()==='invalidated,close'&&states.join()==='versionchange','notification ordering');bad();goodUnsub();
  const reopened=await openDatabase();assert(reopened.version===2,'aborted next version');reopened.close();
 }else if(name.startsWith('sync-')||name.startsWith('boundary-')){
  let getterCalls=0;
  const kind=name.split('-')[1];
  const error=kind==='hostile'?Object.create(null,{name:{get(){getterCalls++;throw Error('getter executed');}}}):kind==='proxy'?new Proxy({},{get(){getterCalls++;throw Error('proxy get');},getPrototypeOf(){getterCalls++;throw Error('proxy proto');}}):new DOMException('synthetic',kind==='quota'?'QuotaExceededError':kind==='security'?'SecurityError':'VersionError');
  const code=kind==='quota'?'quota-exceeded':kind==='security'?'storage-denied':kind==='version'?'storage-unavailable':'unknown';
  if(name.startsWith('sync-'))IDBFactory.prototype.open=function(){throw error;};
  else IDBDatabase.prototype.createObjectStore=function(){throw error;};
  await failure(()=>openDatabase(),code);assert(getterCalls===0,'hostile error not inspected');assert(states.join()===(kind==='version'?'version-incompatible':''),'only incompatible lifecycle');
  IDBFactory.prototype.open=originalOpen;IDBDatabase.prototype.createObjectStore=originalCreate;
  // Flush the rejected upgrade request and prove it left no partial schema.
  if(name.startsWith('boundary-')){const reopened=await openDatabase();assert(reopened.version===2&&reopened.objectStoreNames.length===7,'boundary rollback/retry');reopened.close();}
 }else throw Error('unknown case');
 return {name,passed:true,states,events,extra};
 }finally{unsub();IDBFactory.prototype.open=originalOpen;IDBDatabase.prototype.close=originalClose;IDBDatabase.prototype.createObjectStore=originalCreate;}
}
(window as unknown as {idbMigrations:{run:typeof run}}).idbMigrations={run};
