import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const mp3=readFileSync(new URL('../../public/fixtures/A.mp3',import.meta.url));
const m4a=readFileSync(new URL('../../public/fixtures/B.m4a',import.meta.url));
const syncSafe=size=>Buffer.from([size>>21&127,size>>14&127,size>>7&127,size&127]);
const textFrame=(name,value)=>{
 const text=Buffer.concat([Buffer.of(3),Buffer.from(value)]);
 return Buffer.concat([Buffer.from(name),syncSafe(text.length),Buffer.alloc(2),text]);
};
export function taggedMp3(title,artist){
 const payload=Buffer.concat([textFrame('TIT2',title),textFrame('TPE1',artist)]);
 const previous=mp3.subarray(6,10).reduce((size,byte)=>size*128+byte,0);
 return Buffer.concat([Buffer.from('ID3\x04\x00\x00'),syncSafe(payload.length),payload,mp3.subarray(10+previous)]);
}
function atom(name,...payload){
 const header=Buffer.alloc(8);
 header.writeUInt32BE(8+payload.reduce((size,part)=>size+part.length,0));
 header.write(name,4,4,'latin1');
 return Buffer.concat([header,...payload]);
}
export function taggedM4a(title,artist){
 // The checked-in fixture has moov and all four enclosing tag boxes at EOF.
 // Their lengths change together without moving the earlier media offsets.
 const item=(name,value)=>atom(name,atom('data',Buffer.of(0,0,0,1,0,0,0,0),Buffer.from(value)));
 const added=Buffer.concat([item('©nam',title),item('©ART',artist)]);
 const result=Buffer.concat([m4a,added]);
 for(const name of ['moov','udta','meta','ilst']){
  const at=m4a.indexOf(name)-4;
  assert.ok(at>=0&&at+m4a.readUInt32BE(at)===m4a.length,name);
  result.writeUInt32BE(m4a.readUInt32BE(at)+added.length,at);
 }
 return result;
}
