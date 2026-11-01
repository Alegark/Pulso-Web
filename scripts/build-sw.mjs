import {build} from 'vite';
import {readFileSync,readdirSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {writeNoticeArtifacts,licenseGuard} from './third-party-notices.mjs';
const noticeHash=writeNoticeArtifacts('dist');
copyFileSync('dist/index.html','dist/try.html');
copyFileSync('dist/index.html','dist/listen.html');
copyFileSync('dist/index.html','dist/web.html');
const id = createHash('sha256').update(readFileSync('dist/index.html')).digest('hex').slice(0,16);
mkdirSync('dist/releases',{recursive:true});
copyFileSync('dist/index.html',`dist/releases/${id}.html`);
// Keep launcher/pointer outside SHELL_FILES so an old controller cannot pin them.
writeFileSync('dist/latest.json',JSON.stringify({version:1,entry:`/releases/${id}.html`})+'\n');
const files = ['/', '/index.html', '/try.html', '/listen.html', '/web.html', `/releases/${id}.html`, '/pilot.html', '/samples.html', '/THIRD-PARTY-NOTICES.txt', '/third-party-licenses.json', ...readdirSync('dist/assets').map(name => `/assets/${name}`)];
await build({configFile:false,define:{SHELL_FILES:JSON.stringify(files)},build:{emptyOutDir:false,outDir:'dist',lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'},rolldownOptions:{output:{intro:`// Shell ${id}; notices ${noticeHash}`}}},plugins:[licenseGuard(),{name:'shell-version',transform(code,idPath){if(idPath.endsWith('/sw.ts'))return code.replace('pulso-shell-BUILD_ID',`pulso-shell-${id}-${noticeHash.slice(0,16)}`);}}]});
