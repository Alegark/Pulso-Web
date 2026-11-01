import {LYRICS_LIMITS,LyricsError,parseLyrics,parseSyltEvents,type LyricsCue,type LyricsFormat} from '../library/lyrics-parser';
export type EmbeddedLyricsFailure='payload-size'|'walk-limit'|'tag-invalid'|'tag-unsupported'|'encoding-unsupported'|'sylt-frames'|'format-not-inspected'| 'lyrics-invalid'|'lyrics-limit';
export type LyricsSource={kind:'embedded-id3'|'embedded-riff-id3'|'embedded-mp4';tag:'USLT'|'SYLT'|'©lyr';language:string|null;descriptor:string};
export type EmbeddedLyricsInspection={state:'ready';text:string;format:LyricsFormat|'sylt';cues?:LyricsCue[];source:LyricsSource;warnings:EmbeddedLyricsFailure[]}|{state:'absent';scope:'leading-id3v2'|'riff-id3'|'moov-ilst'}|{state:'omitted'|'invalid'|'not-inspected';failureCode:EmbeddedLyricsFailure};
class InspectionError extends Error{constructor(readonly code:EmbeddedLyricsFailure){super(code);}}
const fail=(code:EmbeddedLyricsFailure):never=>{throw new InspectionError(code);};
const ascii=(b:Uint8Array,p:number,n:number)=>String.fromCharCode(...b.subarray(p,p+n));
const u32=(b:Uint8Array,p:number,le=false)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,le);
const safe=(b:Uint8Array,p:number)=>{if(b.length<p+4||b.subarray(p,p+4).some(x=>x>127))return fail('tag-invalid');return b[p]*2097152+b[p+1]*16384+b[p+2]*128+b[p+3];};
/** Optional extractor only: <=128 ID3 frames, 512 boxes/chunks, depth 5.
 * A shared 128 KiB payload allowance is checked BEFORE reading/decoding each lyric.
 * Headers have a separate 64 KiB allowance. Audio, pictures and padding are skipped.
 * Absent is scoped: leading ID3v2 only; RIFF ID3 chunks only; ©lyr only
 * under moov/(udta/)?meta/ilst. Other tag families are not searched.
 * These bounds do not describe the separate general audio parser/import copy. */
export async function inspectEmbeddedLyrics(file:Blob,mime:string):Promise<EmbeddedLyricsInspection>{
 let headers=0,payload=0,frames=0,entries=0;
 const candidates:Extract<EmbeddedLyricsInspection,{state:'ready'}>[]=[],issues:EmbeddedLyricsFailure[]=[];
 const read=async(start:number,size:number,lyric=false)=>{
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<0||size>file.size-start)fail('tag-invalid');
  if(lyric){if(size>LYRICS_LIMITS.bytes-payload)fail('payload-size');payload+=size;}else{headers+=size;if(headers>65536)fail('walk-limit');}
  const b=new Uint8Array(await file.slice(start,start+size).arrayBuffer());if(b.length!==size)fail('tag-invalid');return b;
 };
 const collect=(text:string,format:LyricsFormat,source:LyricsSource)=>{
  const parsed=parseLyrics(text,format);if(parsed.kind==='absent')return fail('lyrics-invalid');
  candidates.push({state:'ready',text:parsed.text,format,source,warnings:[]});
 };
 const attempt=async(fn:()=>Promise<void>)=>{try{await fn();}catch(e){issues.push(e instanceof InspectionError?e.code:e instanceof LyricsError?(['size','lines','line-size','cues'].includes(e.code)?'lyrics-limit':'lyrics-invalid'):'tag-invalid');}};
 function decoder(b:Uint8Array,encoding:number,endian?:string):string{
  if(!b.length)return '';
  if(encoding===0)return Array.from(b,v=>String.fromCharCode(v)).join('');
  if(encoding===1||encoding===2){
   if(b.length%2)fail('tag-invalid');
   let name=encoding===2?'utf-16be':endian;
   if(b[0]===255&&b[1]===254)name='utf-16le';else if(b[0]===254&&b[1]===255)name='utf-16be';
   if(!name)fail('tag-invalid');return new TextDecoder(name,{fatal:true}).decode(b);
  }
  if(encoding===3)return new TextDecoder('utf-8',{fatal:true}).decode(b);
  return fail('encoding-unsupported');
 }
 function terminated(b:Uint8Array,p:number,encoding:number):{bytes:Uint8Array;next:number}{
  const step=encoding===1||encoding===2?2:1;
  for(let q=p;q+step<=b.length;q+=step)if(b[q]===0&&(step===1||b[q+1]===0))return {bytes:b.subarray(p,q),next:q+step};
  return fail('tag-invalid');
 }
 const id3=async(start:number,end:number,kind:LyricsSource['kind'])=>{
  const h=await read(start,10);if(ascii(h,0,3)!=='ID3')fail('tag-invalid');
  const size=safe(h,6);if(size>end-start-10)fail('tag-invalid');
  if(![3,4].includes(h[3])||h[4]!==0||h[5]!==0)fail('tag-unsupported');
  for(let p=start+10;p<start+10+size;){
   const f=await read(p,Math.min(10,start+10+size-p));if(f[0]===0)break;
   if(++frames>128)fail('walk-limit');
   if(f.length!==10||!/^[A-Z0-9]{4}$/.test(ascii(f,0,4)))fail('tag-invalid');
   const length=h[3]===4?safe(f,4):u32(f,4),tag=ascii(f,0,4);
   if(!length||length>start+10+size-p-10)fail('tag-invalid');
   if(tag==='USLT'||tag==='SYLT')await attempt(async()=>{
    if(f[8]||f[9])fail('tag-unsupported');
    const b=await read(p+10,length,true),encoding=b[0];
    if(encoding>3||h[3]===3&&encoding>1)fail('encoding-unsupported');
    if(b.length<(tag==='SYLT'?7:5)||!/^[a-zA-Z]{3}$/.test(ascii(b,1,3)))fail('tag-invalid');
    if(tag==='SYLT'&&b[4]===1)fail('sylt-frames');
    if(tag==='SYLT'&&(b[4]!==2||b[5]!==1))fail('tag-unsupported');
    const d=terminated(b,tag==='SYLT'?6:4,encoding);
    const endian=d.bytes[0]===255&&d.bytes[1]===254?'utf-16le':d.bytes[0]===254&&d.bytes[1]===255?'utf-16be':undefined;
    const descriptor=decoder(d.bytes,encoding);parseLyrics(descriptor,'plain');
    if(descriptor.length>LYRICS_LIMITS.lineCharacters)fail('lyrics-limit');
    const source:LyricsSource={kind,tag,language:ascii(b,1,3).toLowerCase(),descriptor};
    if(tag==='USLT'){collect(decoder(b.subarray(d.next),encoding,endian).replace(/\0$/,''),'plain',source);return;}
    let q=d.next;const cues:LyricsCue[]=[];
    while(q<b.length){
     if(cues.length>=LYRICS_LIMITS.cues)fail('lyrics-limit');const t=terminated(b,q,encoding);q=t.next;
     if(b.length-q<4)fail('tag-invalid');const time=u32(b,q);q+=4;if(time>LYRICS_LIMITS.timeMs)fail('lyrics-invalid');
     const text=decoder(t.bytes,encoding,endian);if(/[\r\n]/.test(text))fail('lyrics-invalid');
     cues.push({timeMs:time,text});
    }
    const parsed=parseSyltEvents(cues);candidates.push({state:'ready',text:parsed.text,format:'sylt',cues:parsed.cues,source,warnings:[]});
   });
   p+=10+length;
  }
  return start+10+size;
 };
 const riff=async()=>{
  const h=await read(0,12);if(ascii(h,0,4)!=='RIFF'||ascii(h,8,4)!=='WAVE'||u32(h,4,true)!==file.size-8)fail('tag-invalid');
  for(let p=12;p<file.size;){
   if(++entries>512)fail('walk-limit');const h=await read(p,8),size=u32(h,4,true),body=p+8;
   if(size+(size%2)>file.size-body)fail('tag-invalid');
   if(['ID3 ','id3 '].includes(ascii(h,0,4)))await attempt(async()=>{if(size<10||await id3(body,body+size,'embedded-riff-id3')!==body+size)fail('tag-invalid');});
   p=body+size+(size%2);
  }
 };
 const box=async(p:number,end:number)=>{
  if(++entries>512)fail('walk-limit');if(end-p<8)fail('tag-invalid');const h=await read(p,8);let size=u32(h,0),body=p+8;
  if(size===1){if(end-p<16)fail('tag-invalid');const e=await read(p+8,8);if(u32(e,0)>0x1fffff)fail('tag-invalid');size=u32(e,0)*4294967296+u32(e,4);body+=8;}else if(size===0)size=end-p;
  if(!Number.isSafeInteger(size)||size<body-p||size>end-p)fail('tag-invalid');return {type:ascii(h,4,4),body,end:p+size};
 };
 const mp4=async(start:number,end:number,path='',depth=0):Promise<void>=>{
  if(depth>5)fail('walk-limit');
  for(let p=start;p<end;){const b=await box(p,end),next=path+'/'+b.type;
   if(['/moov','/moov/udta','/moov/meta','/moov/udta/meta','/moov/meta/ilst','/moov/udta/meta/ilst'].includes(next)){
    let body=b.body;if(b.type==='meta'){if(b.end-body<4)fail('tag-invalid');if((await read(body,4)).some(v=>v!==0))fail('tag-unsupported');body+=4;}
    await mp4(body,b.end,next,depth+1);
   }else if((path==='/moov/meta/ilst'||path==='/moov/udta/meta/ilst')&&b.type==='©lyr'){
    for(let q=b.body;q<b.end;){const d=await box(q,b.end);await attempt(async()=>{
     if(d.type!=='data')fail('tag-unsupported');if(d.end-d.body<8)fail('tag-invalid');const h=await read(d.body,8),type=u32(h,0);
     if(type!==1&&type!==2)fail('encoding-unsupported');
     const text=decoder(await read(d.body+8,d.end-d.body-8,true),type===1?3:2);
     // Textual LRC is timed only when actual timestamp-looking marks are present.
     const format=/^\[\d/m.test(text)?'lrc':'plain';
     collect(text,format,{kind:'embedded-mp4',tag:'©lyr',language:null,descriptor:''});
    });q=d.end;}
   }
   p=b.end;
  }
 };
 try{
  if(mime==='audio/mpeg'){
   for(let p=0;p<file.size;){const h=await read(p,Math.min(10,file.size-p));if(ascii(h,0,3)!=='ID3')break;if(++entries>128)fail('walk-limit');p=await id3(p,file.size,'embedded-id3');}
  }else if(mime==='audio/wav')await riff();
  else if(mime==='audio/mp4'){const first=await box(0,file.size);if(first.type!=='ftyp'||first.end-first.body<8)fail('tag-invalid');await mp4(0,file.size);}
  else fail('format-not-inspected');
 }catch(e){issues.push(e instanceof InspectionError?e.code:'tag-invalid');}
 if(candidates.length){
  // Stable document order breaks ties, retaining the selected language/descriptor/source.
  const winner=candidates.find(c=>c.format==='lrc'||c.format==='sylt')??candidates[0];return {...winner,warnings:[...new Set(issues)]};
 }
 if(!issues.length)return {state:'absent',scope:mime==='audio/mpeg'?'leading-id3v2':mime==='audio/wav'?'riff-id3':'moov-ilst'};
 const failureCode=issues[0];return {state:['payload-size','walk-limit','lyrics-limit'].includes(failureCode)?'omitted':['tag-unsupported','encoding-unsupported','sylt-frames','format-not-inspected'].includes(failureCode)?'not-inspected':'invalid',failureCode};
}
