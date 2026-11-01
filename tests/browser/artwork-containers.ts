import {authorizeRealmFixture,initializeRealmFixture} from './realm-fixture';
import {beginWorkerAttempt} from '../../src/storage/database-realms';
authorizeRealmFixture();await initializeRealmFixture();
import {parseBlob} from 'music-metadata';
import {AudioMetadataLimitError,ArtworkError,inspectEmbeddedArtwork,audioMetadataView,MAX_AUDIO_TABLE_ENTRIES,MAX_AUDIO_TABLE_BYTES,MAX_ID3_BYTES} from '../../src/imports/artwork';
import {importFile} from '../../src/imports/import-file';
import {readArtwork,setManualArtwork,type Artwork} from '../../src/library/artwork';
import {editTrack,verifiedAsset,type Track,type LocalAsset} from '../../src/library/library';
import {readRecord,writeRecord} from '../../src/storage/database';
const results:string[]=[];let detail='';
function assert(v:unknown,m:string):asserts v{if(!v)throw new Error(m);}
async function check(name:string,fn:()=>Promise<void>){try{detail='';await fn();results.push(`PASS ${name}${detail}`);}catch(e){results.push(`FAIL ${name}: ${e instanceof Error?e.message:String(e)}`);}document.querySelector('#results')!.textContent=results.join('\n');}
const text=(s:string)=>new TextEncoder().encode(s);
const join=(...parts:Uint8Array[])=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length;}return b;};
const n32=(n:number,le=false)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,le);return b;};
const read32=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p);
const ascii=(b:Uint8Array,p:number,n:number)=>String.fromCharCode(...b.subarray(p,p+n));
const box=(name:string,body:Uint8Array)=>join(n32(body.length+8),text(name),body);
const extBox=(name:string,body:Uint8Array)=>join(n32(1),text(name),n32(0),n32(body.length+16),body);
const sync=(n:number)=>new Uint8Array([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);
const frame=(id:string,b:Uint8Array)=>join(text(id),sync(b.length),new Uint8Array(2),b);
const tag=(b:Uint8Array)=>join(text('ID3'),new Uint8Array([4,0,0]),sync(b.length),b);
const apic=(b:Uint8Array,mime='image/png')=>tag(frame('APIC',join(new Uint8Array([3]),text(mime),new Uint8Array([0,3,0]),b)));
const chunk=(name:string,b:Uint8Array)=>join(text(name),n32(b.length,true),b,new Uint8Array(b.length%2));
const riff=(...chunks:Uint8Array[])=>{const body=join(text('WAVE'),...chunks);return new File([join(text('RIFF'),n32(body.length,true),body)],'propio.wav',{type:'audio/wav'});};
const fmt=join(new Uint8Array([1,0,1,0]),n32(8000,true),n32(16000,true),new Uint8Array([2,0,16,0]));
const pcm=new Uint8Array(3200);for(let p=0;p<pcm.length;p+=2)new DataView(pcm.buffer).setInt16(p,Math.round(3000*Math.sin(p/2*2*Math.PI*440/8000)),true);
const wav=(id3?:Uint8Array,...extra:Uint8Array[])=>riff(chunk('fmt ',fmt),chunk('data',pcm),...extra,...(id3?[chunk('ID3 ',id3)]:[]));
const base=new Uint8Array(await(await fetch('/fixtures/B.m4a')).arrayBuffer());
let moov=-1,mdat=-1;for(let p=0;p<base.length;p+=read32(base,p)){if(ascii(base,p+4,4)==='moov')moov=p;if(ascii(base,p+4,4)==='mdat')mdat=p;}
assert(moov>mdat&&mdat>=0&&moov+read32(base,moov)===base.length,'fixture: moov final después de mdat; offsets stco conservados');
const moovParts:Uint8Array[]=[];for(let p=moov+8;p<base.length;p+=read32(base,p))if(ascii(base,p+4,4)!=='udta')moovParts.push(base.slice(p,p+read32(base,p)));
const withIlst=(ilst:Uint8Array,extended=false)=>new File([base.slice(0,moov),box('moov',join(...moovParts,box('udta',box('meta',join(new Uint8Array(4),(extended?extBox:box)('ilst',ilst))))))],'propio.m4a',{type:'audio/mp4'});
const covr=(bytes:Uint8Array,kind=14)=>box('covr',box('data',join(n32(kind),n32(0),bytes)));
const canvas=document.createElement('canvas');canvas.width=40;canvas.height=28;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#864329';ctx.fillRect(0,0,40,28);ctx.fillStyle='#4baac6';ctx.fillRect(3,4,15,17);
async function image(mime:string){return new Promise<Blob>((r,j)=>canvas.toBlob(b=>b?r(b):j(new Error('canvas')),mime));}
const png=await image('image/png'),jpg=await image('image/jpeg'),pngBytes=new Uint8Array(await png.arrayBuffer()),jpgBytes=new Uint8Array(await jpg.arrayBuffer());
const hash=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
const local=(file:File)=>importFile(file,new AbortController().signal,()=>{},{backend:'idb'});
async function workerImport(file:File):Promise<{track:Track;artworkWarning?:string}>{
 const worker=new Worker(new URL('../../src/imports/import.worker.ts',import.meta.url),{type:'module'});
 const realm=await beginWorkerAttempt('import',worker,()=>true);
 try{return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('worker timeout')),15000);worker.onerror=()=>{clearTimeout(timeout);reject(new Error('worker error'));};worker.onmessage=e=>{if(e.data.type==='complete'){clearTimeout(timeout);resolve(e.data.result);}if(e.data.type==='error'){clearTimeout(timeout);reject(new Error(e.data.error));}};worker.postMessage({version:2,type:'import',operationId:crypto.randomUUID(),file});});}finally{worker.terminate();realm.closeAfterSettlement();}
}
async function state(file:Blob,mime:string,expected:string){const a=await inspectEmbeddedArtwork(file,mime);assert(a.state===expected,`${a.state} esperado ${expected}: ${a.state==='ready'?'':a.failureCode}`);return a;}
const originals=[withIlst(covr(pngBytes)),withIlst(covr(jpgBytes,13)),wav(apic(pngBytes))];
const tracks:Track[]=[];
for(const [i,name] of ['M4A PNG','M4A JPEG','WAV ID3 APIC'].entries())await check(`${name}: importador worker real, procedencia y bytes/hash originales tras reopen`,async()=>{
 const file=originals[i],result=await workerImport(file);tracks[i]=result.track;assert(!result.artworkWarning,'warning');
 const a=await readArtwork(result.track.id);assert(a.state==='ready'&&!a.manual&&a.provenance===(i===2?'embedded-riff-id3':'embedded-mp4'),'procedencia');assert(a.sha256===await hash(i===1?jpg:png)&&a.width===40&&a.height===28,'cover hash/dimensiones');
 const reopened=await readArtwork(result.track.id);assert(reopened.state==='ready'&&await hash(reopened.blob)===a.sha256,'Blob reopen');
 const asset=await verifiedAsset(result.track.assetId,true);assert(asset&&asset.sha256===await hash(file)&&asset.bytes===file.size&&result.track.duration>0,'audio original');
 if(i<2)assert(Math.abs(result.track.duration-tracks[0].duration)<0.001,'duración M4A');else assert(Math.abs(result.track.duration-0.2)<0.001,'duración PCM real');
});
await check('ausentes: M4A base sin covr y WAV PCM sin ID3; otro formato no inspeccionado',async()=>{
 await state(new Blob([base]),'audio/mp4','absent');await state(wav(),'audio/wav','absent');await state(wav(),'audio/flac','not-inspected');
 for(const file of [new File([base],'base.m4a'),wav()]){const r=await local(file);assert((await readArtwork(r.track.id)).state==='absent'&&!r.artworkWarning,'import absent');}
});
await check('MIME del contenedor falso y firmas cruzadas son inválidos',async()=>{
 await state(wav(),'audio/mp4','invalid');await state(originals[0],'audio/wav','invalid');await state(new Blob([text('<html/>')]),'audio/mp4','invalid');
});
await check('MP4 covr MIME falso/imagen truncada/HTML conservan audio confirmado',async()=>{
 for(const payload of [covr(pngBytes,13),covr(pngBytes.slice(0,-8)),covr(text('<svg/>'))]){
  const file=withIlst(payload);await state(file,'audio/mp4','invalid');const r=await local(file);assert(r.artworkWarning&&(await readArtwork(r.track.id)).state==='invalid','warning');const a=await verifiedAsset(r.track.assetId,true);assert(a&&a.sha256===await hash(file),'audio');
 }
});
await check('WAV APIC MIME falso/imagen truncada conservan audio confirmado',async()=>{
 for(const bytes of [apic(pngBytes,'image/jpeg'),apic(pngBytes.slice(0,-8))]){const file=wav(bytes);await state(file,'audio/wav','invalid');const r=await local(file);assert(r.artworkWarning&&await verifiedAsset(r.track.assetId,true),'audio');}
});
await check('MP4 extended size válido, size cero final y caja desconocida saltada',async()=>{
 await state(withIlst(covr(pngBytes),true),'audio/mp4','ready');
 const ftyp=box('ftyp',join(text('M4A '),n32(0)));await state(new Blob([ftyp,join(n32(0),text('free'),new Uint8Array(12))]),'audio/mp4','absent');
});
await check('MP4 truncación/tamaño < header/extsize truncado/overflow rechazados sin payload',async()=>{
 const ftyp=box('ftyp',join(text('M4A '),n32(0)));
 for(const b of [join(n32(7),text('moov')),join(n32(200),text('moov')),join(n32(1),text('moov'),n32(0)),join(n32(1),text('moov'),n32(0x200000),n32(0)),join(n32(1),text('moov'),n32(0),n32(8))])await state(new Blob([ftyp,b]),'audio/mp4','invalid');
});
await check('covr/data malformado, duplicado o tipo no soportado son explícitos',async()=>{
 await state(withIlst(box('covr',box('data',new Uint8Array(4)))),'audio/mp4','invalid');
 await state(withIlst(box('covr',new Uint8Array(3))),'audio/mp4','invalid');
 await state(withIlst(join(covr(pngBytes),covr(pngBytes))),'audio/mp4','not-inspected');
 await state(withIlst(covr(pngBytes,99)),'audio/mp4','not-inspected');
 await state(withIlst(box('covr',new Uint8Array())),'audio/mp4','invalid');
});
await check('WAV longitudes RIFF/chunk/truncación y APIC roto rechazados',async()=>{
 const b=new Uint8Array(await wav().arrayBuffer());b[4]^=1;await state(new Blob([b]),'audio/wav','invalid');
 await state(riff(join(text('JUNK'),n32(0xffffffff,true))),'audio/wav','invalid');
 await state(riff(new Uint8Array(7)),'audio/wav','invalid');
 await state(wav(text('ID3')),'audio/wav','invalid');
 const malformed=apic(pngBytes);malformed[9]++;await state(wav(malformed),'audio/wav','invalid');
});
await check('WAV chunk impar exige padding; ID3v2.2 permanece no inspeccionado',async()=>{
 await state(wav(apic(pngBytes),chunk('JUNK',new Uint8Array([1]))),'audio/wav','ready');
 await state(riff(join(text('JUNK'),n32(1,true),new Uint8Array([1]))),'audio/wav','invalid');
 const b=apic(pngBytes);b[3]=2;await state(wav(b),'audio/wav','not-inspected');
});
await check('metadatos >2 MiB y >512 boxes/chunks omitidos con lecturas pequeñas',async()=>{
 for(const [file,mime] of [[withIlst(covr(new Uint8Array(MAX_ID3_BYTES))),'audio/mp4'],[wav(tag(new Uint8Array(MAX_ID3_BYTES))),'audio/wav'],[withIlst(join(...Array.from({length:513},()=>box('free',new Uint8Array())))),'audio/mp4'],[riff(...Array.from({length:513},()=>chunk('JUNK',new Uint8Array()))),'audio/wav']] as const){
  let max=0,total=0;const slice=file.slice.bind(file);file.slice=(start=0,end=file.size,type)=>{const part=slice(start,end,type),read=part.arrayBuffer.bind(part);part.arrayBuffer=()=>{max=Math.max(max,part.size);total+=part.size;return read();};return part;};await state(file,mime,'omitted');assert(max<=16&&total<10000,`lecturas ${max}/${total}`);
 }
});
await check('salta 96 MiB de mdat/data/JUNK sin leer payload ni reservarlo como metadata',async()=>{
 const huge=new Uint8Array(96*1024*1024);
 const ftyp=box('ftyp',join(text('M4A '),n32(0)));
 for(const [file,mime] of [[new Blob([ftyp,n32(huge.length+8),text('mdat'),huge,box('moov',box('udta',box('meta',join(new Uint8Array(4),box('ilst',covr(pngBytes))))))]),'audio/mp4'],[riff(chunk('fmt ',fmt),chunk('data',huge),chunk('JUNK',new Uint8Array([1])),chunk('ID3 ',apic(pngBytes))),'audio/wav']] as const){
  let total=0;const slice=file.slice.bind(file);file.slice=(start=0,end=file.size,type)=>{const b=slice(start,end,type),read=b.arrayBuffer.bind(b);b.arrayBuffer=()=>{total+=b.size;return read();};return b;};await state(file,mime,'ready');assert(total<MAX_ID3_BYTES,'payload audio leído');
 }
});
await check('padding ID3 acotado y secuencia no cero inválida',async()=>{
 await state(wav(tag(join(frame('APIC',join(new Uint8Array([3]),text('image/png'),new Uint8Array([0,3,0]),pngBytes)),new Uint8Array(1024)))),'audio/wav','ready');
 await state(wav(tag(new Uint8Array([0,0,1]))),'audio/wav','invalid');
});
await check('manual/correcciones sobreviven dedup y repair de bytes en ambos contenedores',async()=>{
 for(const i of [0,2]){
  const track=tracks[i],before=await readArtwork(track.id),saved=await setManualArtwork(track.id,jpg,before.revision);assert(saved.state==='ready','manual ready');
  const t=await readRecord<Track>('tracks',track.id);assert(t,'track');await editTrack(t.id,t.revision,{title:'Corrección contenedor ñ',favorite:true});
  assert((await local(originals[i])).duplicate,'dedup');
  const asset=await readRecord<LocalAsset>('assets',track.assetId);assert(asset,'asset');
  // Worker prefers OPFS; direct imports below repair through the IDB backend.
  if(asset.backend==='opfs'){
   const {assetDirectory}=await import('../../src/storage/asset-reader');const handle=await(await assetDirectory()).getFileHandle(asset.storageKey);const f=await handle.getFile();const b=new Uint8Array(await f.arrayBuffer());b[0]^=255;const w=await handle.createWritable();await w.write(b);await w.close();
  }else{const key=[asset.storageKey,0],b=await readRecord<Uint8Array>('chunks',key);assert(b,'chunk');const c=b.slice();c[0]^=255;await writeRecord('chunks',key,c);}
  await local(originals[i]);const a=await readArtwork(track.id);assert(a.state==='ready'&&a.manual&&a.sha256===saved.sha256&&a.revision===saved.revision,'manual');assert(await verifiedAsset(track.assetId,true),'repair');assert((await readRecord<Track>('tracks',track.id))?.title==='Corrección contenedor ñ','corrección');
  const hidden=await setManualArtwork(track.id,null,a.revision);await local(originals[i]);const h=await readArtwork(track.id);assert(h.state==='absent'&&h.manual&&h.revision===hidden.revision,'hide');
 }
});
await check('tags opcionales rotos/grandes no impiden validar audio: covr truncado e ID3 antes de PCM',async()=>{
 const brokenTag=apic(pngBytes);brokenTag[9]++;
 const files=[withIlst(box('covr',box('data',new Uint8Array(4)))),riff(chunk('fmt ',fmt),chunk('ID3 ',brokenTag),chunk('data',pcm)),riff(chunk('fmt ',fmt),chunk('ID3 ',tag(new Uint8Array(MAX_ID3_BYTES))),chunk('data',pcm))];
 for(const file of files){const r=await local(file);assert(r.artworkWarning,'warning opcional');const a=await verifiedAsset(r.track.assetId,true);assert(a&&a.sha256===await hash(file)&&r.track.duration>0,'audio íntegro');}
});
await check('vistas de retry conservan tamaño/posiciones PCM/mdat y solo cambian FourCC opcional',async()=>{
 for(const [file,mime] of [[originals[0],'audio/mp4'],[riff(chunk('fmt ',fmt),chunk('ID3 ',apic(pngBytes)),chunk('data',pcm)),'audio/wav']] as const){
  const view=await audioMetadataView(file,mime,true),original=new Uint8Array(await file.arrayBuffer()),changed=new Uint8Array(await view.arrayBuffer());
  assert(view.size===file.size,'tamaño');let differences=0;for(let p=0;p<original.length;p++)if(original[p]!==changed[p])differences++;
  assert(differences===4,'solo FourCC');
  if(mime==='audio/mp4')assert(changed.subarray(0,moov).every((v,i)=>v===original[i]),'mdat/offsets intactos');
  else assert(changed.subarray(-pcm.length).every((v,i)=>v===pcm[i]),'PCM intacto');
  assert(await hash(file)===await hash(new Blob([original])),'original inmutable');
 }
});
await check('versiones meta no soportadas, ubicaciones externas y tags ID3 duplicados no se siguen',async()=>{
 const mp4=new Uint8Array(await originals[0].arrayBuffer());
 let meta=-1;for(let p=moov;p<mp4.length-4;p++)if(ascii(mp4,p,4)==='meta'){meta=p;break;}assert(meta>=0,'meta');mp4[meta+4]=1;
 await state(new Blob([mp4]),'audio/mp4','not-inspected');
 await state(withIlst(covr(text('https://invalid.example/cover.png'),0)),'audio/mp4','not-inspected');
 await state(wav(apic(text('https://invalid.example/cover.png'),'-->')),'audio/wav','invalid');
 await state(wav(apic(pngBytes),chunk('id3 ',apic(pngBytes))),'audio/wav','not-inspected');
});
await check('procedencias históricas ID3/manual y reparación explícita continúan válidas',async()=>{
 const track=tracks[1],key=`artwork:v1:${track.id}`,a=await readRecord<Artwork>('settings',key);assert(a,'artwork');
 await writeRecord('settings',key,{...a,provenance:'embedded-id3'});assert((await readArtwork(track.id)).state==='ready','legacy');
 await writeRecord('settings',key,{...a,version:99});const bad=await readArtwork(track.id);assert(bad.state==='unavailable'&&bad.repairToken,'repair token');
 const fixed=await setManualArtwork(track.id,png,bad.revision,bad.repairToken);assert(fixed.manual&&fixed.provenance==='manual'&&(await readArtwork(track.id)).state==='ready','repair');
});
// Repackage the existing original AAC packets, one packet per chunk. Actual
// samples, durations and offsets are rebuilt together; this is playable audio,
// not a table-only fake. The source fixture has 88 AAC packets.
function manyChunks(repetitions=2):File{
 const find=(name:string)=>{for(let p=moov;p<base.length-4;p++)if(ascii(base,p,4)===name)return p-4;throw new Error(name);};
 const sz=find('stsz'),samples=read32(base,sz+16),sizes=Array.from({length:samples},(_,i)=>read32(base,sz+20+4*i));
 assert(samples===88,'88 source packets');
 const mdatEnd=mdat+read32(base,mdat),payload=base.slice(mdat+8,mdatEnd),offsets:number[]=[];let offset=mdat+8;
 const repeated=Array.from({length:repetitions},()=>sizes).flat();
 for(const size of repeated){offsets.push(offset);offset+=size;}
 const tables:Record<string,Uint8Array<ArrayBuffer>>={
  stco:box('stco',join(n32(0),n32(offsets.length),...offsets.map(n=>n32(n)))),
  stsc:box('stsc',join(n32(0),n32(1),n32(1),n32(1),n32(1))),
  stsz:box('stsz',join(n32(0),n32(0),n32(samples*repetitions),...repeated.map(n=>n32(n))))
 };
 const rebuild=(start:number,end:number):Uint8Array<ArrayBuffer>=>{
  const out:Uint8Array[]=[];
  for(let p=start;p<end;p+=read32(base,p)){
   const type=ascii(base,p+4,4),end=p+read32(base,p);let b=base.slice(p,end);
   if(tables[type])b=tables[type];
   else if(['moov','trak','mdia','minf','stbl'].includes(type))b=box(type,rebuild(p+8,end));
   else if(type==='stts'){
    const count=read32(base,p+12),entries=base.slice(p+16,end);b=box(type,join(n32(0),n32(count*repetitions),...Array.from({length:repetitions},()=>entries)));
   }else if(['mvhd','mdhd','tkhd'].includes(type)){
    const at=type==='tkhd'?28:24;new DataView(b.buffer).setUint32(at,read32(b,at)*repetitions);
   }else if(type==='edts'||type==='udta')continue;
   out.push(b);
  }
  return join(...out);
 };
 return new File([base.slice(0,mdat),box('mdat',join(...Array.from({length:repetitions},()=>payload))),rebuild(moov,base.length)],`${samples*repetitions}-chunks-propios.m4a`,{type:'audio/mp4'});
}
for(const repetitions of [2,500])await check(`${88*repetitions} chunks AAC propios: copia/hash, duración/codec reales y HTMLMediaElement inicio/seek final`,async()=>{
 const started=performance.now(),file=manyChunks(repetitions),r=await local(file);
 assert(Math.abs(r.track.duration-4.046439909297052*repetitions)<0.00001,`duration ${r.track.duration}`);
 const metadata=await parseBlob(await audioMetadataView(file,'audio/mp4'),{duration:true,skipCovers:true,maxMemoryAllocation:MAX_ID3_BYTES,maxMetadataEntries:MAX_AUDIO_TABLE_ENTRIES});
 assert(metadata.format.codec?.includes('AAC')&&Math.abs(metadata.format.duration!-r.track.duration)<.00001,'codec/duración AAC detectados');
 const audio=new Audio(),url=URL.createObjectURL(file);audio.src=url;audio.muted=true;
 try{await audio.play();await new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('decode timeout')),5000);
  const done=()=>{if(audio.currentTime>0.1){clearTimeout(timeout);audio.removeEventListener('timeupdate',done);resolve();}};
  audio.addEventListener('timeupdate',done);audio.onerror=()=>{clearTimeout(timeout);reject(new Error('decode error'));};
 });assert(audio.readyState>=2&&Math.abs(audio.duration-r.track.duration)<.1,'samples/duración nativa decodificados');
 const target=audio.duration-2;
 await new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>{audio.removeEventListener('timeupdate',done);reject(new Error('seek decode timeout'));},5000);
  const done=()=>{if(!audio.seeking&&audio.readyState>=2&&audio.currentTime>target+.1){clearTimeout(timeout);audio.removeEventListener('timeupdate',done);resolve();}};
  audio.addEventListener('timeupdate',done);audio.currentTime=target;
 });assert(Math.abs(audio.currentTime-target)<1,'seek cerca del final');
 }finally{audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);}
 assert((await verifiedAsset(r.track.assetId,true))?.sha256===await hash(file),'hash original');
 detail=` [${file.size} bytes; codec ${metadata.format.codec}; duración ${r.track.duration}; seek final; ${(performance.now()-started).toFixed(0)} ms]`;
});
await check('presupuesto de tablas MP4: cap+1 y 2 MiB encoded rechazan antes del parser con error accionable',async()=>{
 const table=(payload:Uint8Array,type='stco')=>new File([base.slice(0,moov),box('moov',box('trak',box('mdia',box('minf',box('stbl',box(type,payload))))))],'limite.m4a');
 const half=join(n32(0),n32(MAX_AUDIO_TABLE_ENTRIES/2),new Uint8Array(MAX_AUDIO_TABLE_BYTES/2));
 const aggregate=new File([box('moov',box('trak',box('mdia',box('minf',box('stbl',join(box('stco',half),box('stco',half)))))))],'global-tables.m4a');
 for(const file of [table(join(n32(0),n32(MAX_AUDIO_TABLE_ENTRIES+1))),table(join(n32(0),n32(MAX_AUDIO_TABLE_ENTRIES),new Uint8Array(MAX_AUDIO_TABLE_BYTES))),new File([base.slice(0,mdat),aggregate],'global.m4a')]){
  let reads=0;const slice=file.slice.bind(file);
  file.slice=(start=0,end=file.size,type)=>{const b=slice(start,end,type),read=b.arrayBuffer.bind(b);b.arrayBuffer=()=>{reads+=b.size;return read();};return b;};
  let rejected=false;try{await audioMetadataView(file,'audio/mp4');}catch(e){rejected=e instanceof AudioMetadataLimitError;}assert(rejected&&reads<1024,'preflight sin leer payload');
  let message='';try{await local(file);}catch(e){message=(e as Error).message;}assert(message.includes('supera los límites de metadatos')&&!message.includes('dañado'),'error recurso accionable');
 }
 // No count-based allocation for constant sample size. Full uint32 count cannot
 // claim more sample bytes than the file actually contains.
 const constant=new File([table(join(n32(0),n32(1),n32(MAX_AUDIO_TABLE_ENTRIES+1)),'stsz'),box('free',new Uint8Array(MAX_AUDIO_TABLE_ENTRIES))],'constant.m4a');
 const view=await audioMetadataView(constant,'audio/mp4');assert(view===constant,'constant stsz sin tabla ni cap por count');
 const parsed=await parseBlob(view,{skipCovers:true,maxMetadataEntries:MAX_AUDIO_TABLE_ENTRIES,maxMemoryAllocation:MAX_ID3_BYTES});assert(!parsed.format.codec,'tabla aislada no inventa codec');
 for(const [type,payload] of [
  ['stsz',join(n32(0),n32(1),n32(0xffffffff))],
  ['stsz',join(n32(0),n32(0),n32(2),n32(1))],
  ['stco',join(n32(0),n32(2),n32(1))],
  ['stsc',join(n32(0),n32(1),n32(1))],
  ['stts',join(n32(0),n32(1),n32(1))],
  ['co64',join(n32(0),n32(1),n32(1))],
  ['stsd',join(n32(0),n32(1),n32(7),text('mp4a'))]
 ] as const){let rejected=false;try{await audioMetadataView(table(payload,type),'audio/mp4');}catch(e){rejected=e instanceof ArtworkError&&e.code==='tag-invalid';}assert(rejected,`${type}: count/stride/payload inválido`);}
});
await check('MP4 primer parseo: 4 tags de 1 MiB se omiten antes de leer strings; tags pequeños conservados',async()=>{
 const title=(payload:Uint8Array)=>{const data=box('data',join(n32(1),n32(0),payload));return join(n32(data.length+8),new Uint8Array([0xa9,110,97,109]),data);};
 const huge=withIlst(join(...Array.from({length:4},()=>title(new Uint8Array(1024*1024).fill(65)))));
 let total=0,max=0,warning='';const original=Blob.prototype.arrayBuffer;
 Blob.prototype.arrayBuffer=function(){total+=this.size;max=Math.max(max,this.size);return original.call(this);};
 let metadata;
 try{const view=await audioMetadataView(huge,'audio/mp4',false,code=>{warning=code;});metadata=await parseBlob(view,{duration:true,skipCovers:true,maxMetadataEntries:MAX_AUDIO_TABLE_ENTRIES,maxMemoryAllocation:MAX_ID3_BYTES});}
 finally{Blob.prototype.arrayBuffer=original;}
 detail=` [lecturas pre-copy/hash ${total} bytes; lectura máxima ${max}]`;
 assert(warning==='tag-size'&&total<65536&&max<65536,`lecturas pre-copy/hash ${total}/${max}; ${warning}`);
 assert(!metadata.common.title&&!metadata.native.iTunes?.some(t=>typeof t.value==='string'&&t.value.length>=1024*1024),'sin strings grandes retenidos');
 const small=withIlst(title(text('Título propio ñ'))),r=await local(small);assert(r.track.title==='Título propio ñ','tag válido');
 const optional=Array.from({length:4},()=>box('udta',box('meta',join(n32(0),box('ilst',title(new Uint8Array(1024*1024).fill(65)))))));
 const separate=new File([base.slice(0,moov),box('moov',join(...moovParts,...optional))],'global.m4a');
 total=0;warning='';Blob.prototype.arrayBuffer=function(){total+=this.size;return original.call(this);};
 try{const parsed=await parseBlob(await audioMetadataView(separate,'audio/mp4',false,code=>{warning=code;}),{duration:true,skipCovers:true,maxMetadataEntries:MAX_AUDIO_TABLE_ENTRIES,maxMemoryAllocation:MAX_ID3_BYTES});assert(parsed.common.title?.length===1024*1024,'primer tag acotado conservado');}
 finally{Blob.prototype.arrayBuffer=original;}
 assert(warning==='tag-size'&&total<MAX_ID3_BYTES+65536,`presupuesto global ${total}`);detail+=` [4 contenedores separados: ${total} bytes leídos]`;
 const crowded=withIlst(box('name',join(...Array.from({length:129},()=>box('data',join(n32(1),n32(0),text('x')))))));warning='';
 const crowdedView=await audioMetadataView(crowded,'audio/mp4',false,code=>{warning=code;});
 assert(warning==='tag-size'&&crowdedView.size===crowded.size,'contador incluye data dentro de tags');
 const imported=await local(huge);assert(imported.artworkWarning==='tag-size'&&await verifiedAsset(imported.track.assetId,true),'audio conservado con estado honesto');
});
await check('WAV LIST/INFO malformado antes/después de PCM recupera .2s y hash; tags válidos conservados',async()=>{
 const broken=chunk('LIST',join(text('INFO'),text('INAM'),n32(0xffffff,true),text('x')));
 for(const chunks of [[broken,chunk('data',pcm)],[chunk('data',pcm),broken]]){
  const file=riff(chunk('fmt ',fmt),...chunks),r=await local(file);assert(Math.abs(r.track.duration-.2)<.00001,'PCM duration');
  assert(r.artworkWarning==='tag-invalid','omisión explícita');assert((await verifiedAsset(r.track.assetId,true))?.sha256===await hash(file),'hash intacto');
 }
 const valid=riff(chunk('fmt ',fmt),chunk('LIST',join(text('INFO'),chunk('INAM',text('PCM propio\0')))),chunk('data',pcm));
 assert((await local(valid)).track.title==='PCM propio','INFO válido');
});
await check('WAV presupuesto acumulado antes del parser; LIST/wavl queda byte a byte intacto incluso retry',async()=>{
 const lists=Array.from({length:4},()=>chunk('LIST',join(text('INFO'),chunk('INAM',new Uint8Array(1024*1024).fill(65)))));
 const file=riff(chunk('fmt ',fmt),...lists,chunk('data',pcm));let bytes=0;const read=Blob.prototype.arrayBuffer;
 Blob.prototype.arrayBuffer=function(){bytes+=this.size;return read.call(this);};
 try{const metadata=await parseBlob(await audioMetadataView(file,'audio/wav'),{duration:true,skipCovers:true,maxMemoryAllocation:MAX_ID3_BYTES,maxMetadataEntries:128});assert(metadata.format.duration===.2,'PCM');assert(bytes<MAX_ID3_BYTES+65536,`lecturas ${bytes}`);detail=` [lecturas pre-copy/hash ${bytes} bytes]`;}
 finally{Blob.prototype.arrayBuffer=read;}
 const wavl=riff(chunk('fmt ',fmt),chunk('LIST',join(text('wavl'),chunk('data',pcm))));
 for(const retry of [false,true])assert(await hash(await audioMetadataView(wavl,'audio/wav',retry))===await hash(wavl),'LIST/wavl inmutable');
 // The installed parser ignores wavl; it must not fabricate a duration or accept it as flat PCM.
 let rejected=false;try{await local(wavl);}catch{rejected=true;}assert(rejected,'wavl no soportado no aceptado como PCM plano');
});
await check('WAV entradas ID3 globales y CSET/bext opcionales malformados: recuperación sin cambiar audio',async()=>{
 const frames=tag(join(...Array.from({length:80},()=>frame('TIT2',join(new Uint8Array([3]),text('propio'))))));
 const file=riff(chunk('fmt ',fmt),chunk('ID3 ',frames),chunk('id3 ',frames),chunk('data',pcm));let warning='';
 const view=await audioMetadataView(file,'audio/wav',false,code=>{warning=code;});assert(warning==='tag-size','128 frames globales');
 const metadata=await parseBlob(view,{duration:true,skipCovers:true,maxMetadataEntries:128,maxMemoryAllocation:MAX_ID3_BYTES});assert(metadata.format.duration===.2,'PCM después de ID3');
 for(const type of ['CSET','bext']){const own=riff(chunk('fmt ',fmt),chunk(type,new Uint8Array(1)),chunk('data',pcm)),r=await local(own);assert(r.artworkWarning==='tag-invalid'&&r.track.duration===.2,'metadata opcional');assert((await verifiedAsset(r.track.assetId,true))?.sha256===await hash(own),'original');}
});
(window as unknown as {pulsoArtworkContainers:unknown}).pulsoArtworkContainers={passed:results.every(r=>r.startsWith('PASS')),results};
document.querySelector('#results')!.textContent+='\nCOMPLETADO';
