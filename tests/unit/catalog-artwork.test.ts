import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {searchArtwork,songArtwork,catalogArtwork} from '../../src/library/catalog-artwork';
const row={wrapperType:'track',kind:'song',trackName:'Song',artistName:'Artist',collectionName:'Album',collectionId:7,trackTimeMillis:100000,artworkUrl100:'https://is1-ssl.mzstatic.com/a.jpg'};
const q={title:'Song',artist:'Artist',album:'Album',durationSeconds:100};
test('one search result batch serves multiple strict matches without guessing editions',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({resultCount:1,results:[row]});};
 try{const data=await searchArtwork('Song Artist',new AbortController().signal);assert.equal(songArtwork(data,q),row.artworkUrl100);assert.equal(songArtwork(data,{...q,title:'Other'}),null);assert.equal(songArtwork({resultCount:50,results:Array(50).fill(row)},q),row.artworkUrl100);assert.equal(songArtwork({resultCount:200,results:Array(200).fill(row)},q),null);assert.equal(songArtwork({resultCount:2,results:[row,{...row,collectionId:8}]},q),null);assert.equal(calls,1);assert.equal(await searchArtwork('Song Artist',new AbortController().signal),data);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('invalid or cancelled requests do not contact image or catalog hosts',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
 try{const abort=new AbortController();abort.abort();assert.equal(await searchArtwork('another search',abort.signal),null);assert.equal(await catalogArtwork('https://evil.example/image.jpg'),null);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
