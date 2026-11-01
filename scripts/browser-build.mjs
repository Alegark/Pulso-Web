import {build} from 'vite';
import {cpSync} from 'node:fs';
const pages=['metadata-rescan','index','sdk','library','blob','opfs','artwork','artwork-containers','local-batches','lyrics','embedded-lyrics','restored-tracks','organization','lrclib','album-source'];
const selected=process.argv.slice(2);
if(selected.some(name=>!pages.includes(name))||new Set(selected).size!==selected.length)throw new Error('Filtro de páginas browser inválido.');
if(selected.length===1&&selected[0]==='metadata-rescan'){
 await build({configFile:false,publicDir:false,build:{outDir:'.local/metadata-rescan-r71/build',emptyOutDir:true,rolldownOptions:{input:'tests/browser/metadata-rescan.html'}}});
 cpSync('public/fixtures','.local/metadata-rescan-r71/build/fixtures',{recursive:true});
 process.exit(0);
}
await build({configFile:false,...(selected.length===1&&['lrclib','album-source'].includes(selected[0])?{publicDir:false}:{}),build:{outDir:selected.length===1&&selected[0]==='album-source'?'.local/album-source-r66/build':selected.length===1&&selected[0]==='lrclib'?'.local/lrclib-r57/build':'.local/browser-tests',emptyOutDir:true,rolldownOptions:{input:(selected.length?selected:pages).map(name=>`tests/browser/${name}.html`)}}});
if(selected.length===1&&selected[0]==='album-source')cpSync('public/fixtures','.local/album-source-r66/build/fixtures',{recursive:true});
if(!(selected.length===1&&['lrclib','album-source'].includes(selected[0])))cpSync('public/fixtures','.local/browser-tests/fixtures',{recursive:true});
if(selected.length===1&&selected[0]==='album-source')console.log('Runner album-source aislado en .local/album-source-r66/build; ejecutar INSTABOX_HEADLESS=1 node scripts/run-browser-tests.mjs album-source.');
else if(selected.length===1&&selected[0]==='lrclib')console.log('Runner LRCLIB aislado en .local/lrclib-r57/build. Ejecutar INSTABOX_HEADLESS=1 node scripts/run-browser-tests.mjs lrclib; sólo fixtures locales, no acredita CORS real/iPhone.');
else console.log('Runner de navegador generado. Servir con vite preview --host 127.0.0.1 --port 4174 --outDir .local/browser-tests; abrir /tests/browser/index.html y comprobar window.pulsoTests. No acredita iPhone.');
