/** Accompany every distributed SDK WASM with its source, original notices and replacement recipe. */
import {readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=data=>createHash('sha256').update(data).digest('hex');
const root=resolve(import.meta.dirname,'..');
const names=['@mtcute/web','@mtcute/core','@mtcute/wasm','@mtcute/file-id','@mtcute/tl-runtime','@fuman/io','@fuman/net','@fuman/utils','long'];
const phoneCountryFiles=[
 {file:'LICENSE',bytes:10173,sha256:'a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9'},
 {file:'UPSTREAM-HEADER.txt',bytes:2210,sha256:'24ac808638093a5d0977685025649d17bcad4a39bc93ea0efab54a78561403d2'},
 {file:'SOURCE.json',bytes:716,sha256:'ead1d484313f6581024c6c48cf906f3cd7ab70a7f15862b872e34128796297ba'},
];
const sourcePaths=['package.json','package-lock.json','vite.config.ts','tsconfig.json','wrangler.jsonc','index.html','pilot.html','samples.html','src','public','scripts','tests','deployment','vendor/telegram-wasm','vendor/phone-countries','vendor/qr-code'];
// Inventory and Git tree from the published npm tarballs verified against package-lock.json.
const sdkInventory='bfbc8214a566dbd7d0e65b2dbd42e55f2e4b034f023f30eed600923ce11a133b';
const sdkTree='a9a2c53f2e96438b0993300a3845861313c787ac';
const gitEnvironment={...process.env};
// A build invoked by a Git hook may inherit paths to the caller's Git storage.
for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_NAMESPACE'])delete gitEnvironment[key];
const git=(args,options={})=>execFileSync('git',args,{env:gitEnvironment,stdio:'pipe',maxBuffer:8*1024*1024,...options});

function writeSourceArchive(out){
 const project=git(['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trimEnd();
 const head=git(['rev-parse','HEAD'],{cwd:project,encoding:'utf8'}).trim();
 const tracked=git(['ls-tree','-rz',head,'--',...sourcePaths],{cwd:project});
 if(git(['--no-optional-locks','status','--porcelain','--untracked-files=no','--',...sourcePaths],{cwd:project}).length)throw Error('Uncommitted changes in Telegram source paths');
 if(project!==root){
  const files=git(['ls-tree','-rz','--name-only',head,'--',...sourcePaths],{cwd:project,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const path of files){
   const copy=resolve(root,path);
   if(!lstatSync(copy,{throwIfNoEntry:false})?.isFile()||!readFileSync(copy).equals(readFileSync(resolve(project,path))))throw Error('Telegram source snapshot differs from the worktree');
  }
 }
 const installed=realpathSync(resolve(root,'node_modules')),paths=[];
 const list=path=>{
  const entry=lstatSync(resolve(installed,path));
  if(entry.isDirectory())for(const name of readdirSync(resolve(installed,path)))list(path+'/'+name);
  else if(entry.isFile())paths.push(path);
  else throw Error('Unexpected file type in Telegram SDK packages');
 };
 for(const name of names)list(name);
 if(sha(paths.sort().join('\0')+'\0')!==sdkInventory)throw Error('Telegram SDK file inventory changed: review required');
 const temporary=mkdtempSync(resolve(tmpdir(),'pulso-telegram-source-'));
 try{
  // Assemble tracked blobs and validated package files without writing to the real index or object store.
  git(['init','--quiet','--bare','--template=','--object-format=sha1',temporary]);
  const objects=git(['rev-parse','--git-path','objects'],{cwd:project,encoding:'utf8'}).trimEnd();
  writeFileSync(resolve(temporary,'objects/info/alternates'),resolve(project,objects)+'\n');
  const stage=(args,options)=>git(['--git-dir='+temporary,...args],options);
  stage(['--work-tree='+installed,'-c','core.autocrlf=false','-c','core.filemode=false','add','-f','--',...names],{cwd:installed});
  const dependencies=stage(['write-tree'],{encoding:'utf8'}).trim();
  if(dependencies!==sdkTree)throw Error('Telegram SDK package bytes changed: review required');
  stage(['read-tree','--empty']);
  stage(['update-index','-z','--index-info'],{input:tracked});
  stage(['read-tree','-i','--prefix=node_modules/',dependencies]);
  const tree=stage(['write-tree'],{encoding:'utf8'}).trim();
  const identity={name:'Pulso Web',email:'archive@pulso.invalid',date:'2026-11-02T00:00:00Z'};
  const env={...gitEnvironment};for(const role of ['AUTHOR','COMMITTER'])for(const [key,value] of Object.entries(identity))env[`GIT_${role}_${key.toUpperCase()}`]=value;
  const commit=stage(['-c','commit.gpgSign=false','commit-tree',tree,'-m','Pulso Telegram sources'],{env,encoding:'utf8'}).trim();
  stage(['archive','--format=tar.gz','--output='+out,commit]);
 }finally{rmSync(temporary,{recursive:true,force:true});}
}

export function writeTelegramSources(directory){
 const out=resolve(directory),index=JSON.parse(readFileSync(resolve(root,'vendor/telegram-wasm/SOURCE-MANIFEST.json')));
 for(const entry of index.sourceFiles){const data=readFileSync(resolve(root,'vendor/telegram-wasm',entry.path));if(data.length!==entry.bytes||sha(data)!==entry.sha256)throw Error('Telegram WASM source changed: review required');}
 writeSourceArchive(resolve(out,'telegram-sources.tar.gz'));
 const extra=readFileSync(resolve(root,'vendor/telegram-wasm/PULSO-NOTICES.txt'));
 const notices=resolve(out,'THIRD-PARTY-NOTICES.txt');writeFileSync(notices,Buffer.concat([readFileSync(notices),Buffer.from('\n\n===== Telegram composite WASM sources and licenses =====\n\n'),extra]));
 const manifest=JSON.parse(readFileSync(resolve(out,'third-party-licenses.json')));manifest.sha256=sha(readFileSync(notices));manifest.telegramSources={file:'/telegram-sources.tar.gz',notices:'vendor/telegram-wasm/PULSO-NOTICES.txt'};
 const countryChunks=[readFileSync(notices),Buffer.from('\n\n===== Country/calling-code facts derived from Google libphonenumber · Apache-2.0 =====\n\n')];
 let offset=countryChunks.reduce((n,bytes)=>n+bytes.length,0);const countryNotices=[];
 for(const record of phoneCountryFiles){
  const originalFile=`vendor/phone-countries/${record.file}`,bytes=readFileSync(resolve(root,originalFile));
  if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw Error('Phone-country source notices changed: review required');
  const header=Buffer.from(`===== ${originalFile} =====\n\n`);countryChunks.push(header);offset+=header.length;
  countryNotices.push({originalFile,offset,bytes:bytes.length,sha256:sha(bytes)});countryChunks.push(bytes,Buffer.from('\n\n'));offset+=bytes.length+2;
 }
 writeFileSync(notices,Buffer.concat(countryChunks));manifest.sha256=sha(readFileSync(notices));
 manifest.phoneCountryData={license:'Apache-2.0',source:'vendor/phone-countries/SOURCE.json',notices:countryNotices};
 manifest.telegramSources.sha256=sha(readFileSync(resolve(out,'telegram-sources.tar.gz')));writeFileSync(resolve(out,'third-party-licenses.json'),JSON.stringify(manifest,null,2)+'\n');
 // The SW generation must also change when accompanying sources/recipe change.
 return sha(Buffer.from(JSON.stringify(manifest)));
}
