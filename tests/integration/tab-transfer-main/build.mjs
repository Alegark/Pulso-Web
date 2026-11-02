import assert from 'node:assert/strict';
import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'vite';
import {licenseGuard} from '../../../scripts/third-party-notices.mjs';
import {root,sources,tree,json} from './evidence.mjs';
import {fixtures,fixtureEntry,legacyEntry} from './fixtures.mjs';
import {instrument} from './instrument.mjs';
export async function prepareBuild(run){const before=await sources(),snapshot=resolve(run,'snapshot');await mkdir(snapshot,{recursive:true});for(const path of ['src','public','index.html'])await cp(resolve(root,path),resolve(snapshot,path),{recursive:true});
 const copied={...await tree(resolve(snapshot,'src'),'src/'),...await tree(resolve(snapshot,'public'),'public/')};assert.deepEqual(copied,before,'Concurrent source change while copying DRAFT; preserve run and retry with new task');
 const html=await readFile(resolve(snapshot,'index.html'),'utf8');await writeFile(resolve(snapshot,'fixture.html'),html.replace('/src/main.tsx','/fixture.ts'));await writeFile(resolve(snapshot,'fixture.ts'),fixtureEntry);
 await writeFile(resolve(snapshot,'legacy.html'),html.replace('<div id="root"></div>','<div id="root"></div><p id="state"></p><button id="release">Legacy ceder</button>').replace('/src/main.tsx','/legacy.ts'));await writeFile(resolve(snapshot,'legacy.ts'),legacyEntry);
 await writeFile(resolve(snapshot,'blank.html'),html.replace('<script type="module" src="/src/main.tsx"></script>',''));
 const manifest=await fixtures(resolve(snapshot,'public/fixtures')),records=[],builds=[];
 for(const mode of ['native','observed']){const outDir=resolve(run,mode);await build({configFile:false,root:snapshot,plugins:[licenseGuard(),...(mode==='observed'?[instrument(snapshot,records)]:[])],worker:{plugins:()=>[licenseGuard()]},build:{outDir,emptyOutDir:true,rolldownOptions:{input:['index.html','fixture.html','legacy.html','blank.html'].map(p=>resolve(snapshot,p))}}});
 // Genuine product SW, independently bundled with this harness shell. No SW APIs replaced.
 const shell=['/','/index.html',...Object.keys(await tree(resolve(outDir,'assets'))).map(p=>'/assets/'+p)];await build({configFile:false,root:snapshot,define:{SHELL_FILES:JSON.stringify(shell)},plugins:[licenseGuard()],build:{emptyOutDir:false,outDir,lib:{entry:resolve(snapshot,'src/service-worker/sw.ts'),formats:['es'],fileName:()=> 'sw.js'}}});builds.push({mode,files:await tree(outDir),mainTransformed:mode==='observed'});}
 assert.deepEqual(await sources(),before,'Sources changed during build: exploratory output only');await json(resolve(run,'source-map-built.json'),before);await json(resolve(run,'instrumentation.json'),records);return {sources:before,manifest,builds,records};}
