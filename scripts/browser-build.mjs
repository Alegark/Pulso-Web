import {build} from 'vite';
import {cpSync} from 'node:fs';
const pages=['metadata-rescan','index','sdk','library','blob','opfs','artwork','artwork-containers','local-batches','lyrics','embedded-lyrics','restored-tracks','organization','lrclib','album-source'];
const selected=process.argv.slice(2);
if(selected.some(name=>!pages.includes(name))||new Set(selected).size!==selected.length)throw new Error('Filtro de páginas browser inválido.');
const single = selected.length === 1 ? selected[0] : undefined;
const isolated = {
  'metadata-rescan': '.local/metadata-rescan-r71/build',
  'album-source': '.local/album-source-r66/build',
  lrclib: '.local/lrclib-r57/build',
};
const dedicatedDir = Object.hasOwn(isolated, single) ? isolated[single] : undefined;
const customDir = process.env.PULSO_BROWSER_BUILD_DIR;
const outDir = customDir || dedicatedDir || '.local/browser-tests';
await build({
  configFile: false,
  ...(dedicatedDir ? {publicDir: false} : {}),
  build: {
    outDir,
    emptyOutDir: !customDir,
    rolldownOptions: {input: (selected.length ? selected : pages).map(name => `tests/browser/${name}.html`)},
  },
});
if (single === 'metadata-rescan' || single === 'album-source') {
  cpSync('public/fixtures', `${outDir}/fixtures`, {recursive: true});
}
console.log(`Pruebas de navegador compiladas en ${outDir}. Ejecuta npm run test:browser:run${selected.length ? ' -- ' + selected.join(' ') : ''} con la misma configuración de entorno.`);
