/** Accompany every distributed SDK WASM with its source, original notices and replacement recipe. */
import {readFileSync,writeFileSync,copyFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=data=>createHash('sha256').update(data).digest('hex');
const root=resolve(import.meta.dirname,'..');
const names=['@mtcute/web','@mtcute/core','@mtcute/wasm','@mtcute/file-id','@mtcute/tl-runtime','@fuman/io','@fuman/net','@fuman/utils','long'];
export function writeTelegramSources(directory){
 const out=resolve(directory),index=JSON.parse(readFileSync(resolve(root,'vendor/telegram-wasm/SOURCE-MANIFEST.json')));
 for(const entry of index.sourceFiles){const data=readFileSync(resolve(root,'vendor/telegram-wasm',entry.path));if(data.length!==entry.bytes||sha(data)!==entry.sha256)throw Error('Telegram WASM source changed: review required');}
 const extra=readFileSync(resolve(root,'vendor/telegram-wasm/PULSO-NOTICES.txt'));
 const notices=resolve(out,'THIRD-PARTY-NOTICES.txt');writeFileSync(notices,Buffer.concat([readFileSync(notices),Buffer.from('\n\n===== Telegram composite WASM sources and licenses =====\n\n'),extra]));
 const manifest=JSON.parse(readFileSync(resolve(out,'third-party-licenses.json')));manifest.sha256=sha(readFileSync(notices));manifest.telegramSources={file:'/telegram-sources.tar.gz',notices:'vendor/telegram-wasm/PULSO-NOTICES.txt'};
 const sourceFiles=['package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html','pilot.html','samples.html','src','public','scripts','tests','vendor/telegram-wasm',...names.map(n=>`node_modules/${n}`)];
 // All roots are explicit. No .local, owner configuration, attachment or session is archived.
 execFileSync('tar',['--sort=name','--mtime=2026-11-02T00:00:00Z','--owner=0','--group=0','--numeric-owner','-czf',resolve(out,'telegram-sources.tar.gz'),...sourceFiles],{cwd:root,stdio:'pipe'});
 manifest.telegramSources.sha256=sha(readFileSync(resolve(out,'telegram-sources.tar.gz')));writeFileSync(resolve(out,'third-party-licenses.json'),JSON.stringify(manifest,null,2)+'\n');
 // The SW generation must also change when accompanying sources/recipe change.
 return sha(Buffer.from(JSON.stringify(manifest)));
}
export function writePrivateTelegramConfiguration(directory){
 const source=resolve(root,'.local/telegram-owner/api-identity.json');
 // Explicit private-delivery step only; not called by the ordinary product build.
 if(!statSync(source).isFile())throw Error('Private Telegram configuration absent');
 const config=JSON.parse(readFileSync(source));if(!Number.isSafeInteger(config.api_id)||!/^[a-f0-9]{32}$/.test(config.api_hash))throw Error('Invalid private Telegram configuration');
 copyFileSync(source,resolve(directory,'telegram-config.json'));
}
