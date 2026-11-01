import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha} from './evidence.mjs';
export function wav(index=0,{bytes=640044,rate=8000}={}){
 if(bytes<44||(bytes-44)%2)throw Error('PCM fixture needs even payload');const b=Buffer.alloc(bytes),frames=(bytes-44)/2;
 b.write('RIFF');b.writeUInt32LE(bytes-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(bytes-44,40);
 for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(Math.sin(i*(.09+index*.009))*2200),44+i*2);return b;
}
export async function fixtures(dir){
 await mkdir(dir,{recursive:true});const result=[];
 for(let i=0;i<4;i++){const name=`R110-${String.fromCharCode(65+i)}.wav`,buffer=wav(i);await writeFile(resolve(dir,name),buffer);result.push({name,mimeType:'audio/wav',buffer});}
 // The installed, pinned offline encoder creates an original MP3; no downloaded media.
 const encoder=resolve('node_modules/@ffmpeg-installer/linux-x64/ffmpeg');
 execFileSync(encoder,['-v','error','-y','-i',resolve(dir,result[1].name),'-codec:a','libmp3lame','-b:a','48k','-metadata','title=R110 MP3 propio','-metadata','artist=R110 sintético','-metadata','album=R110 local',resolve(dir,'R110-own.mp3')]);
 const mp3=await readFile(resolve(dir,'R110-own.mp3'));result.push({name:'R110-own.mp3',mimeType:'audio/mpeg',buffer:mp3});
 await writeFile(resolve(dir,'manifest.json'),JSON.stringify(result.map(f=>({name:f.name,bytes:f.buffer.length,sha256:sha(f.buffer),provenance:'Original mathematical PCM; original MP3 encoded locally from it'})),null,2));return result;
}
export function withCanvasArtwork(mp3,png){
 if(mp3.subarray(0,3).toString()!=='ID3'||mp3[3]!==4)throw Error('Pinned MP3 fixture must have ID3v2.4');
 const readSync=b=>b.reduce((v,n)=>(v<<7)|n,0),sync=n=>Buffer.from([(n>>>21)&127,(n>>>14)&127,(n>>>7)&127,n&127]);
 const oldSize=readSync(mp3.subarray(6,10)),payload=Buffer.concat([Buffer.from([0]),Buffer.from('image/png\0'),Buffer.from([3,0]),png]);
 const frame=Buffer.concat([Buffer.from('APIC'),sync(payload.length),Buffer.from([0,0]),payload]),header=Buffer.from(mp3.subarray(0,10));sync(oldSize+frame.length).copy(header,6);
 return Buffer.concat([header,frame,mp3.subarray(10)]);
}
