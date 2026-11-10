import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const sourcePath=new URL('../prototypes/player-directions.html',import.meta.url);
const source=await readFile(sourcePath,'utf8');
const sourceSHA256=createHash('sha256').update(source).digest('hex');
const style=`<style>
html,body{padding:0!important;margin:0;background:transparent;overflow:hidden}
.lab-tools,.direction-note,.lab-foot{display:none}
#stage{padding-top:74px}
.app{height:calc(var(--mobile-visible-height,760px) - 74px);display:flex;flex-direction:column;overflow:hidden}
html.prototype-player-open #stage{padding-top:0}
html.prototype-player-open .app{height:var(--mobile-visible-height,760px)}
.workspace,.app[data-theme="grafito"] .workspace,.app[data-theme="tinta"] .workspace{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.dock,.bottom-nav{flex:0 0 auto}
.bottom-nav{padding-bottom:max(2px,env(safe-area-inset-bottom,0px))}
.feedback:empty{display:none}
.feedback:not(:empty){position:absolute;bottom:142px;inset-inline:16px;z-index:6;margin:0;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 16px #0002}
.expanded,.app[data-theme="grafito"] .expanded{position:absolute;inset:8px;block-size:auto;padding:12px;scroll-padding-block:70px 16px}
.expanded-heading{position:sticky;top:-12px;z-index:2;padding-block:8px;background:var(--card);margin-bottom:18px}
.app[data-theme="tinta"] .expanded-heading{background:var(--background)}
.expanded .cover,.app[data-theme="grafito"] .expanded .cover,.app[data-theme="tinta"] .expanded .cover{width:min(100%,var(--mobile-cover-size,190px));height:auto;aspect-ratio:1/1;flex:none;min-height:0}
.cover:not(.missing)>svg{position:absolute;inset:0;width:100%;height:100%}
.cover-top{max-width:60%;font-size:.42rem!important;line-height:1.3}
.cover-edition{font-size:.4rem!important}
.expanded .cover-bottom{font-size:clamp(1rem,5vw,1.6rem)}
.listening-grid,.app[data-theme="tinta"] .listening-grid,.app[data-theme="grafito"] .listening-grid{gap:18px;min-width:0}
.player-body{min-width:0;flex:none}.now-meta{margin-bottom:12px}.transport{margin:12px 0}.player-subtools{margin-top:8px}
.expanded h2:focus{outline:none}
.app[data-theme="grafito"] .expanded{inset:8px;width:auto}
@media(max-height:480px){.expanded .cover,.app[data-theme="grafito"] .expanded .cover,.app[data-theme="tinta"] .expanded .cover{width:80px}.expanded-heading{margin-bottom:12px}.listening-grid{gap:12px}}
</style>`;
const script=`<script>
let requestedMobileView='album';
function measureMobile(){const h=window.visualViewport?.height||innerHeight;document.documentElement.style.setProperty('--mobile-visible-height',Math.max(180,h)+'px');document.documentElement.style.setProperty('--mobile-cover-size',Math.max(70,Math.min(210,(h-250)*.4))+'px');}
measureMobile();addEventListener('resize',measureMobile);visualViewport?.addEventListener('resize',measureMobile);
function publishMobileView(){requestedMobileView=expanded?'player':'album';if(parent!==window)parent.postMessage({pulsoMobileView:true,view:requestedMobileView},'*');}
function applyMobileView(){const panel=document.querySelector('.expanded');if(!panel)return;if(requestedMobileView==='player'&&panel.hidden)setExpanded(true,document.querySelector('.dock-copy'));else if(requestedMobileView==='album'&&!panel.hidden)setExpanded(false);publishMobileView();}
addEventListener('message',event=>{if(event.source!==parent||event.data?.pulsoMobileCommand!==true||!['album','player'].includes(event.data.view))return;requestedMobileView=event.data.view;applyMobileView();});
new MutationObserver(applyMobileView).observe(document.getElementById('stage'),{childList:true});
document.addEventListener('click',()=>queueMicrotask(publishMobileView));document.addEventListener('keydown',()=>queueMicrotask(publishMobileView));
<\/script>`;
const child=source.replace('</head>',style+'</head>').replace('</body>',script+'</body>');
await writeFile(new URL('../prototypes/player-phone.html',import.meta.url),child);
const escape=html=>html.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Pulso · Vista móvil</title><style>
:root{--background:transparent;--foreground:#eeeef3;--muted:#b0b0bd;--card:#222229;--border:#454550;--primary:#b4a5ff;--radius:12px;--font-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-family:var(--font-sans);color:var(--foreground);color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent}.mobile-demo{max-width:390px;margin-inline:auto}.views{display:flex;gap:8px;justify-content:center;margin:0 0 10px}.views button{font:inherit;font-size:13px;min-height:44px;padding:0 18px;border:1px solid var(--border);border-radius:999px;color:var(--muted);background:transparent;cursor:pointer;touch-action:manipulation}.views button[aria-pressed="true"]{background:var(--card);color:var(--foreground);border-color:var(--primary)}button:focus-visible{outline:3px solid var(--primary);outline-offset:3px}iframe{display:block;width:100%;height:580px;border:0;background:transparent}.note{font-size:12px;line-height:1.6;color:var(--muted);margin:10px 0 0;text-align:center}
</style></head><body><!-- Source SHA-256 ${sourceSHA256}; preview height follows the visible viewport. --><div class="mobile-demo"><div class="views" role="group" aria-label="Vista móvil"><button data-view="album" aria-pressed="true">Álbum</button><button data-view="player" aria-pressed="false">Reproductor</button></div><iframe id="mobile" title="Pulso, prototipo móvil interactivo" sandbox="allow-scripts" allow="autoplay" srcdoc="${escape(child)}"></iframe><p class="note">Muestra móvil · datos y audio de prueba.<br>Álbum desplazable y controles accesibles.</p></div><script>
const frame=document.getElementById('mobile'),views=[...document.querySelectorAll('[data-view]')];let view='album';
function fitFrame(){const available=window.visualViewport?.height||innerHeight,toolbar=document.querySelector('.views').getBoundingClientRect().height+10,note=document.querySelector('.note').getBoundingClientRect().height+10;frame.style.height=Math.max(180,Math.min(842,available-toolbar-note-16))+'px';}
fitFrame();addEventListener('resize',fitFrame);visualViewport?.addEventListener('resize',fitFrame);
function mark(next){view=next;views.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===next)));}
views.forEach(button=>button.addEventListener('click',()=>{mark(button.dataset.view);frame.contentWindow.postMessage({pulsoMobileCommand:true,view},'*');}));
frame.addEventListener('load',()=>{fitFrame();frame.contentWindow.postMessage({pulsoMobileCommand:true,view},'*');});
addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.pulsoMobileView===true&&['album','player'].includes(event.data.view))mark(event.data.view);});
<\/script></body></html>`;
const output=new URL('../prototypes/player-mobile.html',import.meta.url);
await writeFile(output,html);
console.log(JSON.stringify({sourceSHA256,output:fileURLToPath(output),bytes:Buffer.byteLength(html)}));
