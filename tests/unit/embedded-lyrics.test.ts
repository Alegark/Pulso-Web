import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSyltEvents,lyricsDraft,LyricsError} from '../../src/library/lyrics-parser';
import {inspectEmbeddedLyrics} from '../../src/imports/lyrics';
const utf=(s:string)=>new TextEncoder().encode(s);
const join=(...parts:Uint8Array[])=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let p=0;for(const a of parts){b.set(a,p);p+=a.length;}return b;};
const sync=(n:number)=>new Uint8Array([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);
const n32=(n:number)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
const frame=(id:string,b:Uint8Array)=>join(utf(id),sync(b.length),new Uint8Array(2),b);
const tag=(b:Uint8Array)=>new Blob([utf('ID3'),new Uint8Array([4,0,0]),sync(b.length),b]);
const inspect=(b:Blob)=>inspectEmbeddedLyrics(b,'audio/mpeg');
test('empty UTF16 descriptor, explicit BOM text and surrogate validation',async()=>{
 const prefix=join(new Uint8Array([1]),utf('spa'),new Uint8Array(2));
 const r=await inspect(tag(frame('USLT',join(prefix,new Uint8Array([255,254,65,0])))));
 assert.equal(r.state,'ready');if(r.state==='ready')assert.equal(r.text,'A');
 const b=await inspect(tag(frame('USLT',join(prefix,new Uint8Array([255,254,0,216])))));
 assert.equal(b.state,'invalid');
});
test('SYLT exact 24h accepted; larger timestamp rejected; truncated cue rejected',async()=>{
 const prefix=join(new Uint8Array([3]),utf('spa'),new Uint8Array([2,1,0]),utf('Original'),new Uint8Array(1));
 const r=await inspect(tag(frame('SYLT',join(prefix,n32(86400000)))));assert.equal(r.state,'ready');if(r.state==='ready')assert.deepEqual(r.cues,[{timeMs:86400000,text:'Original'}]);
 assert.equal((await inspect(tag(frame('SYLT',join(prefix,n32(86400001)))))).state,'invalid');
 assert.equal((await inspect(tag(frame('SYLT',join(prefix,new Uint8Array(3)))))).state,'invalid');
});
test('ID3v2.2, unsynchronisation/footer/extended flags never pretend absence',async()=>{
 for(const [version,flags] of [[2,0],[4,128],[4,16],[3,64]]){
  const r=await inspect(new Blob([utf('ID3'),new Uint8Array([version,0,flags]),sync(0)]));
  assert.equal(r.state,'not-inspected');
 }
});
test('oversized payload does not read body, while later valid candidate remains usable',async()=>{
 const giant=frame('USLT',new Uint8Array(131073)),valid=frame('USLT',join(new Uint8Array([3]),utf('spa\0Original')));
 const b=tag(join(giant,valid)),slice=b.slice.bind(b);let bodyReads=0;
 b.slice=(start,end,type)=>{if((end??b.size)-(start??0)>10)bodyReads++;return slice(start,end,type);};
 const r=await inspect(b);assert.equal(r.state,'ready');if(r.state==='ready')assert.deepEqual(r.warnings,['payload-size']);assert.equal(bodyReads,1);
});
test('absence reports narrow inspected scope; unknown format remains uninspected',async()=>{
 assert.deepEqual(await inspect(tag(frame('TIT2',utf('Original')))),{state:'absent',scope:'leading-id3v2'});
 assert.deepEqual(await inspectEmbeddedLyrics(new Blob(),'audio/ogg'),{state:'not-inspected',failureCode:'format-not-inspected'});
});

const events=(cues:{timeMs:number;text:string}[])=>tag(frame('SYLT',join(new Uint8Array([3]),utf('spa'),new Uint8Array([2,1,0]),...cues.map(c=>join(utf(c.text),new Uint8Array(1),n32(c.timeMs))))));
test('SYLT literal timestamps/years, duplicates and Unicode are never LRC syntax',async()=>{
 const cues=[{timeMs:1000,text:'[00:09]Texto literal'},{timeMs:1000,text:'[2026]Texto literal'},{timeMs:2001,text:'e\u0301 😀 [00:03]'}];
 for(const cue of cues.slice(0,2)){const single=await inspect(events([cue]));assert.equal(single.state,'ready');if(single.state==='ready')assert.deepEqual(single.cues,[cue]);}
 const result=await inspect(events(cues));assert.equal(result.state,'ready');if(result.state!=='ready')return;
 assert.equal(result.format,'sylt');assert.deepEqual(result.cues,cues);
 const parsed=parseSyltEvents(result.cues);assert.deepEqual(parsed.cues,cues);
 const draft=lyricsDraft(parsed);assert.equal(draft.format,'plain');assert.equal(draft.text,cues.map(c=>c.text).join('\n'));assert.match(draft.warning!,/retira la sincronización/);
});
test('structured validation rejects shape, size, invalid times/order without repair or sorting',()=>{
 for(const cues of [[],new Array(2),Object.assign([{timeMs:0,text:'x'}],{extra:true}),[{timeMs:-1,text:'x'}],[{timeMs:0.5,text:'x'}],[{timeMs:86400001,text:'x'}],[{timeMs:2,text:'x'},{timeMs:1,text:'x'}],[{timeMs:0,text:'x',extra:true}],[{timeMs:0,text:'\ud800'}],[{timeMs:0,text:'a'.repeat(8193)}],Array.from({length:4001},()=>({timeMs:1,text:'x'}))])assert.throws(()=>parseSyltEvents(cues),LyricsError);
 assert.throws(()=>parseSyltEvents(Array.from({length:20},()=>({timeMs:1,text:'a'.repeat(8192)}))),LyricsError);
});
test('4000 SYLT events at limit keep exact text/times/count',async()=>{
 const cues=Array.from({length:4000},(_,i)=>({timeMs:i,text:'[2026]ñ'}));const result=await inspect(events(cues));assert.equal(result.state,'ready');if(result.state==='ready')assert.deepEqual(result.cues,cues);
});
