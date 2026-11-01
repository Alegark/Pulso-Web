import {authorizeRealmFixture,initializeRealmFixture} from './realm-fixture';
import {beginWorkerAttempt} from '../../src/storage/database-realms';
authorizeRealmFixture();await initializeRealmFixture();
import {sha256} from '@noble/hashes/sha2.js';
import {assetDirectory} from '../../src/storage/asset-reader';
import {importFile} from '../../src/imports/import-file';
import {ArtworkError,inspectEmbeddedArtwork,validateArtwork,MAX_ARTWORK_BYTES,MAX_ID3_BYTES} from '../../src/imports/artwork';
import {readArtwork,setManualArtwork,storeEmbeddedArtwork,type Artwork} from '../../src/library/artwork';
import {editTrack,verifiedAsset,type Track,type LocalAsset} from '../../src/library/library';
import {readRecord,writeRecord} from '../../src/storage/database';
const results:string[]=[];
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function check(name:string,fn:()=>Promise<void>){try{await fn();results.push(`PASS ${name}`);}catch(e){results.push(`FAIL ${name}: ${e instanceof Error?e.message:String(e)}`);}document.querySelector('#results')!.textContent=results.join('\n');}
const raw=new Uint8Array(await(await fetch('/fixtures/A.mp3')).arrayBuffer());
const offset=String.fromCharCode(...raw.subarray(0,3))==='ID3'?10+raw[6]*2097152+raw[7]*16384+raw[8]*128+raw[9]:0;
const audio=raw.slice(offset);
const join=(...arrays:Uint8Array[])=>{const b=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let p=0;for(const a of arrays){b.set(a,p);p+=a.length;}return b;};
const text=(s:string)=>new TextEncoder().encode(s);
const sync=(size:number)=>new Uint8Array([size>>>21&127,size>>>14&127,size>>>7&127,size&127]);
const frame=(id:string,body:Uint8Array)=>join(text(id),sync(body.length),new Uint8Array(2),body);
function tagged(image?:Uint8Array,mime='image/png',title='Título propio ñ 🎵 東京'):File{
 const tag=join(frame('TIT2',join(new Uint8Array([3]),text(title))),frame('TPE1',join(new Uint8Array([3]),text('Artista ç 中文'))),frame('TALB',join(new Uint8Array([3]),text('Álbum único'))),...(image?[frame('APIC',join(new Uint8Array([3]),text(mime),new Uint8Array([0,3,0]),image))]:[]));
 return new File([join(text('ID3'),new Uint8Array([4,0,0]),sync(tag.length),tag,audio)],'Propio.mp3',{type:'audio/mpeg'});
}
const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
const ctx=canvas.getContext('2d')!;ctx.fillStyle='#136b95';ctx.fillRect(0,0,32,24);ctx.fillStyle='#ebbb55';ctx.fillRect(5,4,14,13);
async function image(mime:string){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('canvas')),mime));}
const png=await image('image/png'),pngBytes=new Uint8Array(await png.arrayBuffer());
const importLocal=(file:File)=>importFile(file,new AbortController().signal,()=>{},{backend:'idb'});
async function rejects(blob:Blob,code:string){let actual='accepted';try{await validateArtwork(blob);}catch(e){actual=e instanceof ArtworkError?e.code:'unexpected';}assert(actual===code,`${actual}, esperado ${code}`);}
let track:Track;let cover:Artwork;const original=tagged(pngBytes);
await check('PNG/JPEG/WebP Canvas: firma, dimensiones, decode y SHA reales',async()=>{
 for(const mime of ['image/png','image/jpeg','image/webp']){const b=await image(mime);assert(b.type===mime,'canvas formato');const a=await validateArtwork(b);assert(a.mime===mime&&a.width===32&&a.height===24&&a.sha256.length===64,'imagen');}
});
await check('worker real importa ID3 Unicode y APIC PNG después del audio',async()=>{
 const worker=new Worker(new URL('../../src/imports/import.worker.ts',import.meta.url),{type:'module'});
 const realm=await beginWorkerAttempt('import',worker,()=>true);
 try{const result=await new Promise<{track:Track;artworkWarning?:string}>((resolve,reject)=>{worker.onerror=()=>reject(new Error('worker'));worker.onmessage=e=>{if(e.data.type==='complete')resolve(e.data.result);if(e.data.type==='error')reject(new Error(e.data.error));};worker.postMessage({version:2,type:'import',operationId:crypto.randomUUID(),file:original});});
 track=result.track;assert(!result.artworkWarning,'advertencia');assert(track.title==='Título propio ñ 🎵 東京'&&track.artist==='Artista ç 中文'&&track.album==='Álbum único','Unicode');
 const a=await readArtwork(track.id);assert(a.state==='ready'&&a.provenance==='embedded-id3'&&!a.manual,'portada');cover=a;assert(await verifiedAsset(track.assetId,true),'audio íntegro');
 }finally{worker.terminate();realm.closeAfterSettlement();}
});
await check('ID3v2.3 APIC acotado usa tamaño de frame big-endian',async()=>{
 const body=join(new Uint8Array([0]),text('image/png'),new Uint8Array([0,3,0]),pngBytes);const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,body.length);
 const tag=join(text('APIC'),length,new Uint8Array(2),body);const file=new File([join(text('ID3'),new Uint8Array([3,0,0]),sync(tag.length),tag,audio)],'v3.mp3',{type:'audio/mpeg'});
 const a=await inspectEmbeddedArtwork(file,'audio/mpeg');assert(a.state==='ready'&&a.width===32,'ID3v3');
});
await check('sin APIC es absent; MIME de contenedor incompatible rechazado; versión ID3 no soportada honesta',async()=>{
 const result=await importLocal(tagged(undefined,'image/png','Sin portada'));assert((await readArtwork(result.track.id)).state==='absent','absent');
 for(const mime of ['audio/mp4','audio/wav']){const a=await inspectEmbeddedArtwork(original,mime);assert(a.state==='invalid'&&a.failureCode==='tag-invalid','contenido MP3 con MIME de otro contenedor');}
 const b=new Uint8Array(await original.arrayBuffer());b[3]=2;const a=await inspectEmbeddedArtwork(new Blob([b]),'audio/mpeg');assert(a.state==='not-inspected'&&a.failureCode==='tag-unsupported','ID3v2.2');
});
await check('rechaza MIME falso, HTML/SVG y firma desconocida',async()=>{
 await rejects(new Blob([pngBytes],{type:'image/jpeg'}),'image-format');await rejects(new Blob(['<svg/>'],{type:'image/svg+xml'}),'image-format');await rejects(new Blob(['<html/>'],{type:'image/png'}),'image-format');
});
await check('PNG truncado/longitudes falsas y JPEG/WebP truncados rechazados',async()=>{
 await rejects(new Blob([pngBytes.slice(0,-5)],{type:'image/png'}),'image-structure');
 const b=pngBytes.slice();new DataView(b.buffer).setUint32(8,0xffffffff);await rejects(new Blob([b]),'image-structure');
 for(const mime of ['image/jpeg','image/webp']){const b=new Uint8Array(await(await image(mime)).arrayBuffer());await rejects(new Blob([b.slice(0,-6)],{type:mime}),'image-structure');}
});
await check('corrupción de contenido con estructura válida falla decodificación real',async()=>{
 const b=pngBytes.slice();for(let p=8;p<b.length;){const size=new DataView(b.buffer).getUint32(p);if(String.fromCharCode(...b.subarray(p+4,p+8))==='IDAT')b.fill(255,p+8,p+8+size);p+=size+12;}
 await rejects(new Blob([b],{type:'image/png'}),'decode-failed');
});
await check('bytes y dimensiones extremos rechazados antes de createImageBitmap',async()=>{
 const decode=globalThis.createImageBitmap;let calls=0;globalThis.createImageBitmap=((...args:Parameters<typeof createImageBitmap>)=>{calls++;return decode(...args);}) as typeof createImageBitmap;
 try{await rejects(new Blob([new Uint8Array(MAX_ARTWORK_BYTES+1)]),'image-size');
 for(const [width,height] of [[0,24],[4097,1],[4096,4096],[0xffffffff,0xffffffff]]){const b=pngBytes.slice();new DataView(b.buffer).setUint32(16,width);new DataView(b.buffer).setUint32(20,height);await rejects(new Blob([b],{type:'image/png'}),'image-dimensions');}assert(calls===0,'decodificó gigante');
 }finally{globalThis.createImageBitmap=decode;}
});
await check('cabeceras PNG/JPEG repetidas y WebP con dimensiones internas distintas se rechazan antes del decode',async()=>{
 const decode=globalThis.createImageBitmap;let calls=0;globalThis.createImageBitmap=((...args:Parameters<typeof createImageBitmap>)=>{calls++;return decode(...args);}) as typeof createImageBitmap;
 try{
  const repeatedPng=join(pngBytes.subarray(0,33),pngBytes.subarray(8,33),pngBytes.subarray(33));await rejects(new Blob([repeatedPng],{type:'image/png'}),'image-structure');
  const jpeg=new Uint8Array(await(await image('image/jpeg')).arrayBuffer());let p=2;
  while(p+4<jpeg.length){const kind=jpeg[p+1],size=jpeg[p+2]*256+jpeg[p+3];if([0xc0,0xc1,0xc2].includes(kind)){const repeated=join(jpeg.subarray(0,p+size+2),jpeg.subarray(p,p+size+2),jpeg.subarray(p+size+2));await rejects(new Blob([repeated],{type:'image/jpeg'}),'image-structure');break;}p+=size+2;}
  const webp=new Uint8Array(await(await image('image/webp')).arrayBuffer());const chunks:Uint8Array[]=[];for(let o=12;o<webp.length;){const n=new DataView(webp.buffer).getUint32(o+4,true),kind=String.fromCharCode(...webp.subarray(o,o+4));if(kind!=='VP8X')chunks.push(webp.slice(o,o+8+n+n%2));o+=8+n+n%2;}
  const vp8x=join(text('VP8X'),new Uint8Array([10,0,0,0]),new Uint8Array([0,0,0,0,0,0,0,0,0,0]));const mixed=join(webp.subarray(0,12),vp8x,...chunks);new DataView(mixed.buffer).setUint32(4,mixed.length-8,true);await rejects(new Blob([mixed],{type:'image/webp'}),'image-structure');
  assert(calls===0,'decode no acotado');
 }finally{globalThis.createImageBitmap=decode;}
});
await check('API de decode ausente: fallback seguro sin inventar soporte',async()=>{
 const decode=globalThis.createImageBitmap;try{Object.defineProperty(globalThis,'createImageBitmap',{value:undefined,writable:true,configurable:true});await rejects(png,'decode-unavailable');const a=await inspectEmbeddedArtwork(original,'audio/mpeg');assert(a.state==='not-inspected'&&a.failureCode==='decode-unavailable','fallback');}finally{globalThis.createImageBitmap=decode;}
});
await check('ID3 declarado grande solo lee cabecera; truncación y frame fuera de bloque rechazados',async()=>{
 const header=join(text('ID3'),new Uint8Array([4,0,0]),sync(MAX_ID3_BYTES));let largest=0;
 const b=new Blob([header,new Uint8Array(MAX_ID3_BYTES)]);const slice=b.slice.bind(b);b.slice=(start,end,type)=>{largest=Math.max(largest,(end??b.size)-(start??0));return slice(start,end,type);};
 const large=await inspectEmbeddedArtwork(b,'audio/mpeg');assert(large.state==='omitted'&&large.failureCode==='tag-size'&&largest===10,'lectura no acotada');
 const truncated=await inspectEmbeddedArtwork(new Blob([join(text('ID3'),new Uint8Array([4,0,0]),sync(99))]),'audio/mpeg');assert(truncated.state==='invalid'&&truncated.failureCode==='tag-invalid','tag truncado');
 const malformed=join(text('ID3'),new Uint8Array([4,0,0]),sync(10),text('APIC'),sync(100),new Uint8Array(2));assert((await inspectEmbeddedArtwork(new Blob([malformed]),'audio/mpeg')).state==='invalid','frame');
});
await check('portada APIC corrupta/MIME falso no destruye audio válido',async()=>{
 for(const [bytes,mime,title] of [[pngBytes.slice(0,-8),'image/png','Corrupta'],[pngBytes,'image/jpeg','MIME falso']] as const){const result=await importLocal(tagged(bytes,mime,title));assert(result.artworkWarning,'warning');const a=await readArtwork(result.track.id);assert(a.state==='invalid'&&!!a.failureCode,'estado');assert(await verifiedAsset(result.track.assetId,true),'audio perdido');}
});
await check('ID3 superior a 2 MiB omite portada y conserva audio confirmado',async()=>{
 const result=await importLocal(tagged(new Uint8Array(MAX_ID3_BYTES),'image/png','Grande'));assert(result.artworkWarning==='tag-size','warning límite');assert((await readArtwork(result.track.id)).state==='omitted','estado');assert(await verifiedAsset(result.track.assetId,true),'audio');
});
await check('corrección manual + portada manual sobreviven dedup y reparación de audio',async()=>{
 const manual=await setManualArtwork(track.id,await image('image/jpeg'),cover.revision);assert(manual.state==='ready'&&manual.manual,'manual');
 const now=await readRecord<Track>('tracks',track.id);assert(now,'track');await editTrack(now.id,now.revision,{title:'Corrección manual ñ',artist:'Mi artista',favorite:true});
 assert((await importLocal(original)).duplicate,'dedup');let a=await readArtwork(track.id);assert(a.state==='ready'&&a.manual&&a.mime==='image/jpeg'&&a.revision===manual.revision,'manual sobreescrita');
 const asset=await readRecord<LocalAsset>('assets',track.assetId);assert(asset,'asset');
 if(asset.backend==='idb'){const key=[asset.storageKey,0];const chunk=await readRecord<Uint8Array>('chunks',key);assert(chunk,'chunk');const corrupt=chunk.slice();corrupt[0]^=255;await writeRecord('chunks',key,corrupt);}
 else{const handle=await(await assetDirectory()).getFileHandle(asset.storageKey);const file=await handle.getFile();const bytes=new Uint8Array(await file.arrayBuffer());bytes[0]^=255;const writer=await handle.createWritable();await writer.write(bytes);await writer.close();}
 await importLocal(original);assert(await verifiedAsset(track.assetId,true),'reparación');a=await readArtwork(track.id);assert(a.state==='ready'&&a.manual&&a.revision===manual.revision,'manual perdida');const after=await readRecord<Track>('tracks',track.id);assert(after?.title==='Corrección manual ñ'&&after.favorite&&after.manualOverrides.artist==='Mi artista','edición perdida');cover=a;
});
await check('revisión stale rechazada y eliminación manual persiste en reimportación',async()=>{
 let rejected=false;try{await setManualArtwork(track.id,png,0);}catch(e){rejected=e instanceof ArtworkError&&e.code==='conflict';}assert(rejected,'stale');
 const removed=await setManualArtwork(track.id,null,cover.revision);await importLocal(original);const a=await readArtwork(track.id);assert(a.state==='absent'&&a.manual&&a.revision===removed.revision,'tombstone');
});
await check('edición concurrente durante decode no se sobrescribe ni publica resultado stale',async()=>{
 const current=await readRecord<Track>('tracks',track.id);assert(current,'track');const a=await readArtwork(track.id);const decode=globalThis.createImageBitmap;let edited=false;
 globalThis.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{if(!edited){edited=true;await editTrack(current.id,current.revision,{album:'Editado durante decode'});}return decode(...args);}) as typeof createImageBitmap;
 let rejected=false;try{await setManualArtwork(track.id,png,a.revision);}catch(e){rejected=e instanceof ArtworkError&&e.code==='conflict';}finally{globalThis.createImageBitmap=decode;}
 assert(edited&&rejected,'CAS');assert((await readRecord<Track>('tracks',track.id))?.album==='Editado durante decode','stale track');
});
await check('portada manual gana frente a extracción embedded concurrente',async()=>{
 const result=await importLocal(tagged(undefined,'image/png','Carrera manual'));const asset=await readRecord<LocalAsset>('assets',result.track.assetId);assert(asset,'asset');
 let started!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{started=r;}),gate=new Promise<void>(r=>{release=r;});
 const pending=storeEmbeddedArtwork(result.track.id,asset.sha256,async()=>{started();await gate;return validateArtwork(png);}).then(()=>false,e=>e instanceof ArtworkError&&e.code==='conflict');
 await entered;const before=await readArtwork(result.track.id);const manual=await setManualArtwork(result.track.id,await image('image/webp'),before.revision);release();assert(await pending,'CAS embedded');
 const a=await readArtwork(result.track.id);assert(a.state==='ready'&&a.manual&&a.revision===manual.revision&&a.mime==='image/webp','manual perdida');
 let rejected=false;try{await setManualArtwork(result.track.id,new Blob(['<svg/>'],{type:'image/svg+xml'}),a.revision);}catch{rejected=true;}const after=await readArtwork(result.track.id);assert(rejected&&after.state==='ready'&&after.sha256===a.sha256&&after.revision===a.revision,'invalid manual reemplazó válida');
});
await check('cuota simulada solo en artwork no cambia éxito ni bytes de audio',async()=>{
 const put=IDBObjectStore.prototype.put;let hit=false;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='settings'&&String(args[1]).startsWith('artwork:v1:')){hit=true;throw new DOMException('cuota','QuotaExceededError');}return put.apply(this,args);};
 let result;try{result=await importLocal(tagged(pngBytes,'image/png','Cuota portada'));}finally{IDBObjectStore.prototype.put=put;}
 assert(hit&&result.artworkWarning==='storage-failed','cuota no ejercitada');assert(await verifiedAsset(result.track.assetId,true),'audio perdido');assert((await readArtwork(result.track.id)).state==='unrecorded','falso éxito portada');
});
await check('reopen independiente conserva Blob/hash y detección de corrupción de settings',async()=>{
 const before=await readArtwork(track.id);const saved=await setManualArtwork(track.id,png,before.revision);assert(saved.state==='ready','ready');
 const reopened=await readArtwork(track.id);assert(reopened.state==='ready'&&reopened.sha256===saved.sha256,'hash');assert(new Uint8Array(await reopened.blob.arrayBuffer()).every((v,i)=>v===pngBytes[i])&&reopened.blob.size===pngBytes.length,'bytes reopen');
 const snapshot=await readRecord<Artwork>('settings',`artwork:v1:${track.id}`);assert(snapshot?.state==='ready','snapshot');await writeRecord('settings',`artwork:v1:${track.id}`,{...snapshot,sha256:'0'.repeat(64)});assert((await readArtwork(track.id)).state==='unavailable','corrupción');await writeRecord('settings',`artwork:v1:${track.id}`,snapshot);assert(await verifiedAsset(track.assetId,true),'audio');
});
await check('reutilizar operationId con File diferente no extrae APIC de otro archivo',async()=>{
 const operationId=crypto.randomUUID();const a=await importFile(tagged(undefined,'image/png','Operación estable'),new AbortController().signal,()=>{},{backend:'idb',operationId});
 const b=await importFile(original,new AbortController().signal,()=>{},{backend:'idb',operationId});assert(a.track.id===b.track.id&&(await readArtwork(a.track.id)).state==='absent','File ajeno');
});
await check('conflicto de relación al guardar resultado embedded no toca track',async()=>{
 const asset=await readRecord<LocalAsset>('assets',track.assetId);assert(asset,'asset');let rejected=false;
 try{await storeEmbeddedArtwork(track.id,'0'.repeat(64),async()=>({state:'absent'}));}catch(e){rejected=e instanceof ArtworkError&&e.code==='conflict';}assert(rejected,'relación');assert(await verifiedAsset(asset.id,true),'audio');
});
await check('importFile: padding ID3 de 3 MiB no se lee en preflight; copia/hash originales intactos',async()=>{
 const title=frame('TIT2',join(new Uint8Array([3]),text('Padding acotado')));
 const tag=join(title,new Uint8Array(3*1024*1024-title.length));
 const file=new File([join(text('ID3'),new Uint8Array([4,0,0]),sync(tag.length),tag,audio)],'padding.mp3',{type:'audio/mpeg'});
 let tagBytes=0;const slice=file.slice.bind(file);
 file.slice=(start=0,end=file.size,type)=>{const part=slice(start,end,type),read=part.arrayBuffer.bind(part);part.arrayBuffer=()=>{tagBytes+=Math.max(0,Math.min(end,tag.length+10)-start);return read();};return part;};
 const result=await importLocal(file);
 const extra=tagBytes-(tag.length+10); // subtract exactly the unavoidable original-copy read
 assert(extra<4096,`lecturas opcionales de tag: ${extra}`);
 assert(result.track.title==='Padding acotado'&&result.track.duration>0,'tags/duración');
 assert(result.artworkWarning==='tag-size'&&(await readArtwork(result.track.id)).state==='omitted','omitido');
 const asset=await verifiedAsset(result.track.assetId,true);assert(asset&&asset.bytes===file.size,'copia original');
 const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');assert(asset.sha256===expected,'hash archivo íntegro');
});
await check('tags válidos con flags conservados; fallo opcional del parser no inventa duración',async()=>{
 const valid=new Uint8Array(await tagged(undefined,'image/png','Tag con unsync').arrayBuffer());valid[5]=128;
 const result=await importLocal(new File([valid],'flags.mp3',{type:'audio/mpeg'}));assert(result.track.title==='Tag con unsync'&&result.track.duration>0,'tag válido perdido');
 const tag=join(...Array.from({length:129},()=>frame('TIT2',join(new Uint8Array([3]),text('exceso')))));
 const overflow=new File([join(text('ID3'),new Uint8Array([4,0,128]),sync(tag.length),tag,audio)],'fallback.mp3',{type:'audio/mpeg'});
 const parsed=await importLocal(overflow);assert(parsed.track.title==='fallback'&&Math.abs(parsed.track.duration-result.track.duration)<0.01,'fallback audio');assert(parsed.artworkWarning==='tag-unsupported'&&await verifiedAsset(parsed.track.assetId,true),'audio conservado');
});
await check('128 frames exactos aceptados; 129 omite portada sin rechazar audio',async()=>{
 const apic=frame('APIC',join(new Uint8Array([3]),text('image/png'),new Uint8Array([0,3,0]),pngBytes));
 for(const count of [128,129]){
  const tag=join(...Array.from({length:count-1},()=>frame('TIT2',join(new Uint8Array([3]),text('Límite frames')))),apic);
  const file=new File([join(text('ID3'),new Uint8Array([4,0,0]),sync(tag.length),tag,audio)],`frames${count}.mp3`,{type:'audio/mpeg'});
  const inspection=await inspectEmbeddedArtwork(file,'audio/mpeg');assert(inspection.state===(count===128?'ready':'omitted'),'frontera');
  const result=await importLocal(file);assert(result.track.duration>0&&await verifiedAsset(result.track.assetId,true),'audio válido');
 }
});
await check('flags ID3/APIC no soportados y MIME/descripción truncados explícitos',async()=>{
 const flagged=new Uint8Array(await original.arrayBuffer());flagged[5]=128;assert((await inspectEmbeddedArtwork(new Blob([flagged]),'audio/mpeg')).state==='not-inspected','flags ID3');
 for(const body of [join(new Uint8Array([3]),text('image/png')),join(new Uint8Array([3]),text('image/png'),new Uint8Array([0,3]),text('sin terminador'))]){
  const tag=frame('APIC',body);const file=new Blob([join(text('ID3'),new Uint8Array([4,0,0]),sync(tag.length),tag,audio)]);assert((await inspectEmbeddedArtwork(file,'audio/mpeg')).state==='invalid','truncado');
 }
 const tag=frame('APIC',join(new Uint8Array([3]),text('image/png'),new Uint8Array([0,3,0]),pngBytes));tag[9]=2;
 const file=new Blob([join(text('ID3'),new Uint8Array([4,0,0]),sync(tag.length),tag,audio)]);assert((await inspectEmbeddedArtwork(file,'audio/mpeg')).state==='not-inspected','flags APIC');
});
await check('reparación explícita reemplaza/oculta registro dañado sin confiar versión/procedencia/revisión',async()=>{
 const beforeTrack=await readRecord<Track>('tracks',track.id),beforeAsset=await readRecord<LocalAsset>('assets',track.assetId);
 const initial=await readArtwork(track.id);const saved=await setManualArtwork(track.id,png,initial.revision);
 for(const patch of [{version:99,provenance:'ajeno',assetId:'otro',audioSha256:'0'.repeat(64)},{revision:NaN},{revision:Number.MAX_SAFE_INTEGER},{sha256:'0'.repeat(64)}]){
  await writeRecord('settings',`artwork:v1:${track.id}`,{...saved,...patch});
  const observed=await readArtwork(track.id);assert(observed.state==='unavailable'&&observed.repairToken,'token');
  assert(Number.isSafeInteger(observed.revision)&&observed.revision>=0&&observed.revision<Number.MAX_SAFE_INTEGER,'revisión acotada');
  const repaired=await setManualArtwork(track.id,patch.version?png:null,observed.revision,observed.repairToken);
  assert(repaired.manual&&repaired.version===1&&(await readArtwork(track.id)).state===repaired.state,'reparación');
 }
 assert(JSON.stringify(await readRecord('tracks',track.id))===JSON.stringify(beforeTrack),'track modificado');assert(JSON.stringify(await readRecord('assets',track.assetId))===JSON.stringify(beforeAsset),'asset modificado');assert(await verifiedAsset(track.assetId,true),'audio');
});
await check('token reparador stale y cambio durante decode se rechazan incluso con misma revisión',async()=>{
 const now=await readArtwork(track.id);const saved=await setManualArtwork(track.id,png,now.revision);
 const corrupt={...saved,sha256:'0'.repeat(64)};const k=`artwork:v1:${track.id}`;await writeRecord('settings',k,corrupt);
 const observed=await readArtwork(track.id);assert(observed.state==='unavailable'&&observed.repairToken,'token');
 await writeRecord('settings',k,{...corrupt,version:77});let rejected=false;
 try{await setManualArtwork(track.id,null,observed.revision,observed.repairToken);}catch(e){rejected=e instanceof ArtworkError&&e.code==='conflict';}assert(rejected,'token stale');
 const fresh=await readArtwork(track.id);assert(fresh.state==='unavailable'&&fresh.repairToken,'token nuevo');
 const decode=globalThis.createImageBitmap;
 globalThis.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{await writeRecord('settings',k,{...corrupt,version:77,blob:new Blob([join(new Uint8Array([pngBytes[0]^255]),pngBytes.subarray(1))],{type:'image/png'})});return decode(...args);}) as typeof createImageBitmap;
 rejected=false;try{await setManualArtwork(track.id,png,fresh.revision,fresh.repairToken);}catch(e){rejected=e instanceof ArtworkError&&e.code==='conflict';}finally{globalThis.createImageBitmap=decode;}
 assert(rejected,'cambio durante decode');const latest=await readArtwork(track.id);assert(latest.state==='unavailable'&&latest.repairToken,'estado dañado');await setManualArtwork(track.id,null,latest.revision,latest.repairToken);
});
await check('reparación: hash/Blob/decode fuera de tx y CAS breve sin keepAlive',async()=>{
 const a=await readArtwork(track.id),saved=await setManualArtwork(track.id,png,a.revision),k=`artwork:v1:${track.id}`;
 await writeRecord('settings',k,{...saved,sha256:'0'.repeat(64)});const observed=await readArtwork(track.id);assert(observed.state==='unavailable'&&observed.repairToken,'token');
 const transaction=IDBDatabase.prototype.transaction,get=IDBObjectStore.prototype.get,read=Blob.prototype.arrayBuffer,decode=globalThis.createImageBitmap;
 const reads=new Map<IDBTransaction,number>();let active=0,blobCalls=0,decodeCalls=0,hashCalls=0,overlap=false;
 const sample=sha256.create(),hashPrototype=Object.getPrototypeOf(sample),update=sample.update,finish=sample.digest,digest=crypto.subtle.digest;
 const updateDescriptor=Object.getOwnPropertyDescriptor(hashPrototype,'update'),digestDescriptor=Object.getOwnPropertyDescriptor(hashPrototype,'digest');
 hashPrototype.update=function(this:typeof sample,...args:Parameters<typeof update>){hashCalls++;if(active)overlap=true;return update.apply(this,args);};
 hashPrototype.digest=function(this:typeof sample){if(active)overlap=true;return finish.call(this);};
 crypto.subtle.digest=function(...args:Parameters<SubtleCrypto['digest']>){if(active)overlap=true;return digest.apply(this,args);};
 IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){const tx=transaction.apply(this,args);if(tx.mode==='readwrite'){active++;reads.set(tx,0);const end=()=>{active--;};tx.addEventListener('complete',end,{once:true});tx.addEventListener('abort',end,{once:true});}return tx;};
 IDBObjectStore.prototype.get=function(...args:Parameters<IDBObjectStore['get']>){if(reads.has(this.transaction))reads.set(this.transaction,reads.get(this.transaction)!+1);return get.apply(this,args);};
 Blob.prototype.arrayBuffer=function(){blobCalls++;if(active)overlap=true;return read.call(this);};
 globalThis.createImageBitmap=((...args:Parameters<typeof createImageBitmap>)=>{decodeCalls++;if(active)overlap=true;return decode(...args);}) as typeof createImageBitmap;
 try{await setManualArtwork(track.id,png,observed.revision,observed.repairToken);}finally{IDBDatabase.prototype.transaction=transaction;IDBObjectStore.prototype.get=get;Blob.prototype.arrayBuffer=read;globalThis.createImageBitmap=decode;if(updateDescriptor)Object.defineProperty(hashPrototype,'update',updateDescriptor);else delete hashPrototype.update;if(digestDescriptor)Object.defineProperty(hashPrototype,'digest',digestDescriptor);else delete hashPrototype.digest;crypto.subtle.digest=digest;}
 assert(!overlap&&blobCalls>0&&decodeCalls===1&&hashCalls>0,'IO/decode dentro de tx');assert(reads.size===1&&[...reads.values()].every(n=>n===3),'CAS no breve');assert((await readArtwork(track.id)).state==='ready','reparación');
});
await check('snapshot enorme/cíclico/profundo no obtiene token ni lee Blob gigante',async()=>{
 const k=`artwork:v1:${track.id}`,a=await readArtwork(track.id);assert(a.state==='ready','ready');
 const cycle:Record<string,unknown>={};cycle.self=cycle;
 let deep:unknown={};for(let i=0;i<10;i++)deep={nested:deep};
 const cases=[{blob:new Blob([new Uint8Array(MAX_ARTWORK_BYTES+1)])},{extra:cycle},{extra:deep},{extra:'x'.repeat(16385)}];
 const read=Blob.prototype.arrayBuffer;let largeReads=0;
 Blob.prototype.arrayBuffer=function(){if(this.size>MAX_ARTWORK_BYTES)largeReads++;return read.call(this);};
 try{for(const patch of cases){await writeRecord('settings',k,{...a,version:99,...patch});const result=await readArtwork(track.id);assert(result.state==='unavailable'&&!result.repairToken,'registro no reparable');}}finally{Blob.prototype.arrayBuffer=read;await writeRecord('settings',k,a);}
 assert(largeReads===0,'Blob gigante leído');
});
await check('acuse de commit de portada perdido: reopen confirma y retry stale conserva resultado',async()=>{
 const a=await readArtwork(track.id),descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!;
 let hit=false;
 Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(this:IDBTransaction,callback:((event:Event)=>void)|null){
  if(!hit&&this.mode==='readwrite'&&this.objectStoreNames.contains('settings')&&this.objectStoreNames.contains('tracks')){hit=true;descriptor.set!.call(this,()=>this.onabort?.call(this,new Event('abort')));}
  else descriptor.set!.call(this,callback);
 }});
 let failed=false;try{await setManualArtwork(track.id,png,a.revision);}catch{failed=true;}finally{Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);}
 const reopened=await readArtwork(track.id);assert(hit&&failed&&reopened.state==='ready'&&reopened.manual&&reopened.revision===a.revision+1,'commit perdido');
 let rejected=false;try{await setManualArtwork(track.id,null,a.revision);}catch(e){rejected=e instanceof ArtworkError&&e.code==='conflict';}assert(rejected,'retry stale');assert(await verifiedAsset(track.assetId,true),'audio');
});
(window as unknown as {pulsoArtwork:unknown}).pulsoArtwork={passed:results.every(s=>s.startsWith('PASS')),results,userAgent:navigator.userAgent};
document.querySelector('#results')!.textContent+='\nCOMPLETADO';
