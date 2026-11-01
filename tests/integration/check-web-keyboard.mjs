// Targeted keyboard activation of real controls. Own fixtures/context and frozen
// product baseline plus the current CSS, not VoiceOver or OS file-picker testing.
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const product=process.env.PULSO_QUALITY_PRODUCT==='1';
const report={passed:false,iphoneVerified:false,cases:[],environment:'Chromium Linux sandbox, temporary loopback, own context, frozen baseline + current CSS',limits:['Targeted controls are focused explicitly before keyboard activation; not a complete Tab-order audit','Files supplied through the automation file input; OS picker not tested','No VoiceOver, real zoom or physical iPhone evidence']};
let server,browser;
try{
 if(product)report.environment='Chromium Linux sandbox, temporary loopback, own context, current production build';
 server=await preview({configFile:false,build:{outDir:product?'dist':'.local/releases/quality-before'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await ctx.newPage(),errors=[],external=[];
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`,css=await readFile('src/style.css','utf8');
 await ctx.route(origin+'/keyboard-test.css',route=>route.fulfill({contentType:'text/css',body:css}));
 await ctx.addInitScript(()=>{
  window.keyboardAudio=[];const NativeAudio=Audio;window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.keyboardAudio.push(this);}};
  Object.defineProperty(navigator,'serviceWorker',{value:{controller:null,addEventListener(){},removeEventListener(){},getRegistration:async()=>undefined,register:async()=>{throw new Error('Synthetic unavailable worker for Blob keyboard test');}}});
 });
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('blob:'))external.push(r.url());});
 await page.goto(origin);if(!product)await page.addStyleTag({url:origin+'/keyboard-test.css'});
 await page.waitForFunction(()=>{const input=document.querySelector('input[aria-label="Importar audios"]');return input instanceof HTMLInputElement&&!input.disabled;});
 await page.getByLabel('Importar audios',{exact:true}).setInputFiles(['public/samples/Aurora.mp3','public/samples/Brisa.m4a','public/samples/Camino.mp3']);
 await page.getByRole('status').filter({hasText:'3 importadas'}).waitFor();
 const activate=async(locator,key='Enter')=>{await locator.focus();assert.equal(await locator.evaluate(el=>el===document.activeElement),true);await page.keyboard.press(key);};
 const player=page.getByRole('region',{name:'Reproductor',exact:true});
 await activate(page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}));await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 assert.equal(await page.evaluate(()=>window.keyboardAudio.length===1&&window.keyboardAudio[0].paused),true);
 await activate(player.getByRole('button',{name:'Reproducir',exact:true}));await page.waitForFunction(()=>!window.keyboardAudio[0].paused&&window.keyboardAudio[0].currentTime>0);
 await activate(player.getByRole('button',{name:'Pausar',exact:true}),'Space');assert.equal(await page.evaluate(()=>window.keyboardAudio[0].paused),true);
 report.cases.push({name:'Enter prepares a paused queue and plays; Space pauses the sole audio element',passed:true});
 const slider=player.getByLabel('Posición en segundos',{exact:true});await slider.focus();await page.keyboard.press('Home');const atZero=await page.evaluate(()=>window.keyboardAudio[0].currentTime);await page.keyboard.press('ArrowRight');await page.waitForFunction(value=>window.keyboardAudio[0].currentTime>value,atZero);
 assert.equal(await page.evaluate(()=>window.keyboardAudio[0].paused),true);
 const repeat=player.getByLabel('Repetición',{exact:false});await repeat.focus();await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await repeat.inputValue(),'all');
 await activate(player.getByRole('button',{name:'Aleatorio',exact:true}),'Space');assert.equal(await player.getByRole('button',{name:'Aleatorio',exact:true}).getAttribute('aria-pressed'),'true');await activate(player.getByRole('button',{name:'Aleatorio',exact:true}),'Space');
 report.cases.push({name:'Keyboard slider changes position without autoplay; repeat and shuffle update through native keyboard controls',passed:true});
 await activate(player.getByRole('button',{name:'Siguiente',exact:true}));await page.waitForFunction(()=>!window.keyboardAudio[0].paused);await activate(player.getByRole('button',{name:'Pausar',exact:true}),'Space');
 const selected=await player.locator('ol>li>button[aria-current=true]').textContent(),source=await page.evaluate(()=>window.keyboardAudio[0].src);
 const future=player.locator('ol>li').last();const futureName=await future.locator('button').first().textContent();
 // If the current is the last row, move the first future row downward instead.
 if(futureName!==selected)await activate(future.getByRole('button',{name:`Subir en cola ${futureName}`,exact:true}));
 else{const first=player.locator('ol>li').first(),name=await first.locator('button').first().textContent();await activate(first.getByRole('button',{name:`Bajar en cola ${name}`,exact:true}));}
 assert.equal(await player.locator('ol>li>button[aria-current=true]').textContent(),selected);assert.equal(await page.evaluate(()=>window.keyboardAudio[0].src),source);
 const removable=player.locator('ol>li').filter({has:page.locator('button[aria-current=true]')});assert.equal(await removable.count(),1);
 const remove=player.getByRole('button',{name:/^Quitar de cola /}).filter({visible:true});
 for(let i=0;i<await remove.count();i++)if(await remove.nth(i).isEnabled()){await activate(remove.nth(i));break;}
 assert.equal(await player.locator('ol>li').count(),2);assert.equal(await page.locator('.tracks>li').count(),3);assert.equal(await page.evaluate(()=>window.keyboardAudio[0].src),source);
 report.cases.push({name:'Keyboard next/reorder/remove preserves selected occurrence, source and all library tracks',passed:true});
 const lyrics=page.locator('.lyrics-panel');await activate(lyrics.locator('summary'));
 await lyrics.getByLabel('Texto del borrador',{exact:true}).fill('Letra propia <script>inerte</script>');
 await activate(lyrics.getByRole('button',{name:'Guardar letras',exact:true}));await lyrics.locator('.lyrics-text').filter({hasText:'Letra propia <script>inerte</script>'}).waitFor();assert.equal(await lyrics.locator('script').count(),0);assert.equal(await page.evaluate(()=>window.keyboardAudio[0].src),source);
 await activate(lyrics.locator('summary'),'Space');assert.equal(await lyrics.evaluate(el=>el.open),false);await activate(lyrics.locator('summary'));
 report.cases.push({name:'Keyboard opens/closes lyrics and saves inert plain text without changing audio source',passed:true});
 if(product){
 const row=page.locator('.tracks>li').first(),title=await row.locator('strong').textContent();
 assert.equal(await page.getByText(/^Editar metadatos de /).count(),0);
 assert.equal(await page.getByText('Editar portada',{exact:true}).count(),0);
 assert.equal(await page.locator('.artwork-panel input[type=file],.tracks input[name=title],.tracks input[name=artist],.tracks input[name=album]').count(),0);
 const favorite=row.getByRole('button',{name:'Favorito',exact:true});await activate(favorite);
 await row.getByRole('button',{name:'Quitar favorito',exact:true}).waitFor();
 assert.equal(await row.locator('strong').textContent(),title);assert.equal(await page.evaluate(()=>window.keyboardAudio[0].src),source);
 report.cases.push({name:'Song and artwork editors absent; keyboard favorite still organizes without changing song information or playback source',passed:true});
 }else{
 const row=page.locator('.tracks>li').first(),metadata=row.locator('details').filter({has:page.locator('summary').filter({hasText:/^Editar metadatos de /})});
 await activate(metadata.locator('summary'));await metadata.getByLabel('Título',{exact:true}).fill('Título propio editado con teclado');await activate(metadata.getByRole('button',{name:'Guardar metadatos',exact:true}));await row.locator('strong').filter({hasText:'Título propio editado con teclado'}).waitFor();assert.equal(await page.evaluate(()=>window.keyboardAudio[0].src),source);
 report.cases.push({name:'Keyboard metadata save preserves current playback source and library size',passed:true});
 }
 const org=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Exportar e importar organización$/})});await activate(org.locator('summary'));
 await activate(org.getByRole('button',{name:'Preparar exportación',exact:true}));const downloaded=page.waitForEvent('download');await activate(org.getByRole('link',{name:'Descargar organización',exact:true}));const backup=await readFile(await(await downloaded).path());
 await org.getByLabel('Importar organización',{exact:true}).setInputFiles({name:'own.json',mimeType:'application/json',buffer:backup});await org.getByRole('button',{name:'Aplicar organización',exact:true}).waitFor();await activate(org.getByRole('button',{name:'Aplicar organización',exact:true}));
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.startsWith('Confirma la restauración con las decisiones mostradas.')),true);
 await page.keyboard.press('Escape');await org.getByRole('button',{name:'Aplicar organización',exact:true}).waitFor();assert.equal(await org.getByRole('button',{name:'Confirmar restauración',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.keyboardAudio[0].src),source);
 report.cases.push({name:'Keyboard export/download works; restore confirmation receives focus and Escape cancels confirmation without applying',passed:true});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.pageErrors=0;report.externalRequests=0;report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));await mkdir('.local/evidence',{recursive:true});await writeFile(`.local/evidence/web-keyboard${product?'-product':''}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
