import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const root=resolve(import.meta.dirname,'../../..');
export const output=resolve(root,'.local/tab-transfer-main-r136/evidencepropio');
export const sha=b=>createHash('sha256').update(b).digest('hex');
export async function digest(p){const b=await readFile(p);return {bytes:b.length,sha256:sha(b)};}
export async function tree(dir,prefix=''){const out={};for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=resolve(dir,e.name);if(e.isDirectory())Object.assign(out,await tree(p,prefix+e.name+'/'));else out[prefix+e.name]=await digest(p);}return out;}
export async function sources(){return {...await tree(resolve(root,'src'),'src/'),...await tree(resolve(root,'public'),'public/')};}
export async function json(p,v){await mkdir(resolve(p,'..'),{recursive:true});await writeFile(p,JSON.stringify(v,null,2)+'\n');}
export async function memory(dir){const raw=execFileSync('python3',['scripts/sync_odd_memory.py','--read-only'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});await writeFile(resolve(dir,'engram-read-only.json'),raw);const r=JSON.parse(raw);assert.equal(r.FullContentVerified,true);assert.equal(r.tasks.length,14);for(const t of r.tasks){assert.equal(t.project,'Pulso-Web');assert.equal(t.FullContentVerified,true);assert.deepEqual(await digest(resolve(root,t.file)),{bytes:t.bytes,sha256:t.ContentSHA256},t.file);}return r;}
export async function freeze(path){assert.ok(path,'--freeze=<path> required');const f=JSON.parse(await readFile(resolve(root,path),'utf8'));assert.equal(f.frozen,true);assert.deepEqual(f.sources,await sources(),'Freeze must contain COMPLETE current src/public map (no omitted or extra files)');return f;}
export async function until(fn,label,ms=12000){const end=Date.now()+ms;do{const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,30));}while(Date.now()<end);throw Error('R136 timeout: '+label);}
