import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Cloudflare gives the library API priority over static assets',async()=>{
 const config=JSON.parse(await readFile(new URL('../../wrangler.jsonc',import.meta.url),'utf8'));
 assert.ok(config.assets.run_worker_first.includes('/api/account-library'));
});
