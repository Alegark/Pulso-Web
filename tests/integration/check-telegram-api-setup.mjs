// Filesystem-only setup test in a relocated temporary project. Format fixtures
// are never written to the real owner config or passed to the Telegram SDK.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,copyFile,writeFile,readFile,stat,symlink,rm,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root=resolve('.local/telegram-api-setup');await mkdir(root,{recursive:true});
const sandbox=await mkdtemp(resolve(root,'relocated-'));
const report={project:'Pulso-Web',passed:false,actualApiConfigured:false,clientConstructed:false,networkAttempted:false,cases:[]};
const file=resolve(sandbox,'.local/telegram-owner/api-identity.json'),script=resolve(sandbox,'scripts/configure-telegram-api.mjs');
const run=args=>exec(process.execPath,['--import','tsx',script,...args],{cwd:process.cwd()});
try{
 await mkdir(resolve(sandbox,'scripts'));await mkdir(resolve(sandbox,'src/telegram'),{recursive:true});
 await copyFile('scripts/configure-telegram-api.mjs',script);await copyFile('src/telegram/api-identity.ts',resolve(sandbox,'src/telegram/api-identity.ts'));
 const initial=await run(['--status']);assert.deepEqual(JSON.parse(initial.stdout),{configured:false,connected:false,userSessionLoaded:false});report.cases.push({name:'Status has no configuration side effect or SDK connection',passed:true});
 const input=resolve(sandbox,'format-fixture.json');await writeFile(input,JSON.stringify({api_id:'12345',api_hash:'Ab'.repeat(16)}),{mode:0o600});
 const configured=await run(['--input',input]);assert.deepEqual(JSON.parse(configured.stdout),{configured:true,connected:false,userSessionLoaded:false,storage:'private-local-file'});assert.equal(configured.stderr,'');
 const canonical=await readFile(file);assert.deepEqual(JSON.parse(canonical),{api_id:12345,api_hash:'ab'.repeat(16)});assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await stat(resolve(sandbox,'.local/telegram-owner'))).mode&0o777,0o700);assert.equal(configured.stdout.includes('12345'),false);assert.equal(configured.stdout.toLowerCase().includes('ab'.repeat(16)),false);report.cases.push({name:'Relocated format fixture writes atomically with 0600/0700 and safe output',passed:true});
 await writeFile(input,JSON.stringify({api_id:12345,api_hash:'ab'.repeat(16),password:'never-accepted'}));let rejected=false;
 try{await run(['--input',input]);}catch(error){rejected=true;assert.equal(error.stdout,'');assert.equal(error.stderr.includes('never-accepted'),false);}assert.ok(rejected);assert.deepEqual(await readFile(file),canonical);assert.deepEqual(await readdir(resolve(sandbox,'.local/telegram-owner')),['api-identity.json']);report.cases.push({name:'Personal fields rejected without overwriting prior config or leaving a temporary file',passed:true});
 await rm(file);const canary=resolve(sandbox,'canary');await writeFile(canary,'preserve');await symlink(canary,file);await writeFile(input,JSON.stringify({api_id:12345,api_hash:'ab'.repeat(16)}));await assert.rejects(run(['--input',input]));assert.equal(await readFile(canary,'utf8'),'preserve');report.cases.push({name:'Symlink target cannot overwrite a canary',passed:true});
 report.passed=true;
}catch(error){report.failure={name:error?.name??'Error'};process.exitCode=1;}
finally{await rm(sandbox,{recursive:true,force:true});report.cleanup=true;await writeFile(resolve(root,'filesystem-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
