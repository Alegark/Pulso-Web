/// <reference lib="webworker" />
/** TESTONLY explicit composition for standalone browser harnesses. No product host.
 * This host has synthetic authority; it does not claim owner/proof integration. */
import {registerDatabaseRealmHost,installWorkerDatabaseRealm,bindWorkerRealm,workerDatabaseRealmCurrent,type RealmHost} from '../../src/storage/database-realms';
import {openDatabase,admittedTransaction,committed,subscribeDatabaseLifecycle,assertDatabaseUse,closeDatabase} from '../../src/storage/database';
export function authorizeRealmFixture(host?:RealmHost):()=>void {
 return registerDatabaseRealmHost(host??{capture:(_kind,current)=>current()?{current,onLifecycle:()=>{},end:()=>{}}:null});
}
export async function initializeRealmFixture():Promise<void>{const db=await openDatabase();closeDatabase(db);}
// TESTONLY worker can retain an actual native connection/transaction so native
// versionchange crosses the real production lifecycle wrapper deterministically.
if(typeof document==='undefined'){
 installWorkerDatabaseRealm('import');
 const scope=globalThis as unknown as DedicatedWorkerGlobalScope;
 subscribeDatabaseLifecycle(state=>scope.postMessage({fixture:'lifecycle',state,current:workerDatabaseRealmCurrent()}));
 scope.onmessage=async event=>{
  if(bindWorkerRealm('import',event))return;
  if(event.data?.fixture==='hold'){
   const db=await openDatabase();scope.postMessage({fixture:'held'});
   if(event.data.tx){
    const tx=admittedTransaction(db,'settings','readwrite'),done=committed(tx);
    tx.objectStore('settings').put('uncommitted','active-canary');
    const pump=()=>{const r=tx.objectStore('settings').get('canary');r.onsuccess=()=>{if(workerDatabaseRealmCurrent())pump();};};pump();
    void done.then(()=>scope.postMessage({fixture:'tx',terminal:'complete'}),()=>scope.postMessage({fixture:'tx',terminal:'abort'}));
   }
  }else if(event.data?.fixture==='commit'){
   const db=await openDatabase(),tx=admittedTransaction(db,'settings','readwrite'),done=committed(tx);tx.objectStore('settings').put('winner','commit-canary');await done;scope.postMessage({fixture:'committed'});
  }else if(event.data?.fixture==='abnormal-close'){
   const db=await openDatabase();db.dispatchEvent(new Event('close')); // INJECTION; not a native crash/purge.
   let denied=false;try{assertDatabaseUse('read');}catch{denied=true;}scope.postMessage({fixture:'closed',denied});
  }else if(event.data?.fixture==='normal-close'){
   const db=await openDatabase();closeDatabase(db);assertDatabaseUse('read');scope.postMessage({fixture:'normal'});
  }
 };
}
