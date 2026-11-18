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
/** Sequential bounded reads. Rejects the declared size before invoking readChunk.
 * A local cancellation does not abort or retire an outstanding SDK RPC: the caller
 * must retain its lane until the original promise settles or quarantine the session. */
export async function assembleBotDownloadBytes(descriptor:{readonly bytes:number;readonly mime:string},readChunk:(offset:number,limit:number)=>Promise<Uint8Array>,current:()=>boolean):Promise<BotDownloadBytesResult> {
 const {bytes,mime}=descriptor;
 if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>BOT_DOWNLOAD_MAX_BYTES)throw new BotDownloadBytesFailure('size');
 if(!isBotDownloadMime(mime))throw new BotDownloadBytesFailure('mime');
 const parts:Blob[]=[],hash=sha256.create();
 let offset=0,detectedMime:BotDownloadMime|null=null;
 while(offset<bytes){
  if(!current())throw new BotDownloadBytesFailure('cancelled');
  const expected=Math.min(BOT_DOWNLOAD_CHUNK_BYTES,bytes-offset),chunk=await readChunk(offset,BOT_DOWNLOAD_CHUNK_BYTES);
  if(!current())throw new BotDownloadBytesFailure('cancelled');
  if(!(chunk instanceof Uint8Array)||chunk.byteLength!==expected)throw new BotDownloadBytesFailure('short');
  if(offset===0){detectedMime=headerMime(chunk);if(!detectedMime)throw new BotDownloadBytesFailure('header');}
  // Snapshot each part once in its Blob so SDK buffers can be released as we go.
  parts.push(new Blob([chunk.buffer instanceof ArrayBuffer?chunk as Uint8Array<ArrayBuffer>:new Uint8Array(chunk)]));
  hash.update(chunk);offset+=chunk.byteLength;
 }
 if(!detectedMime)throw new BotDownloadBytesFailure('header');
 return Object.freeze({blob:new Blob(parts,{type:detectedMime}),bytes,mime:detectedMime,sha256:Array.from(hash.digest(),x=>x.toString(16).padStart(2,'0')).join('')});
}
