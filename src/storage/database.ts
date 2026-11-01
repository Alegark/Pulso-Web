import {AppFailure,makeFailure,fromKnownError,nativeDOMName} from '../errors/app-failure';
export const DATABASE = 'pulso-web-local-v1';
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
export function committed(tx: IDBTransaction): Promise<void> {
  const done=new Promise<void>((resolve, reject) => { let observed:unknown; tx.addEventListener('error',event=>{try{const target=event.target;if(target instanceof IDBRequest)observed??=target.error;}catch{/* no cause observed */}}); tx.oncomplete = () => resolve(); tx.onabort = () => reject(observed ?? tx.error ?? AppFailure.create(makeFailure(null,'storage-unavailable','transaction-aborted','idb'))); tx.onerror = () => {}; });
  void done.catch(()=>{});return done;
}
export type DatabaseLifecycleState = 'blocked' | 'versionchange' | 'version-incompatible' | 'connection-closed';
const lifecycleListeners = new Set<(state:DatabaseLifecycleState)=>void>();
export type DatabaseOpenPhase='open'|'upgrade'|'deliver';
const openGuards=new Set<(phase:DatabaseOpenPhase)=>boolean>();
/** Realm-local admission policy, independent of diagnostics. False denies native
 * opens; the caller may allow an explicit revalidation window. No automatic retry.
 */
export function registerDatabaseOpenGuard(guard:(phase:DatabaseOpenPhase)=>boolean):()=>void {
  openGuards.add(guard);return ()=>{openGuards.delete(guard);};
}
function openAdmissionFailure(phase:DatabaseOpenPhase):AppFailure|null {
  for(const guard of [...openGuards]){
    try{if(guard(phase))continue;}catch{return AppFailure.create(makeFailure('open','internal','unknown','idb'));}
    return AppFailure.create(makeFailure('open','storage-unavailable','database-blocked','idb'));
  }
  return null;
}

/** Anomalies only, no replay or automatic recovery. Retry requires caller revalidation. */
export function subscribeDatabaseLifecycle(listener:(state:DatabaseLifecycleState)=>void):()=>void {
  lifecycleListeners.add(listener);
  return () => { lifecycleListeners.delete(listener); };
}
function notifyLifecycle(state:DatabaseLifecycleState):void {
  // Close local admission before any observer can post to another realm.
  if(!localState || !fatal(localState))localState=state;
  openingCohort=Symbol();
  try { for (const listener of [...lifecycleListeners]) {
    try { listener(state); } catch { /* Observers cannot prevent closure. */ }
  }} finally {retireDatabaseRealm();}
}
export type DatabaseUseKind='read'|'write'|'publish'|'cleanup';
export interface DatabaseAdmissionPolicy {
  open(phase:DatabaseOpenPhase):boolean;
  use(kind:DatabaseUseKind):boolean;
  /** Explicit existing-schema revalidation only; installed by explicit SW RPC, never by dedicated workers. */
  revalidate?():boolean;
}
const useGuards=new Set<(kind:DatabaseUseKind)=>boolean>();
const admissionPolicies=new Set<DatabaseAdmissionPolicy>();
let localState:DatabaseLifecycleState|null=null;
const fatal=(state:DatabaseLifecycleState)=>state==='versionchange'||state==='version-incompatible';
const connections=new Set<WeakRef<IDBDatabase>>();
const connectionRefs=new WeakMap<IDBDatabase,WeakRef<IDBDatabase>>();
const activeTransactions=new Set<IDBTransaction>();
function deniedUse():never {throw AppFailure.create(makeFailure(null,'storage-unavailable','storage-unavailable','idb'));}
export function registerDatabaseUseGuard(guard:(kind:DatabaseUseKind)=>boolean):()=>void {
 useGuards.add(guard);return ()=>{useGuards.delete(guard);};
}
export function registerDatabaseAdmissionPolicy(policy:DatabaseAdmissionPolicy):()=>void {
 admissionPolicies.add(policy);
 const removeOpen=registerDatabaseOpenGuard(phase=>policy.open(phase));
 const removeUse=registerDatabaseUseGuard(kind=>policy.use(kind));
 return ()=>{admissionPolicies.delete(policy);removeOpen();removeUse();};
}
export function assertDatabaseUse(kind:DatabaseUseKind):void {
 if(localState)deniedUse();
 for(const guard of useGuards){let allowed=false;try{allowed=guard(kind);}catch{/* fail closed */}if(!allowed)deniedUse();}
}
export function admittedTransaction(db:IDBDatabase,stores:string|string[],mode:IDBTransactionMode='readonly'):IDBTransaction {
 assertDatabaseUse(mode==='readonly'?'read':'write');
 const tx=db.transaction(stores,mode);activeTransactions.add(tx);
 const end=()=>{activeTransactions.delete(tx);};
 tx.addEventListener('complete',end,{once:true});tx.addEventListener('abort',end,{once:true});
 return tx;
}
/** Explicit close removes normal connections immediately, without patching IDB.
 * Weak refs cover legacy consumers; GC never grants admission. */
export function closeDatabase(db:IDBDatabase):void {
 const ref=connectionRefs.get(db);if(ref){connections.delete(ref);connectionRefs.delete(db);}
 db.close();
}
export function retireDatabaseRealm():void {
 openingCohort=Symbol();
 for(const tx of [...activeTransactions])try{tx.abort();}catch{/* Native committed winner is preserved. */}
 for(const ref of [...connections]){const db=ref.deref();if(db)closeDatabase(db);else connections.delete(ref);}
}
/** Only a live composition policy can revalidate recoverable local admission.
 * The special open cannot upgrade, even if a caller accidentally allows it. */
export async function revalidateDatabaseRealm():Promise<void> {
 if(localState&&fatal(localState))deniedUse();
 if(!admissionPolicies.size)deniedUse();
 for(const policy of admissionPolicies){let allowed=false;try{allowed=policy.revalidate?.()===true;}catch{/* closed */}if(!allowed)deniedUse();}
 const db=await openDatabaseInternal(true);closeDatabase(db);
}
const stores = ['assets', 'chunks', 'jobs', 'tickets', 'settings', 'tracks', 'playlists'] as const;
/** Synchronous additive steps in the native versionchange transaction: no external work. */
function migrateDatabase(db:IDBDatabase,oldVersion:number):void {
  if (oldVersion < 1) {
    for (const store of stores) if (store !== 'tickets' && !db.objectStoreNames.contains(store)) db.createObjectStore(store);
  }
  if (oldVersion < 2) {
    for (const store of stores) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
  }
}
// A blocked acquisition invalidates opens that were already queued in this realm.
// Newly issued calls belong to a new cohort; main gates them behind explicit retry.
let openingCohort=Symbol();
export function openDatabase(): Promise<IDBDatabase> {return openDatabaseInternal(false);}
/** Open the existing schema only; this request cannot create or migrate it. */
export function openExistingDatabase(): Promise<IDBDatabase> {return openDatabaseInternal(false,true);}
function openDatabaseInternal(revalidating:boolean,existingOnly=false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let pending = true;
    const cohort=openingCohort;
    const blockedFailure=()=>AppFailure.create(makeFailure('open','storage-unavailable','database-blocked','idb'));
    // Promise rejection does not cancel an IDBOpenDBRequest. Retain ownership until
    // its native terminal event, even after the acquisition has been rejected.
    const finishFailure = (error:unknown) => {
      if (!pending) return;
      pending = false;
      const incompatible = nativeDOMName(error) === 'VersionError';
      reject(AppFailure.create(incompatible
        ? makeFailure('open','storage-unavailable','storage-unavailable','idb')
        : fromKnownError(error,{phase:'open',backend:'idb'})));
      if (incompatible) notifyLifecycle('version-incompatible');
    };
    const denied=localState&&fatal(localState)?blockedFailure():openAdmissionFailure('open');if(denied){finishFailure(denied);return;}
    let req:IDBOpenDBRequest;
    try { req = indexedDB.open(DATABASE, 2); }
    catch (error) { finishFailure(error); return; }
    req.onupgradeneeded = event => {
      try {
        // Terminal rejection requires an explicit retry; never mutate schema later.
        const denied=cohort!==openingCohort||revalidating||existingOnly?blockedFailure():openAdmissionFailure('upgrade');
        if (!pending || denied) {
          if(pending)finishFailure(denied!);
          req.transaction!.abort();return;
        }
        migrateDatabase(req.result,event.oldVersion);
      } catch (error) {
        finishFailure(error);
        try { req.transaction?.abort(); } catch { /* Preserve the first failure. */ }
      }
    };
    req.onerror = () => {
      try { finishFailure(req.error); } catch (error) { finishFailure(error); }
    };
    req.onblocked = () => {
      if (!pending) return;
      const currentCohort=cohort===openingCohort;
      if(currentCohort)openingCohort=Symbol();
      finishFailure(blockedFailure());
      if(currentCohort)notifyLifecycle('blocked');
    };
    req.onsuccess = () => {
      let db:IDBDatabase|undefined;
      try {
        db = req.result;
        const retryLive=!revalidating||[...admissionPolicies].every(policy=>{try{return policy.revalidate?.()===true;}catch{return false;}});
        const denied=cohort!==openingCohort||!retryLive?blockedFailure():openAdmissionFailure('deliver');
        if (!pending || denied) {
          if(pending)finishFailure(denied!);
          closeDatabase(db);return;
        }
        const delivered = db;
        delivered.onversionchange = () => {
          // Root must invalidate mutation admission synchronously before close.
          try { notifyLifecycle('versionchange'); } finally { closeDatabase(delivered); }
        };
        delivered.addEventListener('close',()=>{closeDatabase(delivered);notifyLifecycle('connection-closed');},{once:true});
        for(const ref of connections)if(!ref.deref())connections.delete(ref);
        const ref=new WeakRef(delivered);connections.add(ref);connectionRefs.set(delivered,ref);
        // Ordinary DOM retry still obeys its existing root open guard. Worker
        // policies never reopen after revocation and always deny upgrade.
        if(localState&&!fatal(localState))localState=null;
        pending = false;
        resolve(delivered);
      } catch (error) {
        try { if(db)closeDatabase(db); } finally { finishFailure(error); }
      }
    };
  });
}
export async function readRecord<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  try { const tx = admittedTransaction(db,store); const done = committed(tx); void done.catch(()=>{}); const result = await request(tx.objectStore(store).get(key)); await done; assertDatabaseUse('read'); return result; }
  finally { closeDatabase(db); }
}
export async function writeRecord(store: string, key: IDBValidKey, value: unknown) {
  const db = await openDatabase();
  try { const tx = admittedTransaction(db,store, 'readwrite'); const done = committed(tx); tx.objectStore(store).put(value, key); await done; }
  finally { closeDatabase(db); }
}
