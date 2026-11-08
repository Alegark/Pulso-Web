/** Dedicated authorization vault. SDK peer and message storage remains in memory. */
const DB='pulso-web-telegram-session-v1', STORE='authorization', SECRET='session', EPOCH='epoch';
const failure=()=>Error('session-storage');
const epochValue=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
function open(create:boolean):Promise<IDBDatabase|null>{
 return new Promise((resolve,reject)=>{
  let absent=false,settled=false,request:IDBOpenDBRequest;
  try{request=indexedDB.open(DB,1);}catch{reject(failure());return;}
  request.onupgradeneeded=()=>{if(settled||!create){absent=!create;request.transaction?.abort();return;}request.result.createObjectStore(STORE);};
  request.onerror=()=>{settled=true;if(absent)resolve(null);else reject(failure());};
  request.onblocked=()=>{settled=true;reject(failure());};
  request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}settled=true;db.onversionchange=()=>db.close();resolve(db);};
 });
}
async function transaction<T>(create:boolean,mode:IDBTransactionMode,work:(store:IDBObjectStore,set:(value:T)=>void)=>void,empty:T):Promise<T>{
 if(mode==='readwrite'&&typeof navigator!=='undefined'&&navigator.locks){return navigator.locks.request('pulso-web-telegram-session-v1',()=>transactionUnlocked(create,mode,work,empty));}
 return transactionUnlocked(create,mode,work,empty);
}
async function transactionUnlocked<T>(create:boolean,mode:IDBTransactionMode,work:(store:IDBObjectStore,set:(value:T)=>void)=>void,empty:T):Promise<T>{
 const db=await open(create);if(!db)return empty;
 return new Promise((resolve,reject)=>{let result=empty,tx:IDBTransaction;
  try{tx=db.transaction(STORE,mode);}catch{db.close();reject(failure());return;}
  tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(failure());};
  // Native request errors abort the transaction; settle only on its terminal event.
  try{work(tx.objectStore(STORE),value=>{result=value;});}catch{try{tx.abort();}catch{db.close();reject(failure());}}
 });
}
function read(store:IDBObjectStore,key:string,consume:(value:unknown)=>void):void{
 const request=store.get(key);request.onsuccess=()=>{try{consume(request.result);}catch{store.transaction.abort();}};
}
export async function hasSavedTelegramSession():Promise<boolean>{
 return transaction(false,'readonly',(store,set)=>{const r=store.getKey(SECRET);r.onsuccess=()=>set(r.result!==undefined);},false);
}
/** Clears and advances the epoch atomically, invalidating all previously issued leases. */
export async function clearSavedTelegramSession():Promise<void>{
 await transaction(true,'readwrite',store=>{store.put(crypto.randomUUID(),EPOCH);store.delete(SECRET);},undefined);
}
export async function sessionLease():Promise<string>{
 return transaction(true,'readwrite',(store,set)=>{read(store,EPOCH,value=>{if(value!==undefined&&!epochValue(value))throw failure();const epoch=crypto.randomUUID();store.put(epoch,EPOCH);set(epoch);});},'');
}
export async function telegramSessionLeaseCurrent(lease:string):Promise<boolean>{
 if(!epochValue(lease))return false;
 return transaction(false,'readonly',(store,set)=>{read(store,EPOCH,value=>set(value===lease));},false);
}
export async function saveTelegramSession(lease:string,value:string):Promise<boolean>{
 if(!epochValue(lease)||typeof value!=='string'||!value.length||value.length>4096)throw failure();
 return transaction(true,'readwrite',(store,set)=>{read(store,EPOCH,epoch=>{if(epoch===lease){store.put(value,SECRET);set(true);}});},false);
}
export async function loadTelegramSession():Promise<{lease:string;value:string}|null>{
 return transaction<{lease:string;value:string}|null>(false,'readonly',(store,set)=>{read(store,EPOCH,epoch=>read(store,SECRET,value=>{if(value===undefined)return;if(!epochValue(epoch)||typeof value!=='string'||!value.length||value.length>4096)throw failure();set({lease:epoch,value});}));},null);
}
export async function clearTelegramSessionLease(lease:string):Promise<void>{
 await transaction(true,'readwrite',(store)=>{read(store,EPOCH,value=>{if(value===lease){store.put(crypto.randomUUID(),EPOCH);store.delete(SECRET);}});},undefined);
}
