import {cp,mkdir,readFile,rm,symlink,writeFile,readdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),base=resolve(root,'.local/cloudflare-setup'),snapshot=base+'/build-root',site=base+'/site';
// Keep immutable URLs available to tabs still running the previous release.
// Only verified build assets and versioned HTML are eligible for retention.
const retained=[];
let previous=null;
try{
 previous=JSON.parse(await readFile(base+'/site-manifest.json','utf8'));
}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous){
 for(const file of previous.files){
  if(!/^(?:assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]+\.(?:js|css|wasm)|releases\/[a-f0-9]{16}\.html)$/.test(file.path))continue;
  const body=await readFile(site+'/'+file.path);
  if(body.length!==file.bytes||createHash('sha256').update(body).digest('hex')!==file.sha256)throw Error('Previous immutable asset changed');
  retained.push({path:file.path,body});
 }
}
await mkdir(base,{recursive:true});await rm(snapshot,{recursive:true,force:true});await mkdir(snapshot,{recursive:true});
for(const name of ['package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html','pilot.html','samples.html','src','public','scripts','tests','vendor','deployment','wrangler.jsonc'])await cp(resolve(root,name),resolve(snapshot,name),{recursive:true});
await symlink(resolve(root,'node_modules'),snapshot+'/node_modules','dir');
execFileSync('npm',['run','build'],{cwd:snapshot,stdio:'inherit'});
await rm(site,{recursive:true,force:true});await cp(snapshot+'/dist',site,{recursive:true});
for(const file of retained){
 const destination=site+'/'+file.path;await mkdir(resolve(destination,'..'),{recursive:true});
 try{if(!(await readFile(destination)).equals(file.body))throw Error('Immutable asset collision');}
 catch(error){if(error.code!=='ENOENT')throw error;await writeFile(destination,file.body);}
}
const policy="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
await writeFile(site+'/_headers',`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: ${policy}\n  Cache-Control: no-cache\n`);
await writeFile(site+'/.assetsignore','telegram-config.json\n.env*\n*.map\n.assetsignore\n');
const files=[];async function walk(dir,prefix=''){for(const item of await readdir(dir,{withFileTypes:true})){const relative=prefix+item.name,path=dir+'/'+item.name;if(item.isSymbolicLink())throw Error('Symbolic asset rejected');if(item.isDirectory())await walk(path,relative+'/');else{const meta=await stat(path);if(meta.size>25*1024*1024)throw Error('Asset exceeds Cloudflare limit');if(/telegram-config[.]json|(^|\/)\.env/.test(relative))throw Error('Private configuration in assets');const bytes=await readFile(path);files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
await walk(site);if(files.length>20000)throw Error('Too many Cloudflare assets');
await writeFile(base+'/site-manifest.json',JSON.stringify({builtAt:new Date().toISOString(),files},null,2)+'\n');console.log(`Cloudflare candidate prepared: ${files.length} files; root dist unchanged.`);
