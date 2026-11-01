import {authorizeRealmFixture,initializeRealmFixture} from './realm-fixture';
import {beginWorkerAttempt} from '../../src/storage/database-realms';
authorizeRealmFixture();await initializeRealmFixture();
import {inspectEmbeddedLyrics,type EmbeddedLyricsInspection} from '../../src/imports/lyrics';
import {readLyrics,setManualLyrics,storeEmbeddedLyrics,LYRICS_PREFIX,LyricsError,lyricsDraft} from '../../src/library/lyrics';
import {importFile} from '../../src/imports/import-file';
import {readRecord,writeRecord} from '../../src/storage/database';
import {verifiedAsset,editTrack,type Track,type LocalAsset,all} from '../../src/library/library';
const results:string[]=[];
function assert(v:unknown,m:string):asserts v{if(!v)throw new Error(m);}
async function check(name:string,fn:()=>Promise<void>){try{await fn();results.push('PASS '+name);}catch(e){results.push('FAIL '+name+': '+(e instanceof Error?e.message:String(e)));}document.querySelector('#results')!.textContent=results.join('\n');}
const utf=(s:string)=>new TextEncoder().encode(s);
const latin=(s:string)=>Uint8Array.from(s,c=>c.charCodeAt(0));
const join=(...parts:Uint8Array[])=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length;}return b;};
const n32=(n:number,le=false)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,le);return b;};
const u32=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p);
const ascii=(b:Uint8Array,p:number,n:number)=>String.fromCharCode(...b.subarray(p,p+n));
const sync=(n:number)=>new Uint8Array([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);
const frame=(id:string,b:Uint8Array,v=4,flags=0)=>join(utf(id),v===4?sync(b.length):n32(b.length),new Uint8Array([0,flags]),b);
const tag=(b:Uint8Array,v=4,flags=0)=>join(utf('ID3'),new Uint8Array([v,0,flags]),sync(b.length),b);
const uslt=(s:string,lang='spa',desc='original')=>join(new Uint8Array([3]),utf(lang),utf(desc),new Uint8Array(1),utf(s));
const syltEvents=(cues:{timeMs:number;text:string}[])=>join(new Uint8Array([3]),utf('spa'),new Uint8Array([2,1,0]),...cues.map(c=>join(utf(c.text),new Uint8Array(1),n32(c.timeMs))));
const sylt=(unit=2,count=2)=>join(new Uint8Array([3]),utf('spa'),new Uint8Array([unit,1,0]),...Array.from({length:count},(_,i)=>join(utf('Línea '+i),new Uint8Array(1),n32(1000+i*500))));
const box=(name:string,body:Uint8Array)=>join(n32(body.length+8),latin(name),body);
const chunk=(name:string,b:Uint8Array)=>join(utf(name),n32(b.length,true),b,new Uint8Array(b.length%2));
const fmt=join(new Uint8Array([1,0,1,0]),n32(8000,true),n32(16000,true),new Uint8Array([2,0,16,0]));
const wav=(id3?:Uint8Array)=>{const body=join(utf('WAVE'),chunk('fmt ',fmt),chunk('data',new Uint8Array(3200)),...(id3?[chunk('ID3 ',id3)]:[]));return new File([utf('RIFF'),n32(body.length,true),body],'original.wav',{type:'audio/wav'});};
const mp3base=new Uint8Array(await(await fetch('/fixtures/A.mp3')).arrayBuffer());
let audioOffset=0;while(ascii(mp3base,audioOffset,3)==='ID3'){const h=mp3base.subarray(audioOffset,audioOffset+10);audioOffset+=10+h[6]*2097152+h[7]*16384+h[8]*128+h[9];}
const mp3=(body:Uint8Array)=>new File([tag(body),mp3base.slice(audioOffset)],'original.mp3',{type:'audio/mpeg'});
const base=new Uint8Array(await(await fetch('/fixtures/B.m4a')).arrayBuffer());
let moov=-1,mdat=-1;for(let p=0;p<base.length;p+=u32(base,p)){if(ascii(base,p+4,4)==='moov')moov=p;if(ascii(base,p+4,4)==='mdat')mdat=p;}
assert(moov>mdat&&mdat>=0&&moov+u32(base,moov)===base.length,'moov final propio');
const parts:Uint8Array[]=[];for(let p=moov+8;p<base.length;p+=u32(base,p))if(ascii(base,p+4,4)!=='udta')parts.push(base.slice(p,p+u32(base,p)));
const utf16be=(s:string)=>{const b=new Uint8Array(s.length*2);for(let i=0;i<s.length;i++)new DataView(b.buffer).setUint16(i*2,s.charCodeAt(i));return b;};
const m4a=(s:string,type=1)=>new File([base.slice(0,moov),box('moov',join(...parts,box('udta',box('meta',join(new Uint8Array(4),box('ilst',box('©lyr',box('data',join(n32(type),n32(0),type===2?utf16be(s):utf(s))))))))))],'original.m4a',{type:'audio/mp4'});
const inspect=(b:Blob,mime='audio/mpeg')=>inspectEmbeddedLyrics(b,mime);
const local=(f:File)=>importFile(f,new AbortController().signal,()=>{},{backend:'idb'});
const hash=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
const ready=(s='Original'):Extract<EmbeddedLyricsInspection,{state:'ready'}>=>({state:'ready',format:'plain',text:s,source:{kind:'embedded-id3',tag:'USLT',language:'spa',descriptor:'propio'},warnings:[]});
async function conflict(fn:()=>Promise<unknown>){let e:unknown;try{await fn();}catch(error){e=error;}assert(e instanceof LyricsError&&e.code==='conflict','expected conflict');}
const syltPersisted:{id:string;cues:{timeMs:number;text:string}[]}[]=[];
const reopening=sessionStorage.getItem('embedded-reopen');
if(reopening){
 const saved=JSON.parse(reopening) as {results:string[];id:string;revision:string;hash:string;sylt?:typeof syltPersisted};sessionStorage.removeItem('embedded-reopen');results.push(...saved.results);
 await check('recarga real conserva letra, procedencia y hash verificado del audio',async()=>{const r=await readLyrics(saved.id);assert(r.state==='ready'&&r.revision===saved.revision&&r.origin?.provenance==='embedded','reload lyrics');const t=await readRecord<Track>('tracks',saved.id);assert(t?.assetId,'track');const a=await verifiedAsset(t.assetId,true);assert(a?.sha256===saved.hash,'reload audio');});
 await check('reapertura SYLT literal y 4000 cues; borrador plain y override manual CAS',async()=>{for(const item of saved.sylt??[]){const r=await readLyrics(item.id);assert(r.state==='ready'&&r.lyrics.kind==='timed'&&JSON.stringify(r.lyrics.cues)===JSON.stringify(item.cues),'persisted events');const draft=lyricsDraft(r.lyrics);assert(draft.format==='plain'&&draft.warning?.includes('retira la sincronización'),'honest draft');const edited=await setManualLyrics(item.id,draft.text,draft.format,r.revision);assert(edited.state==='ready'&&edited.lyrics.kind==='plain'&&edited.lyrics.text===draft.text,'manual override');}});
 (window as unknown as {pulsoEmbeddedLyrics:unknown}).pulsoEmbeddedLyrics={passed:results.every(r=>r.startsWith('PASS')),results};
}else{
await check('USLT Unicode UTF8, UTF16 BOM/BE e ISO8859-1 reales; v2.3/v2.4',async()=>{
 for(const [enc,desc,text,v] of [[3,utf('d'),utf('Niño 😀'),4],[0,latin('d'),latin('Niño'),3],[1,new Uint8Array([255,254,100,0]),new Uint8Array([78,0,105,0,241,0,111,0]),3],[2,new Uint8Array([0,100]),new Uint8Array([0,78,0,105,0,241,0,111]),4]] as const){
  const b=join(new Uint8Array([enc]),utf('spa'),desc,new Uint8Array(enc===1||enc===2?2:1),text);const r=await inspect(new Blob([tag(frame('USLT',b,v),v)]));assert(r.state==='ready'&&r.text.startsWith('Niño')&&r.format==='plain'&&r.source.descriptor==='d','encoding '+enc);
 }
});
await check('SYLT ms se prefiere a USLT; candidatos deterministas conservan idioma/descriptor',async()=>{
 const r=await inspect(new Blob([tag(join(frame('USLT',uslt('Plain','eng','English')),frame('SYLT',sylt()),frame('SYLT',sylt())))]));assert(r.state==='ready'&&r.format==='sylt'&&r.source.tag==='SYLT'&&r.source.language==='spa'&&JSON.stringify(r.cues)===JSON.stringify([{timeMs:1000,text:'Línea 0'},{timeMs:1500,text:'Línea 1'}]),'timed');
 const p=await inspect(new Blob([tag(join(frame('USLT',uslt('Uno','eng','first')),frame('USLT',uslt('Dos'))))]));assert(p.state==='ready'&&p.text==='Uno'&&p.source.descriptor==='first','document order');
});
await check('SYLT frames MPEG nunca se convierte a ms, USLT válido se conserva',async()=>{
 const a=await inspect(new Blob([tag(frame('SYLT',sylt(1)))]));assert(a.state==='not-inspected'&&a.failureCode==='sylt-frames','frames');
 const b=await inspect(new Blob([tag(join(frame('SYLT',sylt(1)),frame('USLT',uslt('Seguro'))))]));assert(b.state==='ready'&&b.format==='plain'&&b.warnings.includes('sylt-frames'),'fallback');
});
await check('WAV ID3 y M4A ©lyr plain/LRC estricto sin tiempos inventados',async()=>{
 const w=await inspect(wav(tag(frame('USLT',uslt('WAV propio')))),'audio/wav');assert(w.state==='ready'&&w.source.kind==='embedded-riff-id3','wav');
 for(const [text,format] of [['Texto propio','plain'],['[00:01.250]M4A propio','lrc']] as const){const r=await inspect(m4a(text),'audio/mp4');assert(r.state==='ready'&&r.format===format&&r.source.tag==='©lyr','m4a');}
 const bad=await inspect(m4a('[00:60]Roto'),'audio/mp4');assert(bad.state==='invalid','invalid LRC');
});
await check('sin letra, formato no inspeccionado, truncados, flags y codificaciones distintos',async()=>{
 const cases:[Blob,string,string][]=[
 [new Blob([tag(frame('TIT2',utf('Propio')))]),'audio/mpeg','absent'],[wav(),'audio/wav','absent'],[new Blob(['other']),'audio/flac','not-inspected'],
 [new Blob([tag(frame('USLT',uslt('x'))).slice(0,-1)]),'audio/mpeg','invalid'],[new Blob([tag(frame('USLT',uslt('x'),4,1))]),'audio/mpeg','not-inspected'],
 [new Blob([tag(frame('USLT',uslt('x')),4,128)]),'audio/mpeg','not-inspected'],[new Blob([tag(frame('USLT',join(new Uint8Array([9]),utf('spa\0x'))))]),'audio/mpeg','not-inspected'],
 [new Blob([tag(frame('USLT',join(new Uint8Array([3]),utf('spa\0'),new Uint8Array([0xc0,0xaf]))))]),'audio/mpeg','invalid'],
 [new Blob([tag(frame('USLT',join(new Uint8Array([1]),utf('spa'),new Uint8Array([255,254,0,0,65]))))]),'audio/mpeg','invalid']];
 for(const [file,mime,state] of cases)assert((await inspect(file,mime)).state===state,'case '+mime+' '+state);
});
await check('payload excesivo se omite antes de leerlo; límites cues/líneas y presupuesto global',async()=>{
 const giant=new Blob([tag(frame('USLT',new Uint8Array(131073)))]);let read=0;const slice=giant.slice.bind(giant);giant.slice=(start,end,type)=>{assert((end??giant.size)-(start??0)<=10,'payload read');read++;return slice(start,end,type);};const r=await inspect(giant);assert(r.state==='omitted'&&read<8,'size');
 for(const frameBytes of [frame('SYLT',sylt(2,4001)),frame('USLT',uslt('\n'.repeat(4001))),frame('USLT',uslt('a'.repeat(8193)))])assert((await inspect(new Blob([tag(frameBytes)]))).state==='omitted','limits');
 const multi=new Blob([tag(join(frame('USLT',uslt(('a'.repeat(1000)+'\n').repeat(70))),frame('USLT',uslt(('b'.repeat(1000)+'\n').repeat(70)))))]);const m=await inspect(multi);assert(m.state==='ready'&&m.warnings.includes('payload-size'),'global budget');
});
await check('audio/padding/APIC grandes se saltan con slices pequeños; walkers acotados',async()=>{
 const lyric=frame('USLT',uslt('Acotado'));const b=new Blob([tag(join(frame('APIC',new Uint8Array(2*1024*1024)),lyric,new Uint8Array(3*1024*1024))),new Uint8Array(4*1024*1024)]);const slice=b.slice.bind(b);let bytes=0;b.slice=(s,e,t)=>{bytes+=(e??b.size)-(s??0);assert((e??b.size)-(s??0)<1024,'large read');return slice(s,e,t);};assert((await inspect(b)).state==='ready'&&bytes<1024,'skips');
 const many=new Blob([tag(join(...Array.from({length:129},()=>frame('TIT2',utf('a')))))]);assert((await inspect(many)).state==='omitted','frames');
 const boxes=new Blob([box('ftyp',utf('M4A \0\0\0\0')), ...Array.from({length:513},()=>box('free',new Uint8Array()))]);assert((await inspect(boxes,'audio/mp4')).state==='omitted','boxes');
});
let persistedId='',persistedRevision='',persistedHash='';
await check('worker real importa MP3 USLT/SYLT, WAV+USLT y M4A+LRC; hash/metadata/organización intactos',async()=>{
 for(const file of [mp3(frame('USLT',uslt('MP3 worker 😀'))),mp3(frame('SYLT',sylt())),wav(tag(frame('USLT',uslt('Worker original')))),m4a('[00:01]M4A worker')]){
 const worker=new Worker(new URL('../../src/imports/import.worker.ts',import.meta.url),{type:'module'});const realm=await beginWorkerAttempt('import',worker,()=>true);let result:{track:Track;lyricsWarning?:string};
 try{result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('worker timeout')),15000);worker.onerror=()=>{clearTimeout(timeout);reject(new Error('worker'));};worker.onmessage=e=>{if(e.data.type==='complete'){clearTimeout(timeout);resolve(e.data.result);}if(e.data.type==='error'){clearTimeout(timeout);reject(new Error(e.data.error));}};worker.postMessage({version:2,type:'import',operationId:crypto.randomUUID(),file});});}finally{worker.terminate();realm.closeAfterSettlement();}
 const t=result.track;assert(!result.lyricsWarning&&t.assetId,'worker result');const r=await readLyrics(t.id);assert(r.state==='ready'&&r.origin?.provenance==='embedded','saved');
 const asset=await verifiedAsset(t.assetId,true);assert(asset?.sha256===await hash(file),'audio hash');persistedId=t.id;persistedRevision=r.revision;persistedHash=asset.sha256;
 }
});
await check('audio exitoso aunque letra inválida/omitida/fallo de guardado; original conservado',async()=>{
 for(const body of [uslt('a'.repeat(8193)),new Uint8Array(131073)]){const file=wav(tag(frame('USLT',body)));const r=await local(file);assert(r.lyricsWarning&&await verifiedAsset(r.track.assetId,true),'audio failure');assert((await readLyrics(r.track.id)).revision===0,'invalid stored');}
 const file=wav(tag(frame('USLT',uslt('Cuota original'))));const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){if(this.name==='settings'&&String(key).startsWith(LYRICS_PREFIX))throw new DOMException('quota','QuotaExceededError');return put.call(this,value,key);};
 try{const r=await local(file);assert(r.lyricsWarning==='quota'&&await verifiedAsset(r.track.assetId,true),'quota audio');}finally{IDBObjectStore.prototype.put=put;}
});
await check('dedup/reimport conserva edición manual y ausencia explícita sin tocar organización/audio',async()=>{
 const file=wav(tag(frame('USLT',uslt('Dedup original')))),first=await local(file);const before=await readLyrics(first.track.id);assert(before.state==='ready','auto');
 const saved=await setManualLyrics(first.track.id,'Elección propia','plain',before.revision);const tracks=JSON.stringify(await all('tracks')),assets=JSON.stringify(await all('assets'));await writeRecord('settings','embedded-org',{favorite:true,entries:[first.track.id]});
 const again=await local(file);assert(again.track.id===first.track.id&&(await readLyrics(first.track.id)).state==='ready','dedup');const r=await readLyrics(first.track.id);assert(r.state==='ready'&&r.lyrics.text==='Elección propia','manual');assert(tracks===JSON.stringify(await all('tracks'))&&assets===JSON.stringify(await all('assets')),'audio metadata');
 await setManualLyrics(first.track.id,null,'plain',saved.revision);await local(file);const absent=await readLyrics(first.track.id);assert(absent.state==='absent'&&typeof absent.revision==='string','hidden');assert(JSON.stringify(await readRecord('settings','embedded-org'))===JSON.stringify({favorite:true,entries:[first.track.id]}),'organization');
});

await check('legacy sin audioFingerprint reimporta exacto y extrae sin falso conflict',async()=>{
 const file=wav(tag(frame('USLT',uslt('Legacy sin huella')))),first=await local(file);
 const legacy={...first.track};delete legacy.audioFingerprint;await writeRecord('tracks',legacy.id,legacy);
 const db=(await import('../../src/storage/database')).openDatabase;const conn=await db();try{const tx=conn.transaction('settings','readwrite');tx.objectStore('settings').delete(LYRICS_PREFIX+legacy.id);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{conn.close();}
 const again=await local(file);const read=await readLyrics(legacy.id);assert(!again.lyricsWarning,'legacy false conflict '+again.lyricsWarning);assert(again.track.id===legacy.id&&read.state==='ready'&&read.lyrics.text==='Legacy sin huella','legacy extraction');assert(JSON.stringify(await readRecord('tracks',legacy.id))===JSON.stringify(legacy),'legacy migrated');
});

await check('SYLT literal exacto y 4000 cues persisten sin reinterpretación; corrupción rechazada',async()=>{
 for(const cues of [[{timeMs:1000,text:'[00:09]Texto literal'},{timeMs:1000,text:'[2026]Texto literal'},{timeMs:2001,text:'e\u0301 😀 [00:03]'}],Array.from({length:4000},(_,i)=>({timeMs:i,text:'[2026]ñ'}))]){
  const imported=await local(mp3(frame('SYLT',syltEvents(cues))));assert(!imported.lyricsWarning,'warning '+imported.lyricsWarning);
  const r=await readLyrics(imported.track.id);assert(r.state==='ready'&&r.lyrics.kind==='timed'&&JSON.stringify(r.lyrics.cues)===JSON.stringify(cues),'exact structured');
  const key=LYRICS_PREFIX+imported.track.id,record=await readRecord<Record<string,unknown>>('settings',key);assert(record?.format==='sylt','stored structured');
  for(const bad of [{cues:[{timeMs:1000,text:'[2026]literal'},{timeMs:999,text:'old'}]},{cues:[{timeMs:0.1,text:'fraction'}]},{cues:[{timeMs:0,text:'x',extra:true}]},{cues:Array.from({length:4001},()=>({timeMs:0,text:'x'}))},{text:'tampered'}]){await writeRecord('settings',key,{...record,...bad});assert((await readLyrics(imported.track.id)).state==='unavailable','invalid read');}
  await writeRecord('settings',key,record);syltPersisted.push({id:imported.track.id,cues});
 }
});
await check('M4A UTF16-BE real; presupuestos compartidos M4A y WAV antes del segundo payload',async()=>{
 const file=m4a('Niño 😀 e\u0301',2),r=await local(file),read=await readLyrics(r.track.id);assert(!r.lyricsWarning&&read.state==='ready'&&read.lyrics.text==='Niño 😀 e\u0301','UTF16 pipeline');
 const text=('a'.repeat(1000)+'\n').repeat(70),data=()=>box('data',join(n32(1),n32(0),utf(text)));
 const mp4=new Blob([box('ftyp',utf('M4A \0\0\0\0')),box('moov',box('udta',box('meta',join(new Uint8Array(4),box('ilst',join(box('©lyr',data()),box('©lyr',data())))))))]);
 const id=tag(frame('USLT',uslt(text))),body=join(utf('WAVE'),chunk('ID3 ',id),chunk('ID3 ',id));const wave=new Blob([utf('RIFF'),n32(body.length,true),body]);
 for(const [file,mime] of [[mp4,'audio/mp4'],[wave,'audio/wav']] as const){const slice=file.slice.bind(file);let payloads=0;file.slice=(start,end,type)=>{if((end??file.size)-(start??0)>1000)payloads++;return slice(start,end,type);};const inspected=await inspect(file,mime);assert(inspected.state==='ready'&&inspected.warnings.includes('payload-size')&&payloads===1,'shared '+mime);}
});
await check('ficha assetId null con manual/ausencia conserva revisión y elección al reimportar exacto',async()=>{
 for(const text of ['Manual de ficha',null]){
  const file=wav(tag(frame('USLT',uslt('Ficha incrustada '+text))));const id=crypto.randomUUID();
  const track:Track={id,assetId:null,audioFingerprint:{algorithm:'sha256',sha256:await hash(file),bytes:file.size},title:'Ficha propia',artist:null,album:null,duration:0.2,favorite:true,manualOverrides:{title:'Ficha propia'},revision:1,createdAt:new Date().toISOString()};await writeRecord('tracks',id,track);
  const manual=await setManualLyrics(id,text,'plain',0),imported=await local(file),read=await readLyrics(id);assert(!imported.lyricsWarning&&imported.track.id===id&&read.revision===manual.revision,'relinked manual');assert(text===null?read.state==='absent':read.state==='ready'&&read.lyrics.text===text,'manual choice');assert(imported.track.favorite&&imported.track.title===track.title,'organization');
 }
});
await check('manual durante extracción y dos respuestas antiguas: CAS impide sobreescritura',async()=>{
 const t=(await local(wav())).track;assert(t.assetId,'asset');const a=await readRecord<LocalAsset>('assets',t.assetId);assert(a,'asset');
 let release!:(r:EmbeddedLyricsInspection)=>void;let started!:()=>void;const began=new Promise<void>(r=>started=r);
 const pending=storeEmbeddedLyrics(t.id,a.sha256,()=>{started();return new Promise(r=>release=r);});await began;await setManualLyrics(t.id,null,'plain',0);release(ready('Viejo'));await conflict(()=>pending);const r=await readLyrics(t.id);assert(r.state==='absent'&&typeof r.revision==='string','manual lost');
 // A new track with different bytes avoids dedup with the manual target.
 const t2=(await local(wav(tag(frame('TIT2',utf('otra')))))).track;assert(t2.assetId,'asset2');const a2=await readRecord<LocalAsset>('assets',t2.assetId);assert(a2,'asset2');
 let done1!:(v:EmbeddedLyricsInspection)=>void,done2!:(v:EmbeddedLyricsInspection)=>void;let go1!:()=>void,go2!:()=>void;
 const b1=new Promise<void>(r=>go1=r),b2=new Promise<void>(r=>go2=r);
 const p1=storeEmbeddedLyrics(t2.id,a2.sha256,()=>{go1();return new Promise(r=>done1=r);});await b1;
 const p2=storeEmbeddedLyrics(t2.id,a2.sha256,()=>{go2();return new Promise(r=>done2=r);});await b2;done2(ready('Nuevo'));await p2;done1(ready('Viejo'));await conflict(()=>p1);const newer=await readLyrics(t2.id);assert(newer.state==='ready'&&newer.lyrics.text==='Nuevo','old response');
});
await check('cambio de pista/generación/hash durante extracción rechaza publicación; parser/Blob fuera IDB/lock',async()=>{
 for(const kind of ['track','asset','hash','identity']){
 const f=wav(tag(frame('TIT2',utf(kind)))),t=(await local(f)).track;assert(t.assetId,'asset');const a=await readRecord<LocalAsset>('assets',t.assetId);assert(a,'asset');
 let release!:(v:EmbeddedLyricsInspection)=>void,go!:()=>void;const began=new Promise<void>(r=>go=r);
 const pending=storeEmbeddedLyrics(t.id,a.sha256,async()=>{const locks=await navigator.locks.query();assert(!locks.held?.some(l=>l.name===`pulso:lyrics:v1:${t.id}`),'held extraction lock');go();return new Promise(r=>release=r);});await began;
 if(kind==='track')await editTrack(t.id,t.revision,{title:'Nuevo título'});else await writeRecord('assets',a.id,{...a,...(kind==='asset'?{revision:a.revision+1}:kind==='identity'?{id:crypto.randomUUID()}:{sha256:'a'.repeat(64)})});
 release(ready());await conflict(()=>pending);assert((await readLyrics(t.id)).revision===0,'stale saved');await writeRecord('assets',a.id,a);
 }
});

await check('generación confirmada del intento no acepta una revisión posterior antes de extraer',async()=>{
 const t=(await local(wav(tag(frame('TIT2',utf('confirmed generation')))))).track;assert(t.assetId,'asset');const a=await readRecord<LocalAsset>('assets',t.assetId);assert(a,'asset');
 for(const expected of [{trackRevision:t.revision+1,assetRevision:a.revision},{trackRevision:t.revision,assetRevision:a.revision+1}]){let ran=false;await conflict(()=>storeEmbeddedLyrics(t.id,a.sha256,async()=>{ran=true;return ready();},expected));assert(!ran&&(await readLyrics(t.id)).revision===0,'generation checked too late');}
});
await check('registros manuales anteriores siguen válidos; corrupción automática no se repara',async()=>{
 const t=(await local(wav(tag(frame('TIT2',utf('legacy')))))).track;const revision=crypto.randomUUID();await writeRecord('settings',LYRICS_PREFIX+t.id,{version:1,trackId:t.id,revision,manual:true,format:'plain',text:'Anterior'});const r=await readLyrics(t.id);assert(r.state==='ready'&&r.lyrics.text==='Anterior','legacy');
 assert(t.assetId,'asset');const a=await readRecord<LocalAsset>('assets',t.assetId);assert(a,'asset');let ran=false;const p=await storeEmbeddedLyrics(t.id,a.sha256,async()=>{ran=true;return ready();});assert(p.state==='preserved'&&!ran,'manual extraction');
 const bad={version:1,trackId:t.id,revision:crypto.randomUUID(),manual:false,provenance:'embedded',format:'plain',text:'Corrupto',source:{kind:'embedded-mp4',tag:'USLT',descriptor:'',language:null},assetId:t.assetId,audioSha256:a.sha256};await writeRecord('settings',LYRICS_PREFIX+t.id,bad);
 const unavailable=await readLyrics(t.id);assert(unavailable.state==='unavailable'&&unavailable.repairToken,'corrupt source');let error:unknown;try{await storeEmbeddedLyrics(t.id,a.sha256,async()=>ready());}catch(e){error=e;}assert(error instanceof LyricsError&&error.code==='corrupt','auto repair');assert(JSON.stringify(await readRecord('settings',LYRICS_PREFIX+t.id))===JSON.stringify(bad),'corrupt overwritten');
 const fixed=await setManualLyrics(t.id,'Reparación explícita','plain',null,unavailable.repairToken);assert(fixed.state==='ready','manual repair auto');
});
await check('V11 real: Blob y parser fuera de transacciones y del lock de letras',async()=>{
 const t=(await local(wav(tag(frame('TIT2',utf('V11')))))).track;assert(t.assetId,'asset');const a=await readRecord<LocalAsset>('assets',t.assetId);assert(a,'asset');
 const transaction=IDBDatabase.prototype.transaction,encode=TextEncoder.prototype.encode,buffer=Blob.prototype.arrayBuffer;
 const live=new Set<IDBTransaction>();let encoded=0,reads=0,lyricsLock=false;const lockRequest=navigator.locks.request.bind(navigator.locks);
 navigator.locks.request=((name:string,callback:LockGrantedCallback)=>lockRequest(name,async lock=>{lyricsLock=name===`pulso:lyrics:v1:${t.id}`;try{return await callback(lock);}finally{lyricsLock=false;}})) as typeof navigator.locks.request;
 IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){const tx=transaction.apply(this,args);live.add(tx);tx.addEventListener('complete',()=>live.delete(tx),{once:true});tx.addEventListener('abort',()=>live.delete(tx),{once:true});return tx;};
 TextEncoder.prototype.encode=function(input){assert(live.size===0&&!lyricsLock,'encode inside IDB/lyrics lock');encoded++;return encode.call(this,input);};
 Blob.prototype.arrayBuffer=async function(){assert(live.size===0,'Blob inside IDB');const locks=await navigator.locks.query();assert(!locks.held?.some(l=>l.name===`pulso:lyrics:v1:${t.id}`),'Blob inside lyrics lock');reads++;return buffer.call(this);};
 try{const r=await storeEmbeddedLyrics(t.id,a.sha256,()=>inspect(wav(tag(frame('SYLT',syltEvents(Array.from({length:4000},(_,i)=>({timeMs:i,text:'[2026]V11'})))))),'audio/wav'));assert(r.state==='ready'&&encoded>0&&reads>0&&live.size===0,'probes');}finally{IDBDatabase.prototype.transaction=transaction;TextEncoder.prototype.encode=encode;Blob.prototype.arrayBuffer=buffer;navigator.locks.request=lockRequest;}
});
sessionStorage.setItem('embedded-reopen',JSON.stringify({results,id:persistedId,revision:persistedRevision,hash:persistedHash,sylt:syltPersisted}));location.reload();
}
