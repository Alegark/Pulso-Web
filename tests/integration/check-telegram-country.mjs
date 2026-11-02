// Production main, native DOM/locks/storage. Positive auth uses a replaced worker
// with synthetic replies; no SDK constructor or Telegram network is allowed.
import {chromium,webkit} from 'playwright-core';
import {spawn} from 'node:child_process';
import {cp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const root=resolve('.local/review/telegram-country-test'),art=resolve('.local/telegram-country-parent');
await mkdir(art,{recursive:true});await rm(root,{recursive:true,force:true});await cp('dist',root,{recursive:true});
const report={cases:[],errors:[],external:[],physicalIphone:false,realTelegramAuthentication:false,cleanup:false};let server,browser;
const waitReady=page=>page.getByRole('status').filter({hasText:'Biblioteca local. Puedes iniciar sesión en Telegram;'}).waitFor();
try{
 server=spawn('python3',['scripts/serve_review.py','--directory',root,'--port','0'],{stdio:['ignore','pipe','pipe']});
 const port=await new Promise((r,j)=>{server.once('error',j);server.stdout.on('data',d=>{const m=/loopback port (\d+)/.exec(String(d));if(m)r(Number(m[1]));});server.once('exit',()=>j(Error('server-exited')));});
 const origin=`http://127.0.0.1:${port}`;
 for(const engine of ['webkit','chromium']){
  browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const add=name=>report.cases.push({engine,version:browser.version(),name,passed:true});
  try{
   await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){report.external.push('blocked-http');return route.abort();}return route.continue();});
   await context.route('**/assets/session.worker-*.js',route=>route.fulfill({contentType:'text/javascript',body:`self.onmessage=e=>{const c=e.data;self.postMessage({version:1,session:c.session,request:c.request,phase:'code',error:null,retryAt:null,delivery:'app'});};`}));
   await context.addInitScript(()=>{
    Reflect.deleteProperty(Object.getPrototypeOf(navigator),'serviceWorker');
    globalThis.countryTest={commands:[],workers:0,audio:[],plays:0,csp:[],inlineStyleWrites:0};
    const nativeSetAttribute=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(name.toLowerCase()==='style')++countryTest.inlineStyleWrites;return nativeSetAttribute.call(this,name,value);};const W=Worker;globalThis.Worker=class extends W{constructor(url,options){super(url,options);this.auth=String(url).includes('session.worker-');if(this.auth)++countryTest.workers;}postMessage(value,...args){if(this.auth)countryTest.commands.push(value);return super.postMessage(value,...args);}};
    const A=Audio;globalThis.Audio=class extends A{constructor(...args){super(...args);countryTest.audio.push(this);}play(){++countryTest.plays;return super.play();}};
    addEventListener('securitypolicyviolation',e=>countryTest.csp.push({directive:e.violatedDirective,source:e.sourceFile,line:e.lineNumber,sample:e.sample,blocked:e.blockedURI}));
   });
   await context.route(origin+'/__native_csp_control',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'"},body:'<!doctype html><label>Country<select><option>Own</option></select></label><label>Phone<input type=tel autocomplete=tel-national></label><label>Consent<input type=checkbox></label>'}));const nativeControl=await context.newPage();await nativeControl.goto(origin+'/__native_csp_control');await nativeControl.getByLabel('Country').selectOption({label:'Own'});await nativeControl.getByLabel('Phone').fill('2025550100');await nativeControl.getByLabel('Consent').check();if(engine==='webkit')await nativeControl.waitForFunction(()=>countryTest.csp.some(e=>e.directive==='style-src-attr'),undefined,{timeout:5000});const nativeCsp=await nativeControl.evaluate(()=>countryTest.csp);await nativeControl.close();const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',()=>report.errors.push(engine));await page.goto(origin);await waitReady(page);
   const select=page.getByLabel('País y prefijo',{exact:true}),number=page.getByLabel('Número de teléfono',{exact:true}),consent=page.locator('.telegram-panel input[type=checkbox]'),send=page.getByRole('button',{name:'Enviar código de acceso',exact:true});
   assert.equal(await select.inputValue(),'');assert.equal(await select.locator('option').count(),246);assert.equal(await send.isDisabled(),true);
   assert.equal(await page.evaluate(()=>countryTest.workers),0);add('245 Spanish-labelled countries; no inferred selection or auth worker');
   await number.fill('612345678');await consent.check();assert.equal(await send.isDisabled(),true);await select.selectOption('ES');assert.equal(await send.isEnabled(),true);
   await consent.uncheck();assert.equal(await send.isDisabled(),true);await page.getByRole('status').filter({hasText:'Marca la autorización'}).waitFor();await consent.check();add('Country, national number and consent independently gate submission');
   for(const value of ['+58 4121234567','0034612345678','123ext4','1'.repeat(16)]){
    await number.fill(value);assert.equal(await send.isDisabled(),true);
    await number.evaluate(input=>input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   }
   assert.equal(await page.evaluate(()=>countryTest.workers),0);add('Mismatched prefix, exit prefix, extension and length fail closed even with direct submit');
   await number.fill('+34 612-345-678');await send.click();await page.getByLabel('Código de Telegram',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>countryTest.commands.at(-1)?.value),'+34612345678');await page.getByRole('button',{name:'Detener conexión local',exact:true}).click();add('Same-prefix international paste reaches synthetic worker with exactly one prefix');
   for(const [iso,value,expected] of [['VE','4121234567','+584121234567'],['CA','2025550100','+12025550100']]){
    await select.selectOption(iso);await number.fill(value);await consent.check();await send.click();await page.getByLabel('Código de Telegram',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>countryTest.commands.at(-1)?.value),expected);await page.getByRole('button',{name:'Detener conexión local',exact:true}).click();
   }
   assert.equal(await page.evaluate(()=>countryTest.audio.length===1&&countryTest.plays===0),true);const csp=await page.evaluate(()=>({events:countryTest.csp,inlineWrites:countryTest.inlineStyleWrites}));assert.equal(csp.inlineWrites,0);if(csp.events.length){assert.equal(engine,'webkit');assert.ok(nativeCsp.some(e=>e.directive==='style-src-attr'));assert.ok(csp.events.every(e=>e.directive==='style-src-attr'));}report.webkitNativeStyleReports??=[];if(engine==='webkit')report.webkitNativeStyleReports.push({nativeControl:nativeCsp,main:csp,interpretation:'Minimal native controls also report style-src-attr; policy unchanged, reports retained, no zero-CSP claim for WebKit.'});add('National +58/shared +1 compose correctly; native single Audio remains paused');
   await select.selectOption('ES');await number.fill('612345678');
   const layouts=[];
   for(const [width,height,font] of [[390,844,''],[320,568,''],[568,320,'200%'],[320,568,'200%']]){
    await page.setViewportSize({width,height});await page.evaluate(font=>{document.documentElement.style.fontSize=font;},font);
    const bounds=await page.evaluate(()=>{
     const row=document.querySelector('.telegram-phone-row'),items=[...row.querySelectorAll('select,input')].map(x=>{const r=x.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,width:r.width,height:r.height};});
     return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,items};
    });
    layouts.push({width,height,font:font||'default',...bounds});report.layoutObservations??=[];report.layoutObservations.push({engine,width,height,font:font||'default',...bounds});
    assert.ok(bounds.documentWidth<=width+1,JSON.stringify(bounds));assert.ok(bounds.items.every(x=>x.height>=44&&x.right<=width+1));
    if(width===390&&font==='')assert.ok(bounds.items[0].right<=bounds.items[1].left+1&&Math.min(bounds.items[0].top+bounds.items[0].height,bounds.items[1].top+bounds.items[1].height)>Math.max(bounds.items[0].top,bounds.items[1].top),'country and national fields must sit alongside with vertical overlap on a standard phone viewport');
   }
   add('Phone fields alongside; 320/390/landscape and enlarged text fit with 44px targets');report.cases.at(-1).layouts=layouts;
   await page.evaluate(()=>{document.documentElement.style.fontSize='';});await page.setViewportSize({width:390,height:844});await consent.check();await send.click();await page.getByLabel('Código de Telegram',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Ceder control',exact:true}).click();await select.waitFor();
   assert.equal(await select.inputValue(),'');assert.equal(await number.inputValue(),'');assert.equal(await consent.isChecked(),false);assert.equal(await send.isDisabled(),true);
   add('Native ownership loss cancels active synthetic auth and clears phone/country/consent');
  }finally{await context.close();}
  await browser.close();browser=null;
 }
 const notices=await readFile('dist/THIRD-PARTY-NOTICES.txt'),manifest=JSON.parse(await readFile('dist/third-party-licenses.json','utf8'));
 for(const entry of manifest.phoneCountryData.notices)assert.deepEqual(notices.subarray(entry.offset,entry.offset+entry.bytes),await readFile(entry.originalFile));
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);report.countryNoticesByteExact=true;report.passed=true;
}catch(e){report.failure=e.message;process.exitCode=1;}
finally{
 await browser?.close();if(server){server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}report.cleanup=true;
 await writeFile(resolve(art,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
