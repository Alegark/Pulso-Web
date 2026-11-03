import {sha256} from '@noble/hashes/sha2.js';

/** Worker-only byte assembler. The caller owns authorization, DC selection, RPC
 * settlement, and revalidation; this helper does not make a download safe alone. */
export const BOT_DOWNLOAD_MAX_BYTES=8*1024*1024;
export const BOT_DOWNLOAD_CHUNK_BYTES=64*1024;
export type BotDownloadMime='audio/mpeg'|'audio/mp4'|'audio/wav';
export type BotDownloadBytesError='size'|'mime'|'short'|'header'|'cancelled';
export class BotDownloadBytesFailure extends Error {
 constructor(readonly code:BotDownloadBytesError){super(code);}
}
export interface BotDownloadBytesResult {readonly blob:Blob;readonly bytes:number;readonly mime:BotDownloadMime;readonly sha256:string}

function headerMatches(bytes:Uint8Array,mime:BotDownloadMime):boolean {
 const ascii=(start:number,s:string)=>Array.from(s).every((c,i)=>bytes[start+i]===c.charCodeAt(0));
 if(mime==='audio/mpeg')return ascii(0,'ID3')||bytes.length>=2&&bytes[0]===255&&(bytes[1]&0xe0)===0xe0;
 if(mime==='audio/mp4')return ascii(4,'ftyp');
 return ascii(0,'RIFF')&&ascii(8,'WAVE');
}
/** Sequential bounded reads. Rejects the declared size before invoking readChunk.
 * A local cancellation does not abort or retire an outstanding SDK RPC: the caller
 * must retain its lane until the original promise settles or quarantine the session. */
export async function assembleBotDownloadBytes(descriptor:{readonly bytes:number;readonly mime:string},readChunk:(offset:number,limit:number)=>Promise<Uint8Array>,current:()=>boolean):Promise<BotDownloadBytesResult> {
 const {bytes,mime}=descriptor;
 if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>BOT_DOWNLOAD_MAX_BYTES)throw new BotDownloadBytesFailure('size');
 if(mime!=='audio/mpeg'&&mime!=='audio/mp4'&&mime!=='audio/wav')throw new BotDownloadBytesFailure('mime');
 const parts:Uint8Array<ArrayBuffer>[]=[],hash=sha256.create();
 let offset=0;
 while(offset<bytes){
  if(!current())throw new BotDownloadBytesFailure('cancelled');
  const expected=Math.min(BOT_DOWNLOAD_CHUNK_BYTES,bytes-offset),chunk=await readChunk(offset,BOT_DOWNLOAD_CHUNK_BYTES);
  if(!current())throw new BotDownloadBytesFailure('cancelled');
  if(!(chunk instanceof Uint8Array)||chunk.byteLength!==expected)throw new BotDownloadBytesFailure('short');
  const copy=new Uint8Array(chunk);parts.push(copy);hash.update(copy);offset+=copy.byteLength;
 }
 if(!headerMatches(parts[0],mime))throw new BotDownloadBytesFailure('header');
 return Object.freeze({blob:new Blob(parts,{type:mime}),bytes,mime,sha256:Array.from(hash.digest(),x=>x.toString(16).padStart(2,'0')).join('')});
}
