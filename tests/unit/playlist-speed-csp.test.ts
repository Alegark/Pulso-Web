import assert from 'node:assert/strict';
import test from 'node:test';
import {speedCspBaseRevision,speedCspDiagnostics} from '../integration/playlist-speed-csp.mjs';

const baseOrigin='http://127.0.0.1:1000',headOrigin='http://127.0.0.1:2000';
const profile={engine:'webkit',mode:'first-sound-direct',requestedBackend:'opfs',backend:'idb',delayMs:400,count:1,
 existingCount:300,rpcMs:200,serviceWorker:false};
const cssMessage="Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";
const violation={directive:'style-src-attr',blockedURI:'inline',sourceFile:baseOrigin+'/',line:1,column:0,
 disposition:'enforce',policy:"style-src 'self'",sample:'',target:[['select','','settings-appearance',null,null]]};
const headViolation={...violation,sourceFile:headOrigin+'/'};

async function reference(){
 const {csp,errors}=await speedCspDiagnostics('.',baseOrigin,speedCspBaseRevision,undefined)(profile,[violation],[cssMessage]);
 assert.equal(csp.novel.length,0);
 assert.deepEqual(errors,[]);
 return {cases:[{...profile,status:'PASS',csp}]};
}

test('speed CSP comparison lists inherited events even when they repeat on a new loopback port',async()=>{
 const compare=speedCspDiagnostics('.',headOrigin,'candidate',await reference());
 const {csp,errors}=await compare(profile,[headViolation,headViolation],[cssMessage]);
 assert.equal(csp.inherited.length,2);
 assert.equal(csp.novel.length,0);
 assert.deepEqual(errors,[]);
});

test('a different target or source remains a new CSP violation even with the same directive',async()=>{
 const compare=speedCspDiagnostics('.',headOrigin,'candidate',await reference());
 const {csp,errors}=await compare(profile,[headViolation,
  {...headViolation,target:[['button','','download',null,null]]},
  {...headViolation,line:2},
 ],[cssMessage,'application error']);
 assert.equal(csp.inherited.length,1);
 assert.equal(csp.novel.length,2);
 assert.deepEqual(errors,['application error']);
});

test('candidate diagnostics require a matching baseline and preserve an unpaired CSP console error',async()=>{
 const compare=speedCspDiagnostics('.',headOrigin,'candidate',await reference());
 const {csp,errors}=await compare({...profile,backend:'opfs'},[headViolation],[cssMessage]);
 assert.equal(csp.novel.length,1);
 assert.deepEqual(errors,['No completed CSP reference for this speed profile']);
 const strict=speedCspDiagnostics('.',headOrigin,'candidate',undefined);
 assert.equal((await strict(profile,[headViolation],[])).csp.novel.length,1);
 assert.deepEqual((await strict(profile,[],[cssMessage])).errors,[cssMessage]);
});
