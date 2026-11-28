import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import {sha256} from '@noble/hashes/sha2.js';

/** Worker-only byte assembler. The caller owns authorization, DC selection, RPC
 * settlement, and revalidation; this helper does not make a download safe alone. */
export const BOT_DOWNLOAD_MAX_BYTES=AUDIO_FILE_MAX_BYTES;
// Whole aligned blocks, including the final request, never cross a 1 MiB window.
export const BOT_DOWNLOAD_CHUNK_BYTES=512*1024;
export const botDownloadTransferMs=(bytes:number)=>15000+3000*Math.ceil(bytes/BOT_DOWNLOAD_CHUNK_BYTES);
export type BotDownloadMime='audio/mpeg'|'audio/mp4'|'audio/wav';
export const isBotDownloadMime=(mime:unknown):mime is BotDownloadMime=>mime==='audio/mpeg'||mime==='audio/mp4'||mime==='audio/wav';
export type BotDownloadBytesError='size'|'mime'|'short'|'header'|'cancelled';
export class BotDownloadBytesFailure extends Error {
 constructor(readonly code:BotDownloadBytesError){super(code);}
}
export interface BotDownloadBytesResult {readonly blob:Blob;readonly bytes:number;readonly mime:BotDownloadMime;readonly sha256:string}

function headerMime(bytes:Uint8Array):BotDownloadMime|null {
 const ascii=(start:number,s:string)=>Array.from(s).every((c,i)=>bytes[start+i]===c.charCodeAt(0));
 if(ascii(0,'ID3')||bytes.length>=2&&bytes[0]===255&&(bytes[1]&0xe0)===0xe0)return 'audio/mpeg';
 if(ascii(4,'ftyp'))return 'audio/mp4';
 if(ascii(0,'RIFF')&&ascii(8,'WAVE'))return 'audio/wav';
 return null;
}
/** Four aligned requests bound pending and reordered bytes to 2 MiB. Rejects the declared size before invoking readChunk.
 * A local cancellation does not abort or retire an outstanding SDK RPC: the caller
 * must retain its lane until the original promise settles or quarantine the session. */
export async function assembleBotDownloadBytes(descriptor:{readonly bytes:number;readonly mime:string},readChunk:(offset:number,limit:number)=>Promise<Uint8Array>,current:()=>boolean,progress?:(bytes:number)=>void,onFailure?:(error:unknown)=>void):Promise<BotDownloadBytesResult> {
 const {bytes,mime}=descriptor;
 if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>BOT_DOWNLOAD_MAX_BYTES)throw new BotDownloadBytesFailure('size');
 if(!isBotDownloadMime(mime))throw new BotDownloadBytesFailure('mime');
 const parts:Blob[]=[],hash=sha256.create();
 const pending=new Map<number,Promise<Uint8Array>>();
 let next=0,detectedMime:BotDownloadMime|null=null,failed=false;
 let rejectFailure!:(error:unknown)=>void;
 const failure=new Promise<never>((_,reject)=>{rejectFailure=reject;});
 // A later part can fail while the first part is still in flight.
 const launch=(offset:number)=>{
  const part=Promise.resolve().then(async()=>{
   if(failed||!current())throw new BotDownloadBytesFailure('cancelled');
   const chunk=await readChunk(offset,BOT_DOWNLOAD_CHUNK_BYTES);
   if(!current())throw new BotDownloadBytesFailure('cancelled');
   if(!(chunk instanceof Uint8Array)||chunk.byteLength!==Math.min(BOT_DOWNLOAD_CHUNK_BYTES,bytes-offset))throw new BotDownloadBytesFailure('short');
   if(offset===0){detectedMime=headerMime(chunk);if(!detectedMime)throw new BotDownloadBytesFailure('header');}
   return chunk;
  });
  pending.set(offset,part);
  void part.catch(error=>{if(!failed){failed=true;rejectFailure(error);}});
 };
 try{
  for(let offset=0;offset<bytes;offset+=BOT_DOWNLOAD_CHUNK_BYTES){
   if(!current())throw new BotDownloadBytesFailure('cancelled');
   while(!failed&&pending.size<4&&next<bytes){launch(next);next+=BOT_DOWNLOAD_CHUNK_BYTES;}
   const chunk=await Promise.race([pending.get(offset)!,failure]);
   if(failed)await failure;
   if(!current())throw new BotDownloadBytesFailure('cancelled');
   // Snapshot once; only this fixed window retains SDK buffers.
   parts.push(new Blob([chunk.buffer instanceof ArrayBuffer?chunk as Uint8Array<ArrayBuffer>:new Uint8Array(chunk)]));
   hash.update(chunk);pending.delete(offset);progress?.(offset+chunk.byteLength);
  }
 }catch(error){
  try{onFailure?.(error);}finally{await Promise.allSettled(pending.values());}
  throw error;
 }
 if(!detectedMime)throw new BotDownloadBytesFailure('header');
 return Object.freeze({blob:new Blob(parts,{type:detectedMime}),bytes,mime:detectedMime,sha256:Array.from(hash.digest(),x=>x.toString(16).padStart(2,'0')).join('')});
}
