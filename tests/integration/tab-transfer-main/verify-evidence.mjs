// Read-only artifact verification. Never upgrades a failed/mixed selection.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {root,digest,tree,sources,json} from './evidence.mjs';
const path=process.argv[2];assert.ok(path,'Report path required');const r=JSON.parse(await readFile(resolve(root,path),'utf8'));
assert.equal(r.project,'Pulso-Web');assert.equal(r.status,'PASS_FOCAL_NOT_P0');assert.equal(r.groups.length,17);assert.ok(r.groups.every(g=>g.status==='PASS'));assert.deepEqual(r.cleanup,{contexts:true,browser:true,server:true});
for(const key of ['errors','csp','external','sockets'])assert.deepEqual(r[key],[],key);
assert.equal(r.freeze.frozen,true);assert.equal(Object.keys(r.freeze.sources).length,135);assert.deepEqual(r.freeze.sources,r.preparedBuild.sources);assert.deepEqual(r.finalSources,r.freeze.sources);assert.deepEqual(r.currentSources,r.freeze.sources);assert.deepEqual(await sources(),r.freeze.sources);
for(const [path,hash]of Object.entries(r.freeze.sources))assert.deepEqual(await digest(resolve(r.run,'snapshot',path)),hash,path);
for(const b of r.preparedBuild.builds)assert.deepEqual(await tree(resolve(r.run,b.mode)),b.files,b.mode);
assert.equal(r.preparedBuild.builds.find(b=>b.mode==='native').mainTransformed,false);assert.equal(r.preparedBuild.builds.find(b=>b.mode==='observed').mainTransformed,true);
for(const [p,hash]of Object.entries(r.rawFiles))assert.deepEqual(await digest(resolve(r.run,p)),hash,p);
const receipt={project:r.project,status:'VERIFIED_SAME_SELECTION_NOT_P0',report:await digest(resolve(root,path)),run:r.run,groups:17,sources:Object.keys(r.freeze.sources).length,runner:r.runnerFiles,limitations:r.limits};
await json(resolve(r.run,'verification.json'),receipt);console.log(JSON.stringify(receipt));
