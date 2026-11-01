import type {Mp4AlbumTag} from './album-metadata';
/** Optional local artwork. Audio parsing keeps skipCovers:true. No audio bytes are written here. */
export const MAX_ARTWORK_BYTES=2*1024*1024;
export const MAX_ID3_BYTES=2*1024*1024;
// At most 16 MiB of decoded RGBA pixels, with a separate limit on either axis.
export const MAX_ARTWORK_DIMENSION=4096;
export const MAX_ARTWORK_PIXELS=4*1024*1024;
export type ArtworkFailure='image-size'|'image-format'|'image-structure'|'image-dimensions'|'decode-unavailable'|'decode-failed'|'tag-size'|'tag-invalid'|'tag-unsupported'|'format-not-inspected'|'storage-failed'|'conflict';
export type ArtworkInspection={state:'ready';blob:Blob;mime:'image/png'|'image/jpeg'|'image/webp';width:number;height:number;sha256:string}|{state:'absent'|'not-inspected'|'invalid'|'omitted';failureCode?:ArtworkFailure};
export class ArtworkError extends Error {constructor(public readonly code:ArtworkFailure){super(code);}}
const fail=(code:ArtworkFailure):never=>{throw new ArtworkError(code);};
const ascii=(b:Uint8Array,a:number,n:number)=>String.fromCharCode(...b.subarray(a,a+n));
const u32=(b:Uint8Array,o:number,le=false)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(o,le);
const u16=(b:Uint8Array,o:number)=>b[o]*256+b[o+1];
function dimensions(b:Uint8Array):{mime:'image/png'|'image/jpeg'|'image/webp';width:number;height:number}{
 if(b.length>=33&&ascii(b,0,8)==='\x89PNG\r\n\x1a\n'){
  if(u32(b,8)!==13||ascii(b,12,4)!=='IHDR')return fail('image-structure');
  let end=false;let count=0;
  for(let p=8;p<b.length;){if(++count>4096||p+12>b.length)return fail('image-structure');const size=u32(b,p);const type=ascii(b,p+4,4);if(size>b.length-p-12||type==='acTL'||type==='IHDR'&&p!==8)return fail('image-structure');p+=size+12;if(type==='IEND'){if(size!==0||p!==b.length)return fail('image-structure');end=true;break;}}
  if(!end)return fail('image-structure');return {mime:'image/png',width:u32(b,16),height:u32(b,20)};
 }
 if(b.length>=4&&b[0]===255&&b[1]===216){
  if(b.at(-2)!==255||b.at(-1)!==217)return fail('image-structure');
  let count=0,entropy=false;let result:ReturnType<typeof dimensions>|undefined;
  for(let p=2;p<b.length;){
   if(entropy){while(p<b.length&&b[p]!==255)p++;}
   if(p>=b.length||b[p++]!==255)return fail('image-structure');while(b[p]===255)p++;
   if(p>=b.length)return fail('image-structure');const marker=b[p++];
   if(entropy&&(marker===0||marker>=0xd0&&marker<=0xd7))continue;
   if(++count>512)return fail('image-structure');
   if(marker===0xd9){if(p!==b.length||!result)return fail('image-structure');return result;}
   if(marker===0xd8||marker===0xdc||p+2>b.length)return fail('image-structure');
   const size=u16(b,p);if(size<2||size>b.length-p)return fail('image-structure');
   if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){
    if(![0xc0,0xc1,0xc2].includes(marker)||result||size<8||size!==8+3*b[p+7])return fail('image-structure');
    result={mime:'image/jpeg',height:u16(b,p+3),width:u16(b,p+5)};
   }
   if(marker===0xda){if(!result||size<6)return fail('image-structure');entropy=true;}
   p+=size;
  }return fail('image-structure');
 }
 if(b.length>=30&&ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WEBP'){
  if(u32(b,4,true)!==b.length-8)return fail('image-structure');
  let result:ReturnType<typeof dimensions>|undefined;let encoded:ReturnType<typeof dimensions>|undefined;let count=0;
  for(let p=12;p<b.length;){
   if(++count>512||p+8>b.length)return fail('image-structure');const size=u32(b,p+4,true),kind=ascii(b,p,4),s=p+8;
   if(size>b.length-s||s+size+(size%2)>b.length)return fail('image-structure');
   if(kind==='ANIM'||kind==='ANMF')return fail('image-structure');
   if(kind==='VP8X'){if(result||encoded||size!==10||(b[s]&2))return fail('image-structure');result={mime:'image/webp',width:1+b[s+4]+256*b[s+5]+65536*b[s+6],height:1+b[s+7]+256*b[s+8]+65536*b[s+9]};}
   if(kind==='VP8 '){if(encoded||size<10||ascii(b,s+3,3)!=='\x9d\x01\x2a')return fail('image-structure');encoded={mime:'image/webp',width:(b[s+6]+256*b[s+7])&16383,height:(b[s+8]+256*b[s+9])&16383};}
   if(kind==='VP8L'){if(encoded||size<5||b[s]!==0x2f)return fail('image-structure');const bits=u32(b,s+1,true);encoded={mime:'image/webp',width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}
   p=s+size+(size%2);
  }if(!encoded||result&&(result.width!==encoded.width||result.height!==encoded.height))return fail('image-structure');return result??encoded;
 }
 return fail('image-format');
}
export async function validateArtwork(image:Blob):Promise<Extract<ArtworkInspection,{state:'ready'}>>{
 if(image.size===0||image.size>MAX_ARTWORK_BYTES)fail('image-size');
 const b=new Uint8Array(await image.arrayBuffer());if(b.length!==image.size)fail('image-structure');
 const info=dimensions(b);
 if(image.type&&image.type.toLowerCase()!==info.mime)fail('image-format');
 if(!info.width||!info.height||info.width>MAX_ARTWORK_DIMENSION||info.height>MAX_ARTWORK_DIMENSION||info.width*info.height>MAX_ARTWORK_PIXELS)fail('image-dimensions');
 if(typeof createImageBitmap!=='function')fail('decode-unavailable');
 const blob=new Blob([b],{type:info.mime});
 let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(blob,{imageOrientation:'none'});}catch{return fail('decode-failed');}
 try{if(bitmap.width!==info.width||bitmap.height!==info.height)fail('image-dimensions');}finally{bitmap.close();}
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
 return {state:'ready',blob,...info,sha256};
}
const syncSafe=(b:Uint8Array,p:number)=>{if(b.subarray(p,p+4).length!==4||b.subarray(p,p+4).some(v=>v>127))return fail('tag-invalid');return b[p]*2097152+b[p+1]*16384+b[p+2]*128+b[p+3];};
/** Parser-only view, never used for copy/hash. MP3 skips padding/APIC bodies;
 * budgets cover all leading ID3 blocks together. Container preflight bounds global
 * optional metadata before the first parse; retry omits it, retaining audio offsets. */
export async function audioMetadataView(file:File,mime:string,omitTags=false,onOmit:(code:ArtworkFailure)=>void=()=>{},onAlbum:(tag:Mp4AlbumTag)=>void=()=>{}):Promise<File>{
 if(mime==='audio/wav')return riffMetadataView(file,omitTags,onOmit);
 if(mime==='audio/mp4')return mp4MetadataView(file,omitTags,onOmit,onAlbum);
 if(mime!=='audio/mpeg')return file;
 const parts:BlobPart[]=[];let offset=0,budget=MAX_ID3_BYTES,frames=0;
 for(let tags=0;;tags++){
  const h=new Uint8Array(await file.slice(offset,offset+10).arrayBuffer());
  if(ascii(h,0,3)!=='ID3')break;
  if(tags>=128||h.length!==10)fail('tag-invalid');
  const size=syncSafe(h,6),end=offset+10+size;
  if(end>file.size)fail('tag-invalid');
  const supported=[3,4].includes(h[3])&&h[4]===0&&h[5]===0;
  if(!omitTags&&!supported)onOmit('tag-unsupported');
  const kept:BlobPart[]=[];let bytes=0;
  // Preserve bounded feature-bearing tags for the real parser (extended headers,
  // unsynchronisation, etc.); an optional-tag parser error can retry the audio view.
  if(!omitTags&&!supported&&[2,3,4].includes(h[3])&&size+10<=budget){parts.push(file.slice(offset,end));budget-=size+10;}
  if(!omitTags&&supported)for(let p=offset+10;p<end;){
   const f=new Uint8Array(await file.slice(p,Math.min(p+10,end)).arrayBuffer());
   if(f[0]===0)break; // padding: no allocation or read proportional to its length
   if(f.length!==10||! /^[A-Z0-9]{4}$/.test(ascii(f,0,4))){onOmit('tag-invalid');break;}
   const length=h[3]===4?syncSafe(f,4):u32(f,4);
   if(!length||length>end-p-10){onOmit('tag-invalid');break;}
   if(++frames>128){onOmit('tag-size');break;}
   if(ascii(f,0,4)!=='APIC'){
    if(length+10<=budget){kept.push(f,file.slice(p+10,p+10+length));bytes+=10+length;budget-=10+length;}
    else onOmit('tag-size');
   }
   p+=10+length;
  }
  if(bytes){const header=h.slice();let n=bytes;for(let i=9;i>=6;i--){header[i]=n&127;n>>>=7;}parts.push(header,...kept);}
  offset=end+(h[3]===4&&(h[5]&16)?10:0);
  if(offset>file.size)fail('tag-invalid');
 }
 if(offset===0)return file;
 parts.push(file.slice(offset));return new File(parts,file.name,{type:mime});
}
/** Optional local extraction: bounded MP4 covr or RIFF ID3 walks, otherwise MP3 ID3.
 * ID3v2.3/2.4 without flags supported; parser sees one APIC frame <=2 MiB only.
 * Other versions/features remain explicitly uninspected. No remote locations followed;
 * unknown tags, chapters and nested metadata never reach the optional parser. */
export async function inspectEmbeddedArtwork(file:Blob,mime:string):Promise<ArtworkInspection>{
 try{
  if(mime==='audio/mp4')return await inspectMp4(file);
  if(mime==='audio/wav')return await inspectRiff(file);
  if(mime!=='audio/mpeg')return {state:'not-inspected',failureCode:'format-not-inspected'};
  const h=new Uint8Array(await file.slice(0,10).arrayBuffer());
  if(ascii(h,0,3)!=='ID3')return {state:'absent'};
  if(h.length!==10)fail('tag-invalid');
  if(![3,4].includes(h[3])||h[4]!==0||h[5]!==0)return {state:'not-inspected',failureCode:'tag-unsupported'};
  const size=syncSafe(h,6);if(size+10>MAX_ID3_BYTES)return {state:'omitted',failureCode:'tag-size'};
  if(size>file.size-10)fail('tag-invalid');
  const b=new Uint8Array(await file.slice(0,size+10).arrayBuffer());if(b.length!==size+10)fail('tag-invalid');
  let picture:Uint8Array|undefined;let count=0;
  for(let p=10;p<b.length;){
   if(b[p]===0){if(b.subarray(p).some(v=>v!==0))fail('tag-invalid');break;}
   if(++count>128)return {state:'omitted',failureCode:'tag-size'};
   if(p+10>b.length||! /^[A-Z0-9]{4}$/.test(ascii(b,p,4)))fail('tag-invalid');
   const length=h[3]===4?syncSafe(b,p+4):u32(b,p+4);
   if(!length||length>b.length-p-10)fail('tag-invalid');
   if(ascii(b,p,4)==='APIC'&&!picture){if(b[p+8]||b[p+9])return {state:'not-inspected',failureCode:'tag-unsupported'};picture=b.slice(p,p+10+length);}
   p+=10+length;
  }
  if(!picture)return {state:'absent'};
  const body=picture.subarray(10),encoding=body[0];
  if(encoding>3)fail('tag-invalid');
  const mimeEnd=body.indexOf(0,1);if(mimeEnd<2||mimeEnd+2>=body.length)fail('tag-invalid');
  let descriptionEnd=-1;const step=encoding===1||encoding===2?2:1;
  for(let p=mimeEnd+2;p+step<=body.length;p+=step)if(body[p]===0&&(step===1||body[p+1]===0)){descriptionEnd=p+step;break;}
  if(descriptionEnd<0||descriptionEnd>=body.length)fail('tag-invalid');
  const block=new Uint8Array(10+picture.length);block.set(h);block.set(picture,10);
  let n=picture.length;for(let i=9;i>=6;i--){block[i]=n&127;n>>>=7;}
  const {parseBuffer}=await import('music-metadata');
  const metadata=await parseBuffer(block,{mimeType:'audio/mpeg'},{skipCovers:false,skipPostHeaders:true,duration:false,maxMemoryAllocation:MAX_ID3_BYTES,maxMetadataEntries:128,maxChapterCount:1});
  const cover=metadata.common.picture?.[0];if(!cover)return fail('tag-invalid');
  return await validateArtwork(new Blob([new Uint8Array(cover.data)],{type:cover.format}));
 }catch(error){const failureCode=error instanceof ArtworkError?error.code:'tag-invalid';return {state:failureCode==='decode-unavailable'?'not-inspected':failureCode==='tag-size'?'omitted':failureCode==='tag-unsupported'?'not-inspected':'invalid',failureCode};}
}

// Container walkers read headers only, skipping mdat/data/unknown payloads. Shared
// count budget bounds seeks, depth is restricted to the five known metadata levels.
// Metadata boxes/chunks <=2 MiB (including headers), at most one decoded picture.
const MAX_CONTAINER_ENTRIES=512;
const MAX_CONTAINER_DEPTH=5;
async function bytesAt(file:Blob,start:number,length:number):Promise<Uint8Array<ArrayBuffer>>{
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<0||length>file.size-start)fail('tag-invalid');
 const b=new Uint8Array(await file.slice(start,start+length).arrayBuffer());
 if(b.length!==length)fail('tag-invalid');return b;
}
interface Box {type:string;start:number;body:number;end:number}
async function mp4Box(file:Blob,start:number,end:number):Promise<Box>{
 if(end-start<8)fail('tag-invalid');
 const h=await bytesAt(file,start,8);let size=u32(h,0),header=8;
 if(size===1){
  if(end-start<16)fail('tag-invalid');
  const ext=await bytesAt(file,start+8,8),hi=u32(ext,0),lo=u32(ext,4);
  // No BigInt-to-number rounding or allocation before checking the enclosing range.
  if(hi>0x1fffff)fail('tag-invalid');size=hi*4294967296+lo;header=16;
 }else if(size===0)size=end-start;
 if(!Number.isSafeInteger(size)||size<header||size>end-start)fail('tag-invalid');
 return {type:ascii(h,4,4),start,body:start+header,end:start+size};
}
async function inspectMp4(file:Blob):Promise<ArtworkInspection>{
 const first=await mp4Box(file,0,file.size);
 if(first.type!=='ftyp'||first.end-first.body<8)fail('tag-invalid');
 let count=0,cover:Box|undefined,unsupported=false;
 const walk=async(start:number,end:number,path:string,depth=0):Promise<void>=>{
  if(depth>MAX_CONTAINER_DEPTH)fail('tag-size');
  for(let p=start;p<end;){
   if(++count>MAX_CONTAINER_ENTRIES)fail('tag-size');
   const box=await mp4Box(file,p,end),next=path+'/'+box.type;
   if(next==='/moov'||next==='/moov/udta'||next==='/moov/meta'||next==='/moov/udta/meta'||next==='/moov/meta/ilst'||next==='/moov/udta/meta/ilst'){
    let body=box.body;
    if(box.type==='meta'||box.type==='ilst'){
     if(box.end-box.start>MAX_ID3_BYTES)fail('tag-size');
     if(box.type==='meta'){
      if(box.end-body<4)fail('tag-invalid');const flags=await bytesAt(file,body,4);if(flags.some(v=>v!==0))fail('tag-unsupported');body+=4;
     }
    }
    await walk(body,box.end,next,depth+1);
   }else if((path==='/moov/meta/ilst'||path==='/moov/udta/meta/ilst')&&box.type==='covr'){
    if(cover)fail('tag-unsupported');
    if(box.end-box.start>MAX_ID3_BYTES)fail('tag-size');cover=box;
   }
   p=box.end;
  }
 };
 await walk(0,file.size,'');
 if(!cover)return {state:'absent'};
 let candidate:Blob|undefined;
 for(let p=cover.body;p<cover.end;){
  if(++count>MAX_CONTAINER_ENTRIES)fail('tag-size');const data=await mp4Box(file,p,cover.end);
  if(data.type==='data'){
   if(candidate)fail('tag-unsupported');
   if(data.end-data.body<8)fail('tag-invalid');const h=await bytesAt(file,data.body,8),kind=u32(h,0);
   if(kind!==13&&kind!==14)unsupported=true;
   else{
    const length=data.end-data.body-8;if(!length||length>MAX_ARTWORK_BYTES)fail('image-size');
    candidate=new Blob([await bytesAt(file,data.body+8,length)],{type:kind===13?'image/jpeg':'image/png'});
   }
  }else fail('tag-unsupported');
  p=data.end;
 }
 if(unsupported)fail('tag-unsupported');if(!candidate)return fail('tag-invalid');
 return validateArtwork(candidate);
}
async function inspectRiff(file:Blob):Promise<ArtworkInspection>{
 const h=await bytesAt(file,0,12);
 if(ascii(h,0,4)!=='RIFF'||ascii(h,8,4)!=='WAVE'||u32(h,4,true)!==file.size-8)fail('tag-invalid');
 let count=0,tag:Blob|undefined;
 for(let p=12;p<file.size;){
  if(++count>MAX_CONTAINER_ENTRIES)fail('tag-size');
  const h=await bytesAt(file,p,8),length=u32(h,4,true),body=p+8;
  if(length>file.size-body||length+(length%2)>file.size-body)fail('tag-invalid');
  if(['ID3 ','id3 '].includes(ascii(h,0,4))){
   if(tag)fail('tag-unsupported');if(length>MAX_ID3_BYTES)fail('tag-size');
   const header=await bytesAt(file,body,Math.min(10,length));
   if(header.length!==10||ascii(header,0,3)!=='ID3'||syncSafe(header,6)+10!==length)fail('tag-invalid');
   tag=file.slice(body,body+length);
  }
  p=body+length+(length%2);
 }
 return tag?inspectEmbeddedArtwork(tag,'audio/mpeg'):{state:'absent'};
}

/** Parser-only views replace optional chunks/boxes with equally sized padding.
 * Original offsets, duration inputs, file size and copy/hash source stay unchanged.
 * On retry, malformed optional tags cannot prevent parsing subsequent real audio.
 * No payload proportional to audio/padding size is materialized. */
// Audio tables need a separate allowance: the library unfortunately uses the same
// option for tags and stco/stsc/stts. Preflight bounds their aggregate encoded size
// and count before the parser allocates its decoded arrays. No audio table is skipped.
export const MAX_AUDIO_TABLE_BYTES=2*1024*1024;
// Every encoded/materialized table entry costs at least 4 bytes. Shared across
// tracks/tables: <=524288 entries AND <=2 MiB encoded payload (including headers).
// Installed AtomToken retains stco/co64 numbers and stsc/stts objects; stsz only
// sums sizes without retaining an array when chapters are disabled. Estimate up
// to ~32 MiB decoded at 64 bytes/entry, plus encoded buffers, NOT a heap guarantee.
export const MAX_AUDIO_TABLE_ENTRIES=Math.floor(MAX_AUDIO_TABLE_BYTES/4);
export class AudioMetadataLimitError extends Error {
 constructor(){super('El audio supera los límites de metadatos. Usa un archivo con tablas de audio más pequeñas.');}
}
async function riffMetadataView(file:File,omitTags:boolean,onOmit:(code:ArtworkFailure)=>void):Promise<File>{
 const h=await bytesAt(file,0,12);
 if(ascii(h,0,4)!=='RIFF'||ascii(h,8,4)!=='WAVE'||u32(h,4,true)!==file.size-8)fail('tag-invalid');
 const parts:BlobPart[]=[];let previous=0,count=0,budget=MAX_ID3_BYTES,entries=0;
 for(let p=12;p<file.size;){
  if(++count>MAX_CONTAINER_ENTRIES)fail('tag-size');
  const h=await bytesAt(file,p,8),size=u32(h,4,true),body=p+8,type=ascii(h,0,4);
  if(size+(size%2)>file.size-body)fail('tag-invalid');
  // LIST/wavl can carry sound. Only LIST/INFO is optional metadata.
  const info=type==='LIST'&&size>=4&&ascii(await bytesAt(file,body,4),0,4)==='INFO';
  const id3=['id3 ','ID3 '].includes(type);
  const optional=info||id3||['bext','CSET'].includes(type);
  let invalid=false,unsupported=false;
  if(info&&!omitTags&&size<=budget){
   for(let q=body+4;q<body+size;){
    if(++entries>128)break;
    if(body+size-q<8){invalid=true;break;}
    const entry=await bytesAt(file,q,8),length=u32(entry,4,true);
    if(length+(length%2)>body+size-q-8){invalid=true;break;}
    q+=8+length+(length%2);
   }
  }else if(id3&&!omitTags&&size<=budget){
   const header=await bytesAt(file,body,Math.min(10,size));
   if(size<10||ascii(header,0,3)!=='ID3')invalid=true;
   else if(![3,4].includes(header[3])||header[4]!==0||header[5]!==0)unsupported=true;
   else try{
    const end=body+10+syncSafe(header,6);if(end>body+size)fail('tag-invalid');
    for(let q=body+10;q<end;){
     const f=await bytesAt(file,q,Math.min(10,end-q));if(f[0]===0)break;
     if(++entries>128)break;
     if(f.length!==10||! /^[A-Z0-9]{4}$/.test(ascii(f,0,4)))fail('tag-invalid');
     const length=header[3]===4?syncSafe(f,4):u32(f,4);
     if(!length||length>end-q-10)fail('tag-invalid');q+=10+length;
    }
   }catch{invalid=true;}
  }else if(optional)entries++;
  if((type==='CSET'&&size<8)||(type==='bext'&&size<602))invalid=true;
  if(optional){
   if(omitTags||size>budget||entries>128||invalid||unsupported){
    onOmit(invalid?'tag-invalid':unsupported?'tag-unsupported':'tag-size');
    parts.push(file.slice(previous,p),new TextEncoder().encode('JUNK'));previous=p+4;
   }else budget-=size;
  }
  p=body+size+(size%2);
 }
 if(!parts.length)return file;parts.push(file.slice(previous));return new File(parts,file.name,{type:'audio/wav'});
}
async function mp4MetadataView(file:File,omitTags:boolean,onOmit:(code:ArtworkFailure)=>void,onAlbum:(tag:Mp4AlbumTag)=>void):Promise<File>{
 const parts:BlobPart[]=[];let previous=0,count=0,budget=MAX_ID3_BYTES,tags=0,tableBytes=0,tableEntries=0;
 // Scan only optional headers, never read their text/image payloads. If an optional
 // container is malformed or exceeds either global budget, rename it as padding.
 const scanTags=async(start:number,end:number,type:string,depth:number):Promise<void>=>{
  if(depth>MAX_CONTAINER_DEPTH)fail('tag-size');
  let albumData=false;
  const albumTag=['trkn','disk','aART','cpil'].includes(type);
  if(type==='meta'){const flags=await bytesAt(file,start,4);if(flags.some(v=>v!==0))fail('tag-unsupported');start+=4;}
  for(let p=start;p<end;){
   if(++count>MAX_CONTAINER_ENTRIES||++tags>128)fail('tag-size');
   const b=await mp4Box(file,p,end);
   if(albumTag){
    if(b.type==='data'){albumData=true;onAlbum({tag:type,payload:b.end-b.body<=1216?await bytesAt(file,b.body,b.end-b.body):null});}
    else onAlbum({tag:type,payload:null});
   }
   if(['udta','meta','ilst'].includes(b.type)||type==='ilst')await scanTags(b.body,b.end,b.type,depth+1);
   p=b.end;
  }
  if(albumTag&&!albumData)onAlbum({tag:type,payload:null});
 };
 const walk=async(start:number,end:number,depth=0):Promise<void>=>{
  if(depth>8)fail('tag-size');
  for(let p=start;p<end;){
   if(++count>MAX_CONTAINER_ENTRIES)fail('tag-size');const b=await mp4Box(file,p,end);
   if(b.type==='udta'||b.type==='meta'){
    let reason:ArtworkFailure|undefined;
    if(omitTags||b.end-b.start>budget)reason='tag-size';
    else try{await scanTags(b.body,b.end,b.type,0);}catch(e){reason=e instanceof ArtworkError?e.code:'tag-invalid';}
    if(reason){onOmit(reason);parts.push(file.slice(previous,p+4),new TextEncoder().encode('free'));previous=p+8;}
    else budget-=b.end-b.start;
   }else if(['moov','trak','mdia','minf','stbl'].includes(b.type))await walk(b.body,b.end,depth+1);
   else if(['stco','co64','stsc','stts','stsd','stsz'].includes(b.type)){
    const length=b.end-b.body,header=b.type==='stsz'?12:8;
    if(length<header)fail('tag-invalid');
    const h=await bytesAt(file,b.body,header),entries=u32(h,b.type==='stsz'?8:4);
    // Constant-size stsz has no per-sample work/allocation in the real parser.
    // Bound its declared audio bytes by the file, rather than limiting duration.
    const constant=b.type==='stsz'&&u32(h,4)!==0;
    if(constant&&u32(h,4)*entries>file.size)fail('tag-invalid');
    tableEntries+=constant?0:entries;tableBytes+=length;
    if(tableEntries>MAX_AUDIO_TABLE_ENTRIES||tableBytes>MAX_AUDIO_TABLE_BYTES)throw new AudioMetadataLimitError();
    if(b.type==='stsd'){
     // Variable-length sample descriptions: each needs its own size/FourCC.
     if(entries>Math.floor((length-header)/8))fail('tag-invalid');
     let q=b.body+header;
     for(let i=0;i<entries;i++){const entry=await mp4Box(file,q,b.end);q=entry.end;}
     if(q!==b.end)fail('tag-invalid');
    }else{
     const stride=b.type==='stsc'?12:['co64','stts'].includes(b.type)?8:4;
     if(length-header!==(constant?0:entries*stride))fail('tag-invalid');
    }
   }
   p=b.end;
  }
 };
 await walk(0,file.size);if(!parts.length)return file;
 parts.push(file.slice(previous));return new File(parts,file.name,{type:'audio/mp4'});
}
