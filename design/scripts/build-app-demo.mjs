import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Only the isolated design entry. Product main/dist, SDK and storage are excluded.
const result=await build({entryPoints:['design/app/DemoApp.tsx'],bundle:true,write:false,outdir:'.local/design-screens/unused',format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'},target:['safari15.4','chrome100'],legalComments:'inline'});
const script=result.outputFiles.find(file=>file.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script');
const style=result.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html=`<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Pulso · Muestra navegable</title><style>${style}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
await mkdir(resolve('design/prototypes'),{recursive:true});
await writeFile('design/prototypes/app-demo.html',html);
const previewDocument=html.replace('<div id="root"></div>','<div id="root" data-start="playlists"></div>');
function frame(document,title){
  const escaped=document.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent}iframe{display:block;box-sizing:border-box;inline-size:100%;block-size:840px;border:1px solid var(--border,#d9e0ea);border-radius:16px}</style></head><body><iframe title="${title}" sandbox="allow-scripts" srcdoc="${escaped}"></iframe></body></html>`;
}
await writeFile('design/prototypes/app-preview.html',frame(previewDocument,'Pulso: playlists y avisos flotantes de muestra'));
const playerDocument=html.replace('<div id="root"></div>','<div id="root" data-start="player"></div>');
await writeFile('design/prototypes/player-lyrics-preview.html',frame(playerDocument,'Pulso: reproductor, Favoritos y letra de muestra'));
const mobilePreview=frame(html,'Pulso: móvil, accesos y acciones de canción').replace('iframe{display:block;','iframe{max-inline-size:390px;margin-inline:auto;display:block;');
await writeFile('design/prototypes/mobile-preview.html',mobilePreview);
const escapedDesktop=html.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const desktopPreview=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent}.desktop-preview{position:relative;inline-size:100%;overflow:hidden;border-radius:var(--radius,12px)}iframe{display:block;inline-size:1366px;block-size:860px;border:0;transform-origin:top left}</style></head><body><div class="desktop-preview"><iframe title="Pulso: escritorio de 1366px" sandbox="allow-scripts" srcdoc="${escapedDesktop}"></iframe></div><script>const panel=document.querySelector('.desktop-preview'),frame=document.querySelector('iframe');const fit=()=>{const scale=Math.min(1,panel.clientWidth/1366);frame.style.transform='scale('+scale+')';panel.style.height=(860*scale)+'px';};new ResizeObserver(fit).observe(panel);fit();</script></body></html>`;
await writeFile('design/prototypes/desktop-preview.html',desktopPreview);
console.log('design/prototypes/app-demo.html · standalone design fixture · '+Buffer.byteLength(html)+' bytes');
