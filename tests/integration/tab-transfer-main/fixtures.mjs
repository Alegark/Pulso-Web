import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,json} from './evidence.mjs';
export function wav(n){const rate=8000,frames=rate*45,b=Buffer.alloc(44+frames*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*(220+n*51)/rate)*1800),44+i*2);return b;}
export async function fixtures(dir){await mkdir(dir,{recursive:true});const out=[];for(let i=0;i<2;i++){const name=`R136-${'AB'[i]}.wav`,b=wav(i);await writeFile(resolve(dir,name),b);out.push({name,bytes:b.length,sha256:sha(b),provenance:'Own mathematical PCM; no external or user audio'});}await json(resolve(dir,'manifest.json'),out);return out;}
// Separate harness entry BEFORE main opens. The real importer creates/verifies
// manifests, chunks and native IDB data. No fabricated Track/Asset/job/snapshot.
export const fixtureEntry=`import {importFileDetailed} from './src/imports/import-file';
import {all} from './src/library/library';
window.fixtureDone=(async()=>{const manifest=await (await fetch('/fixtures/manifest.json')).json(),results=[];
for(const item of manifest){const b=await (await fetch('/fixtures/'+item.name)).arrayBuffer();const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');if(b.byteLength!==item.bytes||digest!==item.sha256)throw Error('fixture SHA mismatch');const r=await importFileDetailed(new File([b],item.name,{type:'audio/wav'}),new AbortController().signal,()=>{},{backend:'idb'});if(r.kind!=='confirmed')throw Error('real import failed '+JSON.stringify(r));results.push(r);}
const assets=await all('assets');for(const item of manifest){if(!assets.some(a=>a.sha256===item.sha256&&a.bytes===item.bytes&&a.state==='complete'))throw Error('real manifest missing');}return {manifest,results,assets};})();`;
export const legacyEntry=`import {Ownership} from './src/playback/ownership';
const audio=new Audio();const o=new Ownership(()=>{document.querySelector('#state').textContent=o.state;},async()=>{});
document.querySelector('#release').onclick=()=>o.cede(async()=>{audio.pause();audio.removeAttribute('src');audio.load();},()=>false);
void o.acquire();`;
