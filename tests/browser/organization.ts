// Chromium sandboxed, ephemeral loopback; owned synthetic WAV only. No production build,
// service 4175, external network, credentials or iPhone evidence.
// node scripts/browser-build.mjs organization
// node scripts/run-browser-tests.mjs organization > .local/organization-browser-evidence.json
import {exportOrganization,previewOrganization,applyOrganization,inspectOrganizationApply,startOrganizationRecovery,OrganizationBackupError,type OrganizationPreview} from '../../src/library/organization-backup';
import {parseOrganization,serializeOrganization,type OrganizationExport,type OrganizationRef} from '../../src/library/organization-format';
import {all,editTrack,verifiedAsset,type Track,type Playlist} from '../../src/library/library';
import {openDatabase,readRecord,writeRecord} from '../../src/storage/database';
import {transactionDone} from '../../src/storage/transaction-done';
import {WRITER_LOCK} from '../../src/storage/asset-reader';
import {Player} from '../../src/playback/player';
import {importFile} from '../../src/imports/import-file';
const params=new URLSearchParams(location.search);
if(params.has('inspect')){
 parent.postMessage({organizationInspection:await inspectOrganizationApply(params.get('inspect')!)},location.origin);
}else{
 const results:string[]=[];
 function assert(v:unknown,m:string):asserts v {if(!v)throw new Error(m);}
 async function check(name:string,fn:()=>Promise<void>){try{await reset();await fn();results.push(`PASS ${name}`);}catch(e){results.push(`FAIL ${name}: ${e instanceof Error?e.message:'unknown'}`);}document.querySelector('#results')!.textContent=results.join('\n');}
 async function error(fn:()=>Promise<unknown>,code:string){try{await fn();throw new Error(`expected ${code}`);}catch(e){assert(e instanceof OrganizationBackupError && e.code===code,`expected ${code}, got ${e instanceof Error?e.message:'unknown'}`);return e;}}
 async function reset(){const db=await openDatabase();try{const tx=db.transaction([...db.objectStoreNames],'readwrite'),done=transactionDone(tx);for(const n of [...db.objectStoreNames])tx.objectStore(n).clear();await done;}finally{db.close();}}
 const id=()=>crypto.randomUUID();
 const ref=(libraryId:string=id(),trackId:string=id()):OrganizationRef=>({libraryId,id:trackId});
 const blob=(b:OrganizationExport)=>new Blob([serializeOrganization(b)]);
 const raw=(b:unknown)=>new Blob([JSON.stringify(b)]);
 function backup(n=2):OrganizationExport {const libraryId=id();const tracks=Array.from({length:n},(_,i)=>({ref:ref(libraryId),title:`Canción ${i}`,artist:null,album:null,duration:1,createdAt:'2026-10-31T00:00:00.000Z',manualOverrides:{},audio:null}));return {format:'pulso-web-organization',version:1,exportId:id(),libraryId,exportedAt:'2026-10-31T00:00:00.000Z',tracks,favorites:tracks.length?[tracks[0].ref]:[],playlists:[{ref:ref(libraryId),name:'Lista <b>texto</b>',entries:tracks.map(t=>({id:id(),track:t.ref}))}]};}
 async function seed(){const t:Track={id:id(),assetId:null,title:'Local',artist:null,album:null,duration:1,favorite:true,revision:1,createdAt:'2026-10-31T00:00:00.000Z',manualOverrides:{}};await writeRecord('tracks',t.id,t);const p:Playlist={id:id(),name:'Local lista',entries:[{id:id(),trackId:t.id}],revision:1};await writeRecord('playlists',p.id,p);return {t,p};}
 async function state(){return {tracks:await all<Track>('tracks'),playlists:await all<Playlist>('playlists'),assets:await all('assets'),chunks:await all('chunks'),tickets:await all('tickets'),jobs:await all('jobs'),queue:await readRecord('settings','playback')};}
 async function freshInspect(operationId:string){const frame=document.createElement('iframe');const result=new Promise<{state:string;operationId:string}>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('inspection timeout')),5000);function receive(e:MessageEvent){if(e.source!==frame.contentWindow||e.origin!==location.origin||!e.data.organizationInspection)return;clearTimeout(timer);window.removeEventListener('message',receive);resolve(e.data.organizationInspection);}window.addEventListener('message',receive);});frame.src=`organization.html?inspect=${encodeURIComponent(operationId)}`;document.body.append(frame);try{return await result;}finally{frame.remove();}}
 await check('same origin: persistent library UUID, allowlist export, roundtrip and retry idempotence',async()=>{
  const {t}=await seed();await writeRecord('settings','session',{secret:'PRIVATE_SENTINEL'});await writeRecord('settings','artwork',new Blob(['IMAGE_SENTINEL']));
  await writeRecord('tracks',t.id,{...t,privateRef:'PRIVATE_SENTINEL',lyrics:'LYRICS_SENTINEL',storageKey:'KEY_SENTINEL'});
  const a=await exportOrganization(),b=await exportOrganization(),text=await a.text(),d=parseOrganization(text);
  assert(d.libraryId===parseOrganization(await b.text()).libraryId,'unstable identity');assert(!/SENTINEL|assetId|revision|organizationRef/.test(text),'private data exported');
  const before=await state(),p=await previewOrganization(a);assert(p.canApply&&p.counts.newTracks===0,'preview');
  assert((await applyOrganization(p.planId)).state==='committed','commit');assert((await applyOrganization(p.planId)).state==='already-committed','retry');assert(JSON.stringify(before)===JSON.stringify(await state()),'roundtrip modified records');
  assert((await freshInspect(p.operationId)).state==='committed','receipt not durable');
 });
 await check('clean origin restores references, favorites once and playlists; audio remains null',async()=>{
  const b=backup(),p=await previewOrganization(blob(b));const base=await state();await applyOrganization(p.planId);const s=await state();
  assert(s.tracks.length===2&&s.tracks.every(t=>t.assetId===null)&&s.tracks.filter(t=>t.favorite).length===1,'faked audio/favorites');assert(s.playlists[0].entries.every(e=>s.tracks.some(t=>t.id===e.trackId)),'relationships');assert(s.assets.length===base.assets.length&&!s.chunks.length&&!s.tickets.length&&!s.jobs.length,'audio side effects');
  const re=parseOrganization(await(await exportOrganization()).text());assert(JSON.stringify(re.tracks.map(t=>JSON.stringify(t.ref)).sort())===JSON.stringify(b.tracks.map(t=>JSON.stringify(t.ref)).sort()),'portable identity lost');assert(p.warnings.length===2,'missing fingerprint warning');
 });
 await check('keep-local default and explicit use-backup per entity; intentional repeat restoration',async()=>{
  const {t,p}=await seed(),saved=await exportOrganization(),b=parseOrganization(await saved.text());
  await editTrack(t.id,1,{title:'Edición',favorite:false});await writeRecord('playlists',p.id,{...p,name:'Edición lista',revision:2});
  const keep=await previewOrganization(saved);assert(keep.conflicts.length===2&&keep.conflicts.every(c=>c.choice==='keep-local'),'default choices');await applyOrganization(keep.planId);assert((await readRecord<Track>('tracks',t.id))?.title==='Edición','keep overwritten');
  const use=await previewOrganization(saved,Object.fromEntries(keep.conflicts.map(c=>[c.key,'use-backup' as const])));await applyOrganization(use.planId);const now=await readRecord<Track>('tracks',t.id);assert(now?.title==='Local'&&now.favorite&&(await readRecord<Playlist>('playlists',p.id))?.name==='Local lista','restore');
  await editTrack(t.id,now!.revision,{title:'Otra edición'});const again=await previewOrganization(blob(b),{['track:'+b.tracks[0].ref.libraryId+'/'+b.tracks[0].ref.id]:'use-backup'});assert(again.operationId!==use.operationId,'reused operation intent');await applyOrganization(again.planId);assert((await readRecord<Track>('tracks',t.id))?.title==='Local','receipt blocked conscious restore');
 });
 await check('UUID collisions remap tracks/playlists and relationships, equal fingerprints do not merge',async()=>{
  const {t,p}=await seed(),b=backup();b.tracks[0].ref.id=t.id;b.playlists[0].ref.id=p.id;
  b.tracks.forEach(t=>t.audio={algorithm:'sha256',sha256:'a'.repeat(64),bytes:100});const plan=await previewOrganization(blob(b));await applyOrganization(plan.planId);
  const tracks=await all<Track>('tracks'),lists=await all<Playlist>('playlists');assert(tracks.length===3&&lists.length===2,'merged identities');const restored=tracks.find(x=>x.organizationRef?.id===t.id)!;assert(restored.id!==t.id&&restored.assetId===null,'collision not remapped');assert(lists.find(x=>x.organizationRef?.id===p.id)?.entries[0].trackId===restored.id,'remap relationship');
 });
 await check('same reference with different known fingerprint blocks even use-backup',async()=>{
  const b=backup(1);b.tracks[0].audio={algorithm:'sha256',sha256:'a'.repeat(64),bytes:10};await applyOrganization((await previewOrganization(blob(b))).planId);
  const changed={...b,exportId:id(),tracks:b.tracks.map(t=>({...t,title:'Cambio',audio:{algorithm:'sha256' as const,sha256:'b'.repeat(64),bytes:10}}))};
  const key='track:'+b.tracks[0].ref.libraryId+'/'+b.tracks[0].ref.id,plan=await previewOrganization(blob(changed),{[key]:'use-backup'});assert(!plan.canApply&&plan.warnings.some(w=>w.startsWith('fingerprint-conflict')),'not blocked');const before=await state();await error(()=>applyOrganization(plan.planId),'fingerprint-conflict');assert(JSON.stringify(await state())===JSON.stringify(before),'partial blocked application');
 });
 for(const change of ['edit','add','delete','asset-repair'] as const)await check(`full snapshot CAS rejects ${change} by prior writer without epoch`,async()=>{
  const {t}=await seed();await writeRecord('assets','legacy-fixture',{id:'legacy-fixture',bytes:123,revision:1});const p=await previewOrganization(blob(backup()));
  if(change==='edit')await editTrack(t.id,1,{title:'New'});
  if(change==='add')await writeRecord('tracks',id(),{...t,id:id()});
  if(change==='delete'){const db=await openDatabase();const tx=db.transaction('tracks','readwrite'),done=transactionDone(tx);tx.objectStore('tracks').delete(t.id);await done;db.close();}
  if(change==='asset-repair')await writeRecord('assets','legacy-fixture',{id:'legacy-fixture',bytes:123,revision:2});
  const before=await state();await error(()=>applyOrganization(p.planId),'stale-preview');assert(JSON.stringify(await state())===JSON.stringify(before),'partial stale');
 });
 await check('theme and playback position do not invalidate; queue/tickets/kept data preserved',async()=>{
  await seed();await writeRecord('assets','fixture',{id:'fixture',legacy:true});await writeRecord('tickets','sentinel',{opaque:'ticket'});await writeRecord('chunks',['kept',0],new Uint8Array([1,2,3]));const p=await previewOrganization(blob(backup()));
  await writeRecord('settings','theme','dark');await writeRecord('settings','playback',{position:33,entries:['A','B','A']});const before=await state();await applyOrganization(p.planId);const after=await state();assert(JSON.stringify(before.queue)===JSON.stringify(after.queue)&&JSON.stringify(before.assets)===JSON.stringify(after.assets)&&JSON.stringify(before.chunks)===JSON.stringify(after.chunks)&&JSON.stringify(before.tickets)===JSON.stringify(after.tickets),'unrelated state changed');
 });
 await check('legacy unrelated fixture manifests ignored; missing manifest fingerprint warns audio:null',async()=>{
  const {t}=await seed();await writeRecord('tracks',t.id,{...t,assetId:id()});await writeRecord('assets','tone-a',{id:'tone-a',kind:'fixture',bytes:100});const b=parseOrganization(await(await exportOrganization()).text());assert(b.tracks[0].audio===null,'invented manifest');assert((await previewOrganization(blob(b))).warnings.length===1,'missing warning');
 });
 await check('corrupt local metadata/relationships fails actionably, never omits/truncates',async()=>{
  const {t}=await seed();await writeRecord('tracks',t.id,{...t,title:''});await error(exportOrganization,'local-corrupt');await writeRecord('tracks',t.id,t);const p=(await all<Playlist>('playlists'))[0];await writeRecord('playlists',p.id,{...p,entries:[{id:id(),trackId:id()}]});await error(()=>previewOrganization(blob(backup())),'local-corrupt');
 });
 await check('malformed/future/secret fields/invalid relations and fatal UTF8 rejected before IDB',async()=>{
  const before=await state();await error(()=>previewOrganization(new Blob(['{'])),'format');await error(()=>previewOrganization(raw({...backup(),version:2})),'version');await error(()=>previewOrganization(raw({...backup(),session:'secret'})),'format');const b=backup();b.playlists[0].entries[0].track=ref();await error(()=>previewOrganization(raw(b)),'relations');await error(()=>previewOrganization(new Blob([new Uint8Array([0xff,0xfe])])),'format');assert(JSON.stringify(before)===JSON.stringify(await state()),'invalid input mutated');
 });
 await check('8 MiB checked before read; hostile names remain inert text; closed DTO fields',async()=>{
  const huge=new Blob([new Uint8Array(8*1024*1024+1)]);huge.arrayBuffer=()=>{throw new Error('should not read');};await error(()=>previewOrganization(huge),'limits');
  const b=backup(1);b.tracks[0].title='<img src=x onerror="window.ATTACK=1">';await applyOrganization((await previewOrganization(blob(b))).planId);assert((await all<Track>('tracks'))[0].title===b.tracks[0].title&&!(window as unknown as {ATTACK?:number}).ATTACK,'executed markup');
  for(const key of ['storageKey','lyrics','artwork','ticket','sourceReference']){const c=backup();Object.assign(c.tracks[0],{[key]:'not allowed'});await error(()=>previewOrganization(raw(c)),'format');}
 });
 await check('exportId reused with changed payload rejected both before and after commit',async()=>{
  const b=backup(),a=await previewOrganization(blob(b));const changed={...b,tracks:b.tracks.map(t=>({...t,title:'altered'}))};await error(()=>previewOrganization(blob(changed)),'export-reused');await applyOrganization(a.planId);await error(()=>previewOrganization(blob(changed)),'export-reused');
 });
 await check('plans private, bounded at eight, cannot tamper with preview or submit JSON',async()=>{
  const b=backup(),first=await previewOrganization(blob(b));for(let i=0;i<8;i++)await previewOrganization(blob(b));await error(()=>applyOrganization(first.planId),'plan-expired');await error(()=>applyOrganization(JSON.stringify(first)),'plan-expired');const p=await previewOrganization(blob(b));p.canApply=false;p.operationId='forged';p.counts.newTracks=0;await applyOrganization(p.planId);assert((await all<Track>('tracks')).length===2,'public mutation affected private plan');await error(()=>previewOrganization(blob(backup()),{arbitrary:'use-backup'}),'invalid-choice');
 });
 await check('writer lock ifAvailable prevents waiting or racing; unresolved imports gate writes',async()=>{
  const p=await previewOrganization(blob(backup()));await navigator.locks.request(WRITER_LOCK,async()=>{await error(()=>applyOrganization(p.planId),'busy');assert((await inspectOrganizationApply(p.operationId)).state==='uncertain','absence during lock');});
  await writeRecord('jobs','unresolved',{operationId:id(),state:'uncertain'});await error(()=>applyOrganization(p.planId),'imports-unresolved');assert(!(await all('tracks')).length,'gate wrote');
 });
 for(const mode of ['sync-quota','async-quota','sync-abort','async-abort'] as const)await check(`${mode}: all entity writes plus receipt roll back together`,async()=>{
  const p=await previewOrganization(blob(backup(3))),before=await state(),put=IDBObjectStore.prototype.put;let writes=0;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='tracks'&&++writes===2){
   if(mode==='sync-quota')throw new DOMException('injected','QuotaExceededError');
   const tx=this.transaction;if(mode==='async-quota')Object.defineProperty(tx,'error',{value:new DOMException('injected','QuotaExceededError')});
   if(mode.startsWith('async'))queueMicrotask(()=>tx.abort());else tx.abort();
  }return put.apply(this,args);};
  try{await error(()=>applyOrganization(p.planId),mode.includes('quota')?'quota':'storage');}finally{IDBObjectStore.prototype.put=put;}
  assert(JSON.stringify(before)===JSON.stringify(await state()),'partial entities');assert((await freshInspect(p.operationId)).state==='not-committed','receipt without entities');
 });
 await check('cancel before and during writes rolls back; successful retry same plan commits',async()=>{
  const p=await previewOrganization(blob(backup())),c=new AbortController();c.abort();await error(()=>applyOrganization(p.planId,c.signal),'cancelled');
  const running=new AbortController(),put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const r=put.apply(this,args);if(this.name==='tracks')running.abort();return r;};
  try{await error(()=>applyOrganization(p.planId,running.signal),'cancelled');}finally{IDBObjectStore.prototype.put=put;}
  assert(!(await all('tracks')).length&&(await inspectOrganizationApply(p.operationId)).state==='not-committed','cancel partial');await applyOrganization(p.planId);assert((await all('tracks')).length===2,'retry');
 });
 // Replaces only acknowledgement delivery, after the REAL IDB commit/abort event.
 async function interceptAck(p:OrganizationPreview,mode:'cancel'|'lost'|'uncertain'){
  const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!,open=indexedDB.open,c=new AbortController();let armed=true;
  Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(this:IDBTransaction,cb:((e:Event)=>void)|null){const tx=this;descriptor.set!.call(tx,tx.mode==='readwrite'&&tx.objectStoreNames.contains('tracks')&&armed?function(e:Event){armed=false;if(mode==='cancel')c.abort();if(mode==='uncertain')indexedDB.open=()=>{throw new Error('reopen unavailable');};if(mode==='cancel')cb?.call(tx,e);else tx.onabort?.call(tx,new Event('abort'));}:cb);}});
  try{return await applyOrganization(p.planId,c.signal);}finally{Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);indexedDB.open=open;}
 }
 await check('cancel after actual commit reports completed and never deletes committed entities',async()=>{
  const p=await previewOrganization(blob(backup()));assert((await interceptAck(p,'cancel')).state==='committed','late cancel');assert((await all('tracks')).length===2,'late deletion');
 });
 await check('lost commit acknowledgement reopens receipt before retry; module reload inspection',async()=>{
  const p=await previewOrganization(blob(backup()));assert((await interceptAck(p,'lost')).state==='committed','lost ack not resolved');assert((await applyOrganization(p.planId)).state==='already-committed','duplicate');assert((await freshInspect(p.operationId)).state==='committed'&&(await all('tracks')).length===2,'durability');
 });
 await check('unavailable reopen gives uncertain operationId; inspect resolves after storage returns',async()=>{
  const p=await previewOrganization(blob(backup()));const e=await error(()=>interceptAck(p,'uncertain'),'uncertain');assert(e.operationId===p.operationId,'unsafe operation id');assert((await freshInspect(p.operationId)).state==='committed','cannot resolve uncertain');assert((await applyOrganization(p.planId)).state==='already-committed','repeated uncertain commit');
  assert((await inspectOrganizationApply(id())).state==='uncertain','invented unknown absence');
 });
 await check('receipt absent in matching incarnation proves not committed; DB loss remains uncertain',async()=>{
  const p=await previewOrganization(blob(backup()));assert((await freshInspect(p.operationId)).state==='not-committed','absence proof');await reset();assert((await freshInspect(p.operationId)).state==='uncertain','DB loss treated as absence');
 });
 function wav(){const b=new ArrayBuffer(8044),v=new DataView(b);const str=(p:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,b.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,8000,true);for(let i=44;i<b.byteLength;i+=2)v.setInt16(i,Math.sin(i/10)*12000,true);return new File([b],'Propia.wav',{type:'audio/wav'});}
 for (const backend of ['idb','opfs'] as const) for (const decision of ['equal','keep-local','use-backup'] as const) await check(backend+': same reference missing fingerprint '+decision+' survives reexport and original reimport',async()=>{
  const f=wav(),audio={algorithm:'sha256' as const,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join(''),bytes:f.size},b=backup(1);
  b.tracks[0].audio=audio;
  await applyOrganization((await previewOrganization(blob(b))).planId);
  const original=(await all<Track>('tracks'))[0],lists=await all('playlists');
  const local={...original,audioFingerprint:null,...(decision==='equal'?{}:{title:'Local metadata',manualOverrides:{title:'Local metadata'}})};
  await writeRecord('tracks',local.id,local);
  const choices=decision==='equal'?{}:{['track:'+b.libraryId+'/'+b.tracks[0].ref.id]:decision};
  const plan=await previewOrganization(blob(b),choices);
  assert(plan.canApply&&plan.conflicts.length===(decision==='equal'?0:1),'wrong conflict');
  await applyOrganization(plan.planId);
  const enriched=(await all<Track>('tracks'))[0];
  assert(enriched.assetId===null&&enriched.audioFingerprint?.sha256===audio.sha256,'missing recovery fingerprint or fabricated bytes');
  assert(enriched.title===(decision==='keep-local'?'Local metadata':original.title),'metadata decision');
  assert(enriched.revision===local.revision+1,'fingerprint-only write missing');
  const exported=await exportOrganization();assert(parseOrganization(await exported.text()).tracks[0].audio?.sha256===audio.sha256,'reexport lost fingerprint');
  await applyOrganization((await previewOrganization(exported)).planId);
  const imported=await importFile(f,new AbortController().signal,()=>{},{backend});
  const tracks=await all<Track>('tracks');assert(tracks.length===1&&tracks[0].id===original.id&&tracks[0].assetId===imported.track.assetId,'duplicate or lost identity');
  assert(tracks[0].favorite&&tracks[0].title===enriched.title&&JSON.stringify(lists)===JSON.stringify(await all('playlists')),'organization detached');
 });
 await check('explicit new-store recovery preserves unknown history and data; old plan cannot replay',async()=>{
  const old=await previewOrganization(blob(backup()));
  await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('pulso-web-local-v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('delete blocked'));});
  const {t}=await seed(),before=await state();
  const missing=await inspectOrganizationApply(old.operationId);assert(missing.state==='uncertain'&&missing.reason==='original-library-unavailable','missing incarnation not distinguished');
  const recovery=await startOrganizationRecovery(old.operationId);assert(recovery.state==='uncertain'&&recovery.operationId===old.operationId,'history falsely resolved');
  assert(JSON.stringify(before)===JSON.stringify(await state()),'recovery deleted music');
  await error(()=>applyOrganization(old.planId),'plan-expired');
  const again=await inspectOrganizationApply(old.operationId);assert(again.state==='uncertain'&&again.reason==='original-library-unavailable','historical result changed');
  const next=await previewOrganization(blob(backup()));assert(next.operationId.split(':')[0]!==old.operationId.split(':')[0],'same incarnation');await applyOrganization(next.planId);
  assert((await readRecord<Track>('tracks',t.id))?.id===t.id,'new restoration removed unrelated data');
  assert((await inspectOrganizationApply(old.operationId)).state==='uncertain','false not committed after new restore');
 });
 await check('same incarnation uncertain or active writer cannot enable new-store recovery; rechecks changed incarnation',async()=>{
  const p=await previewOrganization(blob(backup()));
  await writeRecord('settings','organization-backup:v1:receipt:'+p.operationId,{broken:true});
  const uncertain=await inspectOrganizationApply(p.operationId);assert(uncertain.state==='uncertain'&&!uncertain.reason,'unsafe recovery reason');
  await error(()=>startOrganizationRecovery(p.operationId),'uncertain');
  await navigator.locks.request(WRITER_LOCK,async()=>{assert(!(await inspectOrganizationApply(p.operationId)).reason,'busy recovery reason');await error(()=>startOrganizationRecovery(p.operationId),'busy');});
  await reset();assert((await inspectOrganizationApply(p.operationId)).reason==='original-library-unavailable','missing reason');
  await writeRecord('settings','organization-backup:v1:library',p.operationId.split(':')[0]);
  await error(()=>startOrganizationRecovery(p.operationId),'uncertain');
 });
 for(const backend of ['idb','opfs'] as const)await check(`${backend}: clean restore reimport existing pipeline links exact fingerprint preserving organization`,async()=>{
  const f=wav(),fingerprint={algorithm:'sha256' as const,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join(''),bytes:f.size},b=backup();b.tracks.forEach(t=>t.audio=fingerprint);
  const p=await previewOrganization(blob(b));await applyOrganization(p.planId);const before=await all<Track>('tracks'),lists=await all('playlists');assert(before.every(t=>t.assetId===null),'restored audio');
  const imported=await importFile(f,new AbortController().signal,()=>{},{backend});const after=await all<Track>('tracks');assert(after.length===2&&after.every(t=>t.assetId===imported.track.assetId),'pipeline failed');assert(after.every((t,i)=>t.title===before[i].title&&t.favorite===before[i].favorite&&t.organizationRef?.id===before[i].organizationRef?.id),'organization overwritten');assert(JSON.stringify(lists)===JSON.stringify(await all('playlists')),'lists overwritten');assert((await all('assets')).length===1,'copies');
  const exported=parseOrganization(await(await exportOrganization()).text());assert(exported.tracks.every(t=>t.audio?.sha256===fingerprint.sha256),'lost fingerprint');
 });

 await check('combined 5000-track/500-list/50000-entry limits fail without truncation',async()=>{
  async function putLibrary(b:OrganizationExport){const db=await openDatabase();try{const tx=db.transaction(['tracks','playlists'],'readwrite'),done=transactionDone(tx);for(const t of b.tracks)tx.objectStore('tracks').put({id:t.ref.id,assetId:null,organizationRef:t.ref,title:t.title,artist:t.artist,album:t.album,duration:t.duration,createdAt:t.createdAt,manualOverrides:t.manualOverrides,favorite:false,revision:1},t.ref.id);for(const p of b.playlists)tx.objectStore('playlists').put({id:p.ref.id,organizationRef:p.ref,name:p.name,entries:p.entries.map(e=>({id:e.id,trackId:e.track.id})),revision:1},p.ref.id);await done;}finally{db.close();}}
  const many=backup(5000);many.playlists=[];await putLibrary(many);await error(()=>previewOrganization(blob(backup(1))),'limits');assert((await all('tracks')).length===5000,'track truncation');
  await reset();const lists=backup(0);lists.playlists=Array.from({length:500},()=>({ref:ref(lists.libraryId),name:'Lista',entries:[]}));await putLibrary(lists);await error(()=>previewOrganization(blob(backup(0))),'limits');assert((await all('playlists')).length===500,'list truncation');
  await reset();const entries=backup(1000);entries.playlists=[{ref:ref(entries.libraryId),name:'Keep local',entries:[{id:id(),track:entries.tracks[0].ref}]}];await putLibrary(entries);
  const incoming={...entries,exportId:id(),playlists:Array.from({length:50},()=>({ref:ref(entries.libraryId),name:'Imported',entries:entries.tracks.map(t=>({id:id(),track:t.ref}))}))};
  const incomingBlob=blob(incoming);assert(incomingBlob.size<8*1024*1024,'fixture exceeded file budget');await error(()=>previewOrganization(incomingBlob),'limits');assert((await all<Playlist>('playlists'))[0].entries.length===1,'entry truncation');
 });
 await check('bounded settings snapshot never materializes artwork or unrelated settings',async()=>{
  await seed();await writeRecord('settings','artwork',new Blob([new Uint8Array(1024*1024)]));
  const getAll=IDBObjectStore.prototype.getAll, cursor=IDBObjectStore.prototype.openCursor;
  IDBObjectStore.prototype.getAll=function(...args:Parameters<IDBObjectStore['getAll']>){assert(this.name!=='settings','settings getAll');return getAll.apply(this,args);};
  IDBObjectStore.prototype.openCursor=function(...args:Parameters<IDBObjectStore['openCursor']>){if(this.name==='settings')assert(args[0] instanceof IDBKeyRange && String(args[0].lower).startsWith('organization-backup:v1:'),'unbounded settings cursor');return cursor.apply(this,args);};
  try{const b=await exportOrganization();await previewOrganization(b);}finally{IDBObjectStore.prototype.getAll=getAll;IDBObjectStore.prototype.openCursor=cursor;}
 });
 await check('use-backup preserves real kept manifest, bytes, active engine and A/B/A queue',async()=>{
  const f=wav(),r=await importFile(f,new AbortController().signal,()=>{},{backend:'idb'}),t=r.track,saved=await exportOrganization();
  await editTrack(t.id,t.revision,{title:'Current',favorite:true});const preview=await previewOrganization(saved),choices=Object.fromEntries(preview.conflicts.map(c=>[c.key,'use-backup' as const])),plan=await previewOrganization(saved,choices);
  const before=await state(),audio=new Audio(),url=URL.createObjectURL(f),player=new Player(audio);audio.muted=true;audio.loop=true;
  try{player.setQueue(['A','B','A'].map((title,i)=>({id:String(i),trackId:t.id,title,src:url})));player.select(0);await player.play();assert(!audio.paused,'media did not start');const generation=player.generation,queue=JSON.stringify(player.entries),src=audio.src;
   await applyOrganization(plan.planId);assert(!audio.paused&&player.generation===generation&&JSON.stringify(player.entries)===queue&&audio.src===src,'engine/queue altered');
   const after=await state(),now=await readRecord<Track>('tracks',t.id);assert(now?.assetId===t.assetId&&JSON.stringify(before.assets)===JSON.stringify(after.assets)&&JSON.stringify(before.chunks)===JSON.stringify(after.chunks),'kept audio altered');assert(await verifiedAsset(t.assetId,true),'kept integrity');assert(now.title===t.title&&!now.favorite,'backup organization not applied');
  }finally{audio.pause();URL.revokeObjectURL(url);}
 });
 (window as unknown as {pulsoOrganization:unknown}).pulsoOrganization={passed:results.length>25&&results.every(r=>r.startsWith('PASS')),results};
}
