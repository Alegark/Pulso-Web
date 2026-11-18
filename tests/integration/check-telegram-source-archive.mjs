/** Verify the public source archive in an isolated Git fixture, without a network or an npm install. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const artifacts=resolve('.local/tmp');
mkdirSync(artifacts,{recursive:true});
const temp=mkdtempSync(resolve(artifacts,'review-telegram-source-'));
const snapshot=resolve(temp,'project'),dist=resolve(temp,'dist'),archive=resolve(dist,'telegram-sources.tar.gz');
const git=(...args)=>execFileSync('git',['-C',snapshot,...args],{stdio:'pipe'});
const notices=()=>{writeFileSync(resolve(dist,'THIRD-PARTY-NOTICES.txt'),'fixture');writeFileSync(resolve(dist,'third-party-licenses.json'),'{}');};
const previousTmp=process.env.TMPDIR;
try{
 process.env.TMPDIR=temp;
 mkdirSync(snapshot);mkdirSync(dist);
 for(const path of ['package.json','package-lock.json','vite.config.ts','tsconfig.json','wrangler.jsonc','index.html','pilot.html','samples.html','src','public','scripts','tests','deployment','vendor/telegram-wasm','vendor/phone-countries','vendor/qr-code']){
  cpSync(path,resolve(snapshot,path),{recursive:true});
 }
 git('init','--quiet','--template=');git('add','--all');
 git('-c','user.name=Archive Test','-c','user.email=archive@example.invalid','-c','commit.gpgSign=false','commit','--quiet','-m','fixture');
 symlinkSync(realpathSync('node_modules'),resolve(snapshot,'node_modules'),'dir');
 writeFileSync(resolve(snapshot,'src','.env.fixture'),'SYNTHETIC_SECRET');
 writeFileSync(resolve(snapshot,'public','untracked-fixture.txt'),'SYNTHETIC_UNTRACKED');
 mkdirSync(resolve(snapshot,'.git/info'),{recursive:true});
 appendFileSync(resolve(snapshot,'.git/info/exclude'),'\nsrc/.env.fixture\n');
 const inheritedIndex=resolve(temp,'unrelated-index'),previousIndex=process.env.GIT_INDEX_FILE;
 process.env.GIT_INDEX_FILE=inheritedIndex;
 let writeTelegramSources;
 try{
  ({writeTelegramSources}=await import(pathToFileURL(resolve(snapshot,'scripts/telegram-source.mjs')).href));
  notices();writeTelegramSources(dist);
 }
 finally{if(previousIndex===undefined)delete process.env.GIT_INDEX_FILE;else process.env.GIT_INDEX_FILE=previousIndex;}
 assert.equal(existsSync(inheritedIndex),false);
 const files=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).split('\n');
 assert.ok(files.includes('src/telegram/session.worker.ts'));
 assert.ok(!files.some(file=>/^src\/telegram\/auth-(state|scope-store)\.ts$/.test(file)));
 assert.ok(files.includes('node_modules/@mtcute/core/package.json'));
 assert.ok(!files.some(file=>file.includes('.env.fixture')||file.includes('untracked-fixture.txt')));
 const first=readFileSync(archive);
 notices();writeTelegramSources(dist);assert.deepEqual(readFileSync(archive),first);
 // A release snapshot under the worktree has no Git metadata of its own.
 const copy=resolve(snapshot,'.local','copy');
 mkdirSync(copy,{recursive:true});
 for(const path of ['package.json','package-lock.json','vite.config.ts','tsconfig.json','wrangler.jsonc','index.html','pilot.html','samples.html','src','public','scripts','tests','deployment','vendor/telegram-wasm','vendor/phone-countries','vendor/qr-code']){
  cpSync(resolve(snapshot,path),resolve(copy,path),{recursive:true});
 }
 symlinkSync(realpathSync('node_modules'),resolve(copy,'node_modules'),'dir');
 const fromCopy=await import(pathToFileURL(resolve(copy,'scripts/telegram-source.mjs')).href);
 notices();fromCopy.writeTelegramSources(dist);assert.deepEqual(readFileSync(archive),first);
 appendFileSync(resolve(copy,'src/telegram/session.worker.ts'),'\n// changed snapshot\n');
 notices();assert.throws(()=>fromCopy.writeTelegramSources(dist),/snapshot/i);
 appendFileSync(resolve(snapshot,'src/telegram/session.worker.ts'),'\n// changed worktree\n');
 notices();assert.throws(()=>writeTelegramSources(dist),/uncommitted/i);
 git('add','src/telegram/session.worker.ts');
 assert.throws(()=>writeTelegramSources(dist),/uncommitted/i);
 console.log('PASS tracked sources, reproducible archive, untracked/ignored exclusion, snapshot and dirty-file guards');
}finally{if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;rmSync(temp,{recursive:true,force:true});}
