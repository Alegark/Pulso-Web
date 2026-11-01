import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const root=resolve(import.meta.dirname,'../../..');
export const output=resolve(root,'.local/queue-insertion-main-r110');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function digest(path){const b=await readFile(path);return {bytes:b.length,sha256:sha(b)};}
export async function tree(dir,prefix=''){const out={};for(const e of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=resolve(dir,e.name),key=prefix+e.name;if(e.isDirectory())Object.assign(out,await tree(p,key+'/'));else out[key]=await digest(p);}return out;}
export async function json(path,value){await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');}
export async function memory(label,dir=output){
 const raw=execFileSync('python3',['scripts/sync_odd_memory.py','--read-only'],{cwd:root,encoding:'utf8'});await mkdir(dir,{recursive:true});await writeFile(resolve(dir,`engram-${label}.json`),raw);
 const r=JSON.parse(raw);assert.equal(r.FullContentVerified,true);assert.equal(r.tasks.length,14);const checked=[];
 for(const task of r.tasks){const b=await readFile(resolve(root,task.file));assert.equal(task.project,'Pulso-Web');assert.equal(task.FullContentVerified,true);assert.equal(task.bytes,b.length,task.file);assert.equal(task.ContentSHA256,sha(b),task.file);checked.push({...task});}
 return {...r,tasks:checked};
}
export async function freeze(){
 const f=JSON.parse(await readFile(resolve(root,'.local/queue-insertion-root/freeze.json'),'utf8'));assert.equal(f.frozen,true,'Explicit root frozen:true required');
 assert.ok(f.sources&&Object.keys(f.sources).length>=9,'Freeze must list source hashes');
 for(const required of ['src/main.tsx','src/playback/queue-insertion-controller.ts','src/playback/player.ts','src/playback/local-copy-protection.ts','src/playback/transport.ts'])assert.ok(f.sources[required],required);
 for(const [p,hash]of Object.entries(f.sources))assert.deepEqual(await digest(resolve(root,p)),hash,p);
 return f;
}
export function stableDB(raw){
 // Every store/key/field retained. Only legitimate playback position is aligned.
 const copy=structuredClone(raw);for(const row of copy.stores.settings??[])if(row.key==='library-playback'&&row.value&&typeof row.value.position==='number')row.value.position=0;return copy;
}
export async function until(fn,label,ms=12000){const end=Date.now()+ms;do{const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,35));}while(Date.now()<end);throw Error('R110 timeout: '+label);}
