import {build} from 'vite';
import {readFileSync,readdirSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {writeNoticeArtifacts,licenseGuard} from './third-party-notices.mjs';
import {writeTelegramSources} from './telegram-source.mjs';
writeNoticeArtifacts('dist');
const noticeHash=writeTelegramSources('dist');
const html=readFileSync('dist/index.html','utf8');
const id=createHash('sha256').update(html).digest('hex').slice(0,16);
// Stamp the built document before copying it to every shell URL. The address
// can still refer to an older entry when a worker serves the current shell.
if(!html.includes('<title>'))throw Error('Missing title in the built shell');
writeFileSync('dist/index.html',html.replace('<title>',`<meta name="pulso-release" content="${id}"><title>`));
copyFileSync('dist/index.html','dist/try.html');
copyFileSync('dist/index.html','dist/listen.html');
copyFileSync('dist/index.html','dist/web.html');
mkdirSync('dist/releases',{recursive:true});
copyFileSync('dist/index.html',`dist/releases/${id}.html`);
// Keep launcher/pointer outside SHELL_FILES so an old controller cannot pin them.
writeFileSync('dist/latest.json',JSON.stringify({version:1,entry:`/releases/${id}.html`})+'\n');
const files = ['/', '/index.html', '/try.html', '/listen.html', '/web.html', `/releases/${id}.html`, '/pilot.html', '/samples.html', '/THIRD-PARTY-NOTICES.txt', '/third-party-licenses.json', '/manifest.webmanifest', '/icons/pulso-192.png', '/icons/pulso-512.png', '/icons/pulso-maskable-512.png', ...readdirSync('dist/assets').map(name => `/assets/${name}`)];
await build({configFile:false,define:{SHELL_FILES:JSON.stringify(files)},build:{emptyOutDir:false,outDir:'dist',lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'},rolldownOptions:{output:{intro:`// Shell ${id}; notices ${noticeHash}`}}},plugins:[licenseGuard(),{name:'shell-version',renderChunk(code){
 // Changes confined to the worker still install into a distinct cache.
 const workerId=createHash('sha256').update(id).update(noticeHash).update(code).digest('hex').slice(0,16);
 return code.replaceAll('pulso-shell-BUILD_ID',`pulso-shell-${id}-${workerId}`);
 }}]});
