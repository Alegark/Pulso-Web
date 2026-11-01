import {FixtureStore} from '../../src/storage/assets';
import {fixtures} from '../../src/fixtures';
import {readRecord, openDatabase, committed, writeRecord} from '../../src/storage/database';
const results: string[] = [];
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const store = new FixtureStore();
const source = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({start(controller) { for(let i=0;i<bytes.length;i+=777)controller.enqueue(bytes.slice(i,i+777));controller.close(); }});
async function rejects(fn: () => Promise<unknown>) { let failed = false; try { await fn(); } catch { failed = true; } assert(failed,'Se esperaba rechazo'); }
async function check(name: string, fn: () => Promise<void>) { try { await fn(); results.push(`PASS ${name}`); } catch(error) { results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } document.querySelector('#results')!.textContent = results.join('\n'); }
const fixture = {...fixtures[0],id:'browser-test-A'};
const bytes = new Uint8Array(await (await fetch(fixtures[0].file)).arrayBuffer());
await check('publicación y doble reopen íntegros',async()=>{await store.save(fixture,source(bytes),new AbortController().signal); assert(await store.verify(fixture),'verify');assert(await store.verify(fixture),'reopen');});
const original = await readRecord('assets',fixture.id);
await check('truncado no publica ni borra copia válida',async()=>{await rejects(()=>store.save(fixture,source(bytes.slice(0,-1)),new AbortController().signal));assert(JSON.stringify(await readRecord('assets',fixture.id))===JSON.stringify(original),'manifest alterado');assert(await store.verify(fixture),'original perdido');});
await check('hash erróneo no publica',async()=>{const corrupt=bytes.slice();corrupt[0]^=255;await rejects(()=>store.save(fixture,source(corrupt),new AbortController().signal));assert(await store.verify(fixture),'original perdido');});
await check('cancelación no elimina publicación previa',async()=>{const abort=new AbortController();abort.abort();await rejects(()=>store.save(fixture,source(bytes),abort.signal));assert(await store.verify(fixture),'original perdido');});
await check('bytes ausentes producen missing sin borrar manifiesto',async()=>{const manifest=await store.verify(fixture);assert(manifest,'manifest');const db=await openDatabase();const tx=db.transaction('chunks','readwrite');const done=committed(tx);tx.objectStore('chunks').delete([manifest.storageKey,0]);await done;db.close();assert(await store.verify(fixture)===null,'missing');assert(await readRecord('assets',fixture.id),'metadata borrada');});
await check('recuperación explícita reemplaza missing',async()=>{await store.save(fixture,source(bytes),new AbortController().signal);assert(await store.verify(fixture),'recuperación');});
await check('cancelación después del primer commit de chunk conserva original',async()=>{
 const abort=new AbortController();const put=IDBObjectStore.prototype.put;let wrote=false;
 IDBObjectStore.prototype.put=function(...args: Parameters<IDBObjectStore['put']>){
   const result=put.apply(this,args);
   if(this.name==='chunks'&&!wrote){wrote=true;this.transaction.addEventListener('complete',()=>abort.abort(),{once:true});}return result;
 };
 try{await rejects(()=>store.save(fixture,source(bytes),abort.signal));}finally{IDBObjectStore.prototype.put=put;}
 assert(wrote,'No llegó al commit');assert(await store.verify(fixture),'original perdido');
});
await check('QuotaExceeded en chunks no publica ni borra original',async()=>{
 const before=await readRecord('assets',fixture.id);const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args: Parameters<IDBObjectStore['put']>){if(this.name==='chunks')throw new DOMException('cuota simulada','QuotaExceededError');return put.apply(this,args);};
 try{await rejects(()=>store.save(fixture,source(bytes),new AbortController().signal));}finally{IDBObjectStore.prototype.put=put;}
 assert(JSON.stringify(await readRecord('assets',fixture.id))===JSON.stringify(before),'manifest cambió');assert(await store.verify(fixture),'original perdido');
});
await check('abort de transacción de publicación mantiene revisión previa',async()=>{
 const before=await readRecord('assets',fixture.id);const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args: Parameters<IDBObjectStore['put']>){const result=put.apply(this,args);if(this.name==='assets')this.transaction.abort();return result;};
 try{await rejects(()=>store.save(fixture,source(bytes),new AbortController().signal));}finally{IDBObjectStore.prototype.put=put;}
 assert(JSON.stringify(await readRecord('assets',fixture.id))===JSON.stringify(before),'publicación parcial');assert(await store.verify(fixture),'original perdido');
});
await check('cancelación tardía tras commit no borra asset publicado',async()=>{
 const abort=new AbortController();const put=IDBObjectStore.prototype.put;
 let cancelled!:()=>void;const cancelObserved=new Promise<void>(resolve=>{cancelled=resolve;});
 IDBObjectStore.prototype.put=function(...args: Parameters<IDBObjectStore['put']>){const result=put.apply(this,args);if(this.name==='assets')this.transaction.addEventListener('complete',()=>{abort.abort();cancelled();},{once:true});return result;};
 try{const manifest=await store.save(fixture,source(bytes),abort.signal);await cancelObserved;assert(manifest.state==='complete','no completado');}finally{IDBObjectStore.prototype.put=put;}
 assert(abort.signal.aborted,'cancelación no ocurrió');assert(await store.verify(fixture),'publicación eliminada');
});
await check('manifiesto corrupto rechazado sin bucle ni borrado',async()=>{
 const before=await readRecord<Record<string,unknown>>('assets',fixture.id);assert(before,'original');
 await writeRecord('assets',fixture.id,{...before,chunks:Infinity});assert(await store.verify(fixture)===null,'corrupto aceptado');
 assert(await readRecord('assets',fixture.id),'borrado implícito');await writeRecord('assets',fixture.id,before);assert(await store.verify(fixture),'restauración');
});
(window as unknown as {pulsoTests: unknown}).pulsoTests={results,passed:results.every(x=>x.startsWith('PASS')),userAgent:navigator.userAgent};
document.querySelector('#results')!.textContent += '\nCOMPLETADO';
