// Read-only verification of an already completed native run; no browser rerun.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {root,digest,tree,json} from './evidence.mjs';
const receipt=resolve(process.argv[2]??'.local/evidence/queue-insertion-main-r110.json'),r=JSON.parse(await readFile(receipt,'utf8'));
assert.equal(r.status,'PASS_NATIVE_FOCAL_NOT_P0_ACCEPTANCE');assert.equal(r.cases.length,18);assert.ok(r.cases.every(c=>c.status==='PASS'));assert.deepEqual(r.errors,[]);assert.deepEqual(r.external,[]);assert.deepEqual(r.csp,[]);assert.ok(Object.values(r.cleanup).every(x=>x===true));
assert.deepEqual(r.freezeAfter.sources,r.freezeBefore.sources);assert.equal(r.freezeSourceCount,Object.keys(r.freezeBefore.sources).length);
for(const [path,expected]of Object.entries(r.freezeBefore.sources))assert.deepEqual(await digest(resolve(root,path)),expected,path);
for(const p of ['src','public']){assert.deepEqual(await tree(resolve(root,p)),r.initialSources[p]);assert.deepEqual(await tree(resolve(r.run,'snapshot',p)),r.initialSources[p]);}
for(const b of r.builds)assert.deepEqual(await tree(resolve(r.run,b.name)),b.outputs,b.name+' exact output hash map');
const scans=[];
for(const id of ['G03','G04','G09']){
 const t=JSON.parse(await readFile(resolve(r.run,id+'-trace.json'),'utf8')),expected=t.producers.flat();
 const unique=new Map(expected.map(a=>[a.backend+':'+a.storageKey,a]));assert.equal(unique.size,expected.length,'Each new physical generation prepared once '+id);
 for(const a of expected){const actual=t.verifications.filter(v=>JSON.stringify(v.asset)===JSON.stringify(a)&&v.integrity===true);assert.equal(actual.length,1,`${id} one full hash pass per unique ${a.id}`);scans.push({case:id,asset:a,fullHashPasses:actual.length});}
}
const reuse=r.cases.find(c=>c.id==='G08').detail;assert.equal(reuse.newProducer,0);assert.equal(reuse.newURL,0);
for(const label of ['engramInitial','engramFinal']){assert.equal(r[label].tasks.length,14);assert.equal(r[label].FullContentVerified,true);assert.ok(r[label].tasks.every(t=>t.project==='Pulso-Web'&&t.FullContentVerified));}
const proof={status:'VERIFIED_NATIVE_RECEIPT_AND_CURRENT_SOURCE',receipt,receiptHash:await digest(receipt),run:r.run,sourceCount:r.freezeSourceCount,scanAccounting:scans,reuseOldZeroNewProducerAndURL:true,helper:await digest(import.meta.filename),limits:r.limits};
await json(resolve(r.run,'native-scan-proof.json'),proof);await json(resolve(root,'.local/queue-insertion-main-r110/native-scan-proof.json'),proof);console.log(JSON.stringify({status:proof.status,sourceCount:proof.sourceCount,uniqueScans:scans.length,run:r.run}));
