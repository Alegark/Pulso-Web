import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {noticeArtifacts,reviewedPackages,verifyBundledModule,projectRoot} from '../../scripts/third-party-notices.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('all reviewed notices retain every original byte, copyright and conditions',()=>{
 const {text,manifest}=noticeArtifacts();assert.equal(manifest.packages.length,17);assert.equal(hash(text),manifest.sha256);
 for(const row of manifest.packages){const expected=reviewedPackages.find(p=>p.name===row.name);const original=readFileSync(resolve(projectRoot,expected.noticeFiles[0].file));const slice=text.subarray(row.offset,row.offset+row.bytes);assert.deepEqual(slice,original);assert.equal(hash(slice),row.sha256);}
 assert.match(text.toString(),/Permission is hereby granted/);assert.match(text.toString(),/Redistribution and use in source and binary forms/);
 assert.equal(manifest.packages.some(p=>p.name.startsWith('@mtcute/')||p.name.includes('ffmpeg')),false);
});
test('module inventory guard permits current reviewed packages and rejects an unreviewed SDK',()=>{
 verifyBundledModule(resolve(projectRoot,'node_modules/react/index.js'));verifyBundledModule('\0'+resolve(projectRoot,'node_modules/react/jsx-runtime.js')+'?commonjs-proxy');
 assert.throws(()=>verifyBundledModule(resolve(projectRoot,'node_modules/@mtcute/web/index.js')),/License review required before bundling/);
});
test('changed package metadata or notice bytes stop generation and module bundling',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'pulso-license-fixture-'));const name='own-fixture';const dir=resolve(root,'node_modules',name);mkdirSync(dir,{recursive:true});
 const original=Buffer.from('Own test-only notice\r\nUnicode: canción\r\n');const row={name,version:'1.0.0',license:'MIT',noticeFiles:[{file:`node_modules/${name}/LICENSE`,bytes:original.length,sha256:hash(original)}]};
 try{
  const pkg={name,version:'1.0.0',license:'MIT'};writeFileSync(resolve(dir,'package.json'),JSON.stringify(pkg));writeFileSync(resolve(dir,'LICENSE'),original);
  assert.equal(noticeArtifacts({root,packages:[row]}).manifest.packages.length,1);verifyBundledModule(resolve(dir,'index.js'),{root,packages:[row]});
  writeFileSync(resolve(dir,'package.json'),JSON.stringify({...pkg,version:'2.0.0'}));assert.throws(()=>noticeArtifacts({root,packages:[row]}),/metadata changed/);assert.throws(()=>verifyBundledModule(resolve(dir,'index.js'),{root,packages:[row]}),/metadata changed/);
  writeFileSync(resolve(dir,'package.json'),JSON.stringify(pkg));const corrupt=Buffer.from(original);corrupt[0]^=1;writeFileSync(resolve(dir,'LICENSE'),corrupt);
  assert.throws(()=>noticeArtifacts({root,packages:[row]}),/original notice changed/);assert.throws(()=>verifyBundledModule(resolve(dir,'index.js'),{root,packages:[row]}),/original notice changed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
