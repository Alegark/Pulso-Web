import {build,preview} from 'vite';import {chromium,webkit} from 'playwright-core';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {createTestWorkspace} from './test-workspace.mjs';
const ws=await createTestWorkspace('mobile-install'),report={cases:[],errors:[]};let server;
try{await writeFile(`${ws.dir}/fixture.html`,'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/integration/mobile-install-fixture.tsx"></script>');await build({configFile:false,logLevel:'error',build:{outDir:`${ws.dir}/bundle`,rolldownOptions:{input:`${ws.dir}/fixture.html`}}});server=await preview({configFile:false,build:{outDir:`${ws.dir}/bundle`},preview:{host:'127.0.0.1',port:0}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
for(const [engine,launcher]of [['chromium',chromium],['webkit',webkit]]){const browser=await launcher.launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true}:{headless:true});try{for(const mode of ['desktop','iphone-tab','android-tab','iphone-installed','android-installed','denied','defer','iphone-update']){const iphone=mode.startsWith('iphone'),installed=mode==='iphone-update'||mode.includes('installed')||['denied','defer'].includes(mode),context=await browser.newContext({viewport:{width:390,height:844},userAgent:mode==='desktop'?'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0':iphone?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1':'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36'});try{await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await context.addInitScript(({installed,mode})=>{window.__permissionCalls=0;window.__noticeCount=0;window.__workerReady=mode!=='iphone-update';window.__permission=sessionStorage.getItem('TESTONLY-permission')??(mode==='denied'?'denied':'default');Object.defineProperty(navigator,'standalone',{value:installed});Object.defineProperty(window,'Notification',{configurable:true,value:{get permission(){return window.__permission},requestPermission:async()=>{window.__permissionCalls++;window.__permission='granted';sessionStorage.setItem('TESTONLY-permission','granted');return 'granted';}}});if(!('showNotification'in ServiceWorkerRegistration.prototype))ServiceWorkerRegistration.prototype.showNotification=()=>Promise.resolve();navigator.serviceWorker.getRegistration=async()=>({active:window.__workerReady?{}:null,showNotification:async()=>{window.__noticeCount++;},getNotifications:async()=>[]});},{installed,mode});const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(String(e)));await page.goto(`${origin}/${ws.dir}/fixture.html`);await page.getByRole('heading',{name:'Pulso de prueba'}).waitFor();assert.equal(await page.evaluate(()=>window.__permissionCalls),0);
if(mode==='iphone-update'){
 const settings=page.getByRole('region',{name:'Notificaciones de descargas'});
 const status=(value)=>settings.getByText(value,{exact:true});
 const flags=()=>page.evaluate(()=>({preference:localStorage.getItem('pulso:download-notifications:v1'),permission:window.__permission,calls:window.__permissionCalls,shown:window.__noticeCount}));
 const active='Avisos activados.',waiting='Preferencia guardada. Pulso espera a que el servicio de avisos esté disponible.';
 await settings.getByRole('button',{name:'Activar avisos de descargas'}).click();
 await status(waiting).waitFor();
 assert.deepEqual(await flags(),{preference:'enabled',permission:'granted',calls:1,shown:0});
 await page.reload();
 await status(waiting).waitFor();
 await page.goto(page.url()+'?release=test-new');
 await status(waiting).waitFor();
 assert.deepEqual(await flags(),{preference:'enabled',permission:'granted',calls:0,shown:0});
 await page.evaluate(()=>{window.__workerReady=true;navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));});
 await status(active).waitFor();
 await settings.getByRole('button',{name:'Enviar aviso de prueba'}).click();
 await page.waitForFunction(()=>window.__noticeCount===1);
 await page.evaluate(()=>{window.__permission='denied';document.dispatchEvent(new Event('visibilitychange'));});
 await settings.getByText(/El sistema tiene bloqueado el permiso/).waitFor();
 assert.equal(await settings.getByRole('button',{name:'Enviar aviso de prueba'}).count(),0);
 assert.equal((await flags()).preference,'enabled');
 await page.evaluate(()=>{window.__permission='default';window.dispatchEvent(new Event('pageshow'));});
 await settings.getByRole('button',{name:'Volver a permitir avisos'}).waitFor();
 assert.equal((await flags()).calls,0);
 await page.evaluate(()=>{window.__permission='granted';window.dispatchEvent(new Event('focus'));});
 await status(active).waitFor();
 await settings.getByRole('button',{name:'Desactivar avisos en Pulso'}).click();
 await status('Avisos desactivados en Pulso.').waitFor();
 await page.reload();
 await status('Avisos desactivados en Pulso.').waitFor();
 assert.deepEqual(await flags(),{preference:'disabled',permission:'granted',calls:0,shown:0});
 await settings.getByRole('button',{name:'Activar avisos de descargas'}).click();
 assert.deepEqual(await flags(),{preference:'enabled',permission:'granted',calls:0,shown:0});
}
else if(mode==='desktop'||mode==='denied'){await page.waitForTimeout(100);assert.equal(await page.locator('.mobile-install-banner,.mobile-notification-invite').count(),0);}else if(!installed){await page.getByRole('button',{name:/Instala Pulso/}).click();const dialog=page.locator('dialog[open]');await dialog.waitFor();await dialog.getByText(iphone?'Safari':'Chrome',{exact:true}).waitFor();await page.setViewportSize({width:320,height:568});await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.ok(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth));await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');if(mode==='android-tab'){await page.evaluate(()=>{window.__installCalls=0;const event=new Event('beforeinstallprompt');event.prompt=async()=>{window.__installCalls++;};event.userChoice=Promise.resolve({outcome:'accepted'});dispatchEvent(event);});await page.getByRole('button',{name:/Instala Pulso/}).click();await page.getByRole('button',{name:'Instalar ahora'}).click();assert.equal(await page.evaluate(()=>window.__installCalls),1);await page.evaluate(()=>dispatchEvent(new Event('appinstalled')));await page.getByRole('button',{name:'Activar notificaciones'}).waitFor();assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('.mobile-install-banner').count(),0);}}
else{const invitation=page.locator('.mobile-notification-invite');await invitation.waitFor();assert.equal(await page.locator('.mobile-install-banner').count(),0);if(mode==='defer'){await page.getByRole('button',{name:'Ahora no'}).click();assert.equal(await page.evaluate(()=>window.__permissionCalls),0);}else{await page.getByRole('button',{name:'Activar notificaciones'}).click();await invitation.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__permissionCalls),1);}await page.reload();await page.getByRole('heading',{name:'Pulso de prueba'}).waitFor();assert.equal(await page.locator('.mobile-notification-invite').count(),0);}
report.cases.push(`${engine}: ${mode}`);
}finally{await context.close();}}}finally{await browser.close();}}assert.deepEqual(report.errors,[]);report.status='PASS';}catch(e){report.status='FAIL';report.error=String(e.stack||e);}finally{if(server)await new Promise(r=>server.httpServer.close(r));report.cleanup=await ws.cleanup();await writeFile(`${ws.evidence}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({evidence:ws.evidence,...report},null,2));if(report.status!=='PASS')process.exitCode=1;}
