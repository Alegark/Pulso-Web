import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validManifest} from '../../src/storage/manifest.ts';
import {fixtures} from '../../src/fixtures.ts';
const fixture=fixtures[0];
const good={id:fixture.id,namespace:'local',storageKey:'00000000-0000-0000-0000-000000000001',bytes:fixture.bytes,sha256:fixture.sha256,mime:fixture.mime,chunks:2,state:'complete',revision:1};
test('manifiesto debe cumplir identidad, límites e integridad esperada',()=>{
 assert.ok(validManifest(good,fixture));
 for(const change of [{chunks:-1},{chunks:Infinity},{chunks:fixture.bytes+1},{revision:0},{namespace:'other'},{state:'partial'},{bytes:fixture.bytes-1},{sha256:'0'.repeat(64)},{mime:'text/html'},{storageKey:'../../other'},{id:'another'}])assert.equal(validManifest({...good,...change},fixture),false);
});
