// Fixture-only native React component test. No product entry, SDK, account or audio.
import assert from 'node:assert/strict';
import {build, preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir = '.local/music-search-panel-r142';
const report = {passed: false, cases: [], errors: [], external: [], attempts: [], limits: ['Controlled synthetic props/callbacks only; no product integration, Telegram/SDK/API/audio, real bot compatibility or iPhone/P0 claim.', 'Chromium sandbox; CSS font 200% is not physical browser zoom or VoiceOver.']};
try {const old = JSON.parse(await readFile(`${dir}/evidence.json`, 'utf8')); report.attempts = [...old.attempts, ...(old.failure ? [{failure: old.failure, cases: old.cases}] : [])];} catch {}
await mkdir(dir, {recursive: true});
const pass = name => {report.cases.push(name); console.log('PASS ' + name);};
let browser, context, server, page;
const host = async (method, ...args) => page.evaluate(({method,args}) => window.musicHost[method](...args), {method,args});
const calls = () => page.evaluate(() => window.musicHost.calls);
const btn = name => page.getByRole('button', {name, exact: true});
const save = (selector, event, slot) => page.evaluate(({selector,event,slot}) => {const el = document.querySelector(selector); const key = Object.keys(el).find(k => k.startsWith('__reactProps$')); window[slot] = el[key][event];}, {selector,event,slot});
const invoke = slot => page.evaluate(slot => window[slot]({preventDefault() {}, currentTarget: {value: 'stale', checked: true}}), slot);
const suggestions = [
 {id:'t',kind:'track',title:'Canción fixture',subtitle:'Artista fixture',source:'lrclib'},
 {id:'a',kind:'artist',title:'Artista fixture',subtitle:null,source:'local'},
 {id:'l',kind:'album',title:'Álbum fixture',subtitle:'Artista fixture',source:'lrclib'},
];
const ready = {query:'Consulta fixture',providerRows:[{id:'bot',username:'ivkmbot',label:'Bot fixture',supported:true},{id:'other',username:'other_fixturebot',label:'Otro fixture',supported:false}],selectedProviderId:'bot',sessionReady:true,canSearch:true,botConsent:true,searchPending:false,suggestions};
try {
 await writeFile(`${dir}/fixture.html`, '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/tests/integration/music-search-panel-r142-fixture.tsx"></script></html>');
 await build({configFile:false,logLevel:'error',build:{outDir:`${dir}/build`,emptyOutDir:true,rolldownOptions:{input:`${dir}/fixture.html`}}});
 server = await preview({configFile:false,build:{outDir:`${dir}/build`},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
 browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true}); report.browser = browser.version();
 context = await browser.newContext({serviceWorkers:'block',viewport:{width:900,height:700}});
 await context.route('**/*', route => {if(new URL(route.request().url()).origin === origin) return route.continue(); report.external.push(route.request().url()); return route.abort();});
 await context.addInitScript(() => {
  window.panelIO = []; const deny = name => () => {window.panelIO.push(name); throw Error('IO forbidden: '+name);};
  window.fetch=deny('fetch'); window.XMLHttpRequest=deny('XHR'); window.WebSocket=deny('WebSocket'); window.EventSource=deny('EventSource'); navigator.sendBeacon=deny('beacon');
  for (const key of ['getItem','setItem','removeItem','clear']) Storage.prototype[key]=deny('storage.'+key);
  indexedDB.open=deny('idb'); indexedDB.deleteDatabase=deny('deleteDB'); navigator.storage.getDirectory=deny('OPFS');
  HTMLMediaElement.prototype.play=deny('play');
 });
 page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`${origin}/${dir}/fixture.html`); await page.waitForFunction(()=>window.musicHost);
 assert.deepEqual(await calls(),[]); assert.equal(await page.getByRole('combobox').inputValue(),'');
 assert.ok(await page.getByText('Aún no has añadido bots.',{exact:false}).isVisible());
 assert.equal(await btn('Buscar en Telegram').isDisabled(),true);
 assert.equal(await page.locator('input[type=search]').getAttribute('autocomplete'),'off');
 pass('empty bot pool has configuration guidance, no imposed default, no mount callback');
 await host('set',{suggestions}); assert.ok(await page.getByRole('heading',{name:'Canciones',exact:true}).isVisible());
 assert.equal(await page.locator('[data-suggestion-id=t]').isDisabled(),true);
 await page.getByLabel('Canción, artista o álbum',{exact:true}).fill('Escribir fixture');
 assert.deepEqual(await calls(),[['query','Escribir fixture']]);
 await page.locator('[data-suggestion-id=a]').click(); await page.locator('[data-suggestion-id=l]').click();
 assert.deepEqual(await calls(),[['query','Escribir fixture'],['suggestion','a'],['suggestion','l']]);
 assert.ok(await page.getByText('Conecta Telegram',{exact:false}).isVisible());
 pass('disconnected suggestions visible; typing only changes controlled query; artist/album emit only refinement ID');
 await host('reset'); await host('set',ready);
 await page.locator('[data-suggestion-id=t]').focus(); await page.keyboard.press('Enter');
 assert.deepEqual(await calls(),[['suggestion','t']]);
 await host('clear'); await btn('Buscar en Telegram').focus(); await page.keyboard.press('Enter');
 assert.deepEqual(await calls(),[['search']]);
 pass('track choice and explicit form submit each emit exactly one distinct callback with keyboard Enter');
 for (const patch of [{botConsent:false},{sessionReady:false},{canSearch:false},{selectedProviderId:'other'},{selectedProviderId:null},{searchPending:true}]) {
  await host('set',{...ready,...patch}); await host('clear');
  assert.equal(await btn('Buscar en Telegram').isDisabled(),true);
  assert.equal(await page.locator('[data-suggestion-id=t]').isDisabled(),true);
  await page.locator('form').evaluate(e=>e.requestSubmit());
  await save('[data-suggestion-id=t]','onClick','blocked'); await invoke('blocked'); assert.deepEqual(await calls(),[]);
 }
 pass('all search gates block disabled direct handlers and requestSubmit as well as normal controls');
 await host('set',ready); await host('clear');
 await page.getByRole('checkbox').nth(0).click(); await page.getByRole('checkbox').nth(1).click();
 await page.getByRole('combobox').selectOption('other');
 assert.deepEqual(await calls(),[['external',true],['botConsent',false],['provider','other']]);
 assert.equal(await page.getByRole('combobox').inputValue(),'bot');
 assert.equal(await page.getByRole('checkbox').nth(0).isChecked(),false);
 pass('consent/provider changes controlled and emit no search or automatic side effect');
 await host('clear');
 for(const [selector,event,slot] of [['form','onSubmit','oldSearch'],['[data-suggestion-id=t]','onClick','oldTrack'],['input[type=search]','onChange','oldQuery'],['input[type=checkbox]','onChange','oldConsent'],['select','onChange','oldProvider']]) await save(selector,event,slot);
 await host('revoke'); await host('fresh');
 for(const slot of ['oldSearch','oldTrack','oldQuery','oldConsent','oldProvider']) await invoke(slot);
 assert.deepEqual(await calls(),[]); await btn('Buscar en Telegram').click(); assert.deepEqual(await calls(),[['search']]);
 await host('clear'); await save('form','onSubmit','beforeDisable'); await host('set',{canSearch:false}); await invoke('beforeDisable'); assert.deepEqual(await calls(),[]);
 pass('actual old committed React callbacks stay retired after guard revocation, fresh render and gate changes');
 await host('set',{searchPending:true}); await host('clear'); await host('revoke');
 await btn('Cancelar consulta').click(); assert.deepEqual(await calls(),[['cancel']]);
 pass('pending cancellation remains available with revoked search authority');
 await host('set',{...ready,searchPending:false,suggestionsPending:false,suggestionsError:'Proveedor no disponible.',externalConsent:true}); await host('clear');
 await btn('Reintentar sugerencias').click(); assert.deepEqual(await calls(),[['retry']]);
 await host('set',{externalConsent:false}); assert.equal(await btn('Reintentar sugerencias').isDisabled(),true);
 pass('suggestion error visible; explicit retry requires external consent and never retries automatically');
 const results = [
 {id:'option',kind:'option',title:'Opción fixture',subtitle:'Artista',correlation:'recent',match:'conflict'},
 {id:'unknown',kind:'message',title:'Mensaje fixture',subtitle:null,correlation:'unknown',match:'unknown'},
 {id:'audio',kind:'audio',title:'Referencia fixture',subtitle:null,correlation:'reply',match:'compatible'},
 ];
 await host('set',{results,error:'No se confirmó la respuesta.',status:'Consulta detenida.',uncertain:true}); await host('clear');
 assert.ok(await page.getByText('Conflicto:',{exact:false}).isVisible());
 assert.ok(await page.getByText('Mensaje reciente;',{exact:false}).isVisible());
 assert.ok(await page.getByText('Resultado incierto:',{exact:false}).isVisible());
 await page.locator('[data-result-id=option] button').click(); assert.deepEqual(await calls(),[['result','option']]);
 assert.equal(await page.locator('[data-result-id=option] button').getAttribute('aria-pressed'),'false');
 await host('set',{selectedResultId:'option'});
 assert.ok(await page.getByText('Descarga y reproducción todavía no disponibles en este paso',{exact:true}).isVisible());
 assert.equal(await page.locator('audio,video,button button').count(),0);
 pass('recent/unknown/conflict/uncertain and failure visible; option click only local, controlled selection; no play/download');
 await host('set',{suggestions:[{...suggestions[0],title:'<img src=x onerror=alert(1)>'+ 'Largo'.repeat(70),subtitle:'Autor'.repeat(80)},suggestions[1],suggestions[2]],results:[{...results[0],title:'Título'.repeat(100),subtitle:'Autor'.repeat(100)}]});
 assert.equal(await page.locator('section img,section script').count(),0);
 report.layout=[];
 for(const [width,height,font] of [[320,568,100],[320,568,200],[568,320,200]]) {
  await page.setViewportSize({width,height}); await page.evaluate(font=>document.documentElement.style.fontSize=font+'%',font);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const target of await page.locator('section button,section input,section select').all()) {
   const box=await target.boundingBox(); assert.ok(box.height>=44 && box.width>=44,JSON.stringify(box));
   if(await target.isEnabled()) {await target.focus(); assert.ok(await target.evaluate(e=>{e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2); return b.left>=0 && b.right<=innerWidth && (hit===e || e.contains(hit));}));}
  }
  report.layout.push({width,height,fontPercent:font,horizontalOverflow:false,controlsAtLeast44:true});
 }
 await page.getByLabel('Canción, artista o álbum',{exact:true}).focus(); await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.type),'checkbox');
 assert.notEqual(await page.getByRole('checkbox').nth(0).evaluate(e=>getComputedStyle(e).outlineStyle),'none');
 pass('inert long labels wrap at 320 and 568x320 with 200% font; >=44px reachable controls, natural Tab and visible focus');
 await save('[data-result-id=option] button','onClick','oldResult'); await host('clear'); await host('unmount'); await invoke('oldResult'); assert.deepEqual(await calls(),[]);
 assert.deepEqual(await page.evaluate(()=>window.panelIO),[]); assert.deepEqual(report.errors,[]); assert.deepEqual(report.external,[]);
 pass('unmounted callback denied; zero instrumented IO, external attempts and page errors'); report.passed=true;
} catch(error) {report.failure={message:error.message,stack:error.stack}; process.exitCode=1;}
finally {
 await context?.close(); await browser?.close(); if(server) await new Promise(resolve=>server.httpServer.close(resolve));
 report.cleanup={contextClosed:!context||!context.pages().length,browserClosed:!browser||!browser.isConnected(),serverClosed:!server?.httpServer.listening};
 report.sources={}; for(const path of ['src/ui/MusicSearchPanel.tsx','src/ui/music-search.css','tests/integration/music-search-panel-r142-fixture.tsx','tests/integration/music-search-panel-r142.mjs']) {const data=await readFile(path); report.sources[path]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};}
 await writeFile(`${dir}/evidence.json`,JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,failure:report.failure}));
}
