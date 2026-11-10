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
 await assert.rejects(assembleBotDownloadBytes({bytes:BOT_DOWNLOAD_MAX_BYTES,mime:'audio/wav'},read,()=>false),code('cancelled'));assert.equal(calls,0);
});
test('assembles a synthetic WAV larger than 8 MiB with exact bytes and hash',async()=>{
 const data=new Uint8Array(8*1024*1024+137);const view=new DataView(data.buffer);
 data.set(new TextEncoder().encode('RIFF'),0);view.setUint32(4,data.length-8,true);data.set(new TextEncoder().encode('WAVEfmt '),8);
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 data.set(new TextEncoder().encode('data'),36);view.setUint32(40,data.length-44,true);data[data.length-1]=42;
 const result=await assembleBotDownloadBytes({bytes:data.length,mime:'audio/wav'},async(o,n)=>data.slice(o,o+n),()=>true);
 assert.equal(result.bytes,data.length);assert.equal(result.sha256,createHash('sha256').update(data).digest('hex'));assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),data);
});
test('rejects short data, mismatched header and cancellation after settlement',async()=>{
 await assert.rejects(assembleBotDownloadBytes({bytes:12,mime:'audio/wav'},async()=>new Uint8Array(2),()=>true),code('short'));
 await assert.rejects(assembleBotDownloadBytes({bytes:12,mime:'audio/wav'},async()=>new Uint8Array(12),()=>true),code('header'));
 let current=true;await assert.rejects(assembleBotDownloadBytes({bytes:12,mime:'audio/mpeg'},async()=>{current=false;return new Uint8Array(12);},()=>current),code('cancelled'));
});

test('uses a supported byte signature rather than a mismatched Telegram MIME declaration',async()=>{
 for(const [declared,actual,signature,at] of [['audio/mpeg','audio/mp4','ftyp',4],['audio/mp4','audio/mpeg','ID3',0],['audio/mpeg','audio/wav','RIFF',0]] as const){
  const data=new Uint8Array(BOT_DOWNLOAD_CHUNK_BYTES+12);data.set(new TextEncoder().encode(signature),at);if(actual==='audio/wav')data.set(new TextEncoder().encode('WAVE'),8);
  const result=await assembleBotDownloadBytes({bytes:data.length,mime:declared},async(o,n)=>data.slice(o,o+n),()=>true);
  assert.equal(result.mime,actual);assert.equal(result.blob.type,actual);assert.equal(result.sha256,createHash('sha256').update(data).digest('hex'));assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),data);
 }
});
test('rejects an unsupported first signature before requesting any later file parts',async()=>{
 const data=new Uint8Array(BOT_DOWNLOAD_CHUNK_BYTES+12);data.set(new TextEncoder().encode('fLaC'));let calls=0;
 await assert.rejects(assembleBotDownloadBytes({bytes:data.length,mime:'audio/mpeg'},async(o,n)=>{calls++;return data.slice(o,o+n);},()=>true),code('header'));assert.equal(calls,1);
});
