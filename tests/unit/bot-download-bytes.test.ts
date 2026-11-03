import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assembleBotDownloadBytes,BOT_DOWNLOAD_CHUNK_BYTES,BOT_DOWNLOAD_MAX_BYTES,BotDownloadBytesFailure} from '../../src/telegram/bot-download-bytes';

const code=(expected:string)=>(error:unknown)=>error instanceof BotDownloadBytesFailure&&error.code===expected;
test('assembles sequential chunks with exact length and incremental hash',async()=>{
 const data=new Uint8Array(BOT_DOWNLOAD_CHUNK_BYTES+12);data.set([73,68,51]);data[data.length-1]=42;const offsets:number[]=[];
 const result=await assembleBotDownloadBytes({bytes:data.length,mime:'audio/mpeg'},async(o,n)=>{offsets.push(o);assert.equal(n,BOT_DOWNLOAD_CHUNK_BYTES);return data.slice(o,o+n);},()=>true);
 assert.deepEqual(offsets,[0,BOT_DOWNLOAD_CHUNK_BYTES]);assert.equal(result.sha256,createHash('sha256').update(data).digest('hex'));assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),data);
});
test('rejects oversized and unsupported descriptors before reading',async()=>{
 let calls=0;const read=async()=>{calls++;return new Uint8Array();};
 await assert.rejects(assembleBotDownloadBytes({bytes:BOT_DOWNLOAD_MAX_BYTES+1,mime:'audio/mpeg'},read,()=>true),code('size'));
 await assert.rejects(assembleBotDownloadBytes({bytes:10,mime:'audio/ogg'},read,()=>true),code('mime'));assert.equal(calls,0);
});
test('rejects short data, mismatched header and cancellation after settlement',async()=>{
 await assert.rejects(assembleBotDownloadBytes({bytes:12,mime:'audio/wav'},async()=>new Uint8Array(2),()=>true),code('short'));
 await assert.rejects(assembleBotDownloadBytes({bytes:12,mime:'audio/wav'},async()=>new Uint8Array(12),()=>true),code('header'));
 let current=true;await assert.rejects(assembleBotDownloadBytes({bytes:12,mime:'audio/mpeg'},async()=>{current=false;return new Uint8Array(12);},()=>current),code('cancelled'));
});
