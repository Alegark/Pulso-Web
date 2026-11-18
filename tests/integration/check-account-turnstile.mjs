import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {registerHooks} from 'node:module';
import {extname,resolve} from 'node:path';
import {chromium,webkit} from 'playwright-core';

// Exercise the production Worker's document headers without a Cloudflare account.
const hook=registerHooks({resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject {}',shortCircuit:true};
 return next(specifier,context);
}});
const {default:worker}=await import('../../deployment/cloudflare/worker.mjs');
hook.deregister();

const site=resolve('dist');
const siteKey='1x00000000000000000000AA';
const challengeOrigin='https://challenges.cloudflare.com';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json'};
const env={ASSETS:{async fetch(request){
 const path=new URL(request.url).pathname;
 const file=resolve(site,path==='/'?'index.html':'.'+path);
 if(!file.startsWith(site+'/'))return new Response(null,{status:404});
 try{return new Response(await readFile(file),{headers:{'Content-Type':mime[extname(file)]??'application/octet-stream'}});}
 catch{return new Response(null,{status:404});}
}}};
const server=createServer(async(req,res)=>{
 try{
  const request=new Request(new URL(req.url,'http://'+req.headers.host),{method:req.method,headers:req.headers});
  const response=await worker.fetch(request,{...env,PULSO_TURNSTILE_SITE_KEY:siteKey,PULSO_TURNSTILE_SECRET:'1x0000000000000000000000000000000AA'});
  res.writeHead(response.status,Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const account={id:'test-user',name:'Persona sintética',email:'own@example.test',emailVerified:false};
const widgetScript=`
 let serial=0;
 const widgets=new Map();
 window.turnstile={
  ready(callback){callback();},
  render(container,options){
   if(options.size!=='compact'||options.language!=='es'||options.sitekey!=='1x00000000000000000000AA')throw Error('Opciones del widget');
   const frame=document.createElement('iframe');
   frame.width='150';
   frame.height='140';
   frame.title='Verificación simulada';
   frame.src='${challengeOrigin}/fixture';
   container.append(frame);
   const id=String(++serial);
   widgets.set(id,{frame,options,resets:0});
   frame.addEventListener('load',()=>options.callback('fake-'+options.action+'-'+id+'-0'));
   return id;
  },
  reset(id){
   const widget=widgets.get(id);
   widget.options.callback('fake-'+widget.options.action+'-'+id+'-'+(++widget.resets));
  },
  remove(id){widgets.get(id).frame.remove();widgets.delete(id);}
 };
`;

try{
 const [disabled,pilot,enabled]=await Promise.all([
  worker.fetch(new Request(origin),env),
  fetch(origin+'/pilot.html'),
  fetch(origin),
 ]);
 const matches=response=>response.headers.get('Content-Security-Policy').includes(challengeOrigin);
 assert.equal(matches(disabled),false);
 assert.equal(matches(pilot),false);
 assert.equal(matches(enabled),true);
 assert.match(enabled.headers.get('Content-Security-Policy'),/frame-src https:\/\/challenges\.cloudflare\.com/);
 await Promise.all([disabled,pilot,enabled].map(response=>response.body?.cancel()));

 for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch({headless:true,...(name==='Chromium'?{executablePath:'/usr/bin/chromium',chromiumSandbox:true}:{})});
  try{
   for(const active of [false,true]){
    const context=await browser.newContext({viewport:{width:320,height:680},serviceWorkers:'block'});
    context.setDefaultTimeout(8000);
    const calls=[],external=[],errors=[];
    let scriptLoads=0,frames=0,signupAttempts=0;
    try{
     await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin===challengeOrigin&&url.pathname==='/turnstile/v0/api.js'){
       scriptLoads++;
       return route.fulfill({contentType:'text/javascript',body:widgetScript});
      }
      if(url.origin===challengeOrigin&&url.pathname==='/fixture'){
       frames++;
       return route.fulfill({contentType:'text/html',body:'<title>Verificación sintética</title>'});
      }
      if(url.origin!==origin){external.push(url.origin);return route.abort();}
      if(url.pathname==='/account-config.json')return route.fulfill({json:{version:1,enabled:true,google:false,...(active?{turnstileSiteKey:siteKey}:{})}});
      if(!url.pathname.startsWith('/api/account-auth/'))return route.continue();
      const operation=url.pathname.slice('/api/account-auth/'.length);
      const token=request.headers()['x-pulso-turnstile'];
      calls.push({operation,token});
      switch(operation){
       case 'get-session':return route.fulfill({json:null});
       case 'sign-in/email':return route.fulfill({status:429,headers:{'Retry-After':'60'},json:{code:'RATE_LIMITED'}});
       case 'sign-up/email':return active&&signupAttempts++===0
        ?route.fulfill({status:400,json:{code:'TURNSTILE_INVALID'}})
        :route.fulfill({json:{token:null,user:account}});
       case 'email-otp/send-verification-otp':
       case 'email-otp/request-password-reset':return route.fulfill({json:{status:true}});
       default:return route.fulfill({status:404,json:{}});
      }
     });
     const page=await context.newPage();
     page.on('pageerror',error=>errors.push(error.message));
     await page.clock.install();
     await page.goto(origin);
     const dialog=page.getByRole('dialog');
     const button=name=>dialog.getByRole('button',{name,exact:true});
     const link=name=>dialog.getByRole('link',{name,exact:true});
     const email=()=>dialog.getByLabel('Correo electrónico',{exact:true}).fill(account.email);
     const password=()=>dialog.getByLabel('Contraseña',{exact:true}).fill('TESTONLY-password');
     await dialog.getByRole('heading',{name:'Iniciar sesión',exact:true}).waitFor();
     await email();
     await password();
     await button('Iniciar sesión').click();
     await dialog.getByRole('alert').filter({hasText:'Demasiados intentos'}).first().waitFor();
     assert.equal(scriptLoads,0);
     assert.equal(calls.find(call=>call.operation==='sign-in/email').token,undefined);

     await page.reload();
     await link('Crear cuenta').click();
     const fillSignup=async()=>{
      await dialog.getByLabel('Tu nombre').fill(account.name);
      await email();
      await password();
      await dialog.getByLabel('Confirmar contraseña',{exact:true}).fill('TESTONLY-password');
     };
     await fillSignup();
     if(active){
      await dialog.locator('iframe[title="Verificación simulada"]').waitFor();
      assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
     }
     await button('Crear cuenta').click();
     if(active){
      await dialog.getByRole('alert').filter({hasText:'La verificación de seguridad ya no es válida'}).first().waitFor();
      await fillSignup();
      await button('Crear cuenta').click();
     }
     await dialog.getByLabel('Código',{exact:true}).waitFor();
     assert.equal(await dialog.locator('iframe[title="Verificación simulada"]').count(),0);
     await page.clock.runFor(61000);
     await button('Reenviar').click();
     await dialog.getByRole('status').filter({hasText:/código enviado/i}).first().waitFor();

     await link('Iniciar sesión').click();
     await link('¿Olvidaste tu contraseña?').click();
     await email();
     await button('Enviar código').click();
     await dialog.getByLabel('Código de recuperación',{exact:true}).waitFor();

     const signup=calls.filter(call=>call.operation==='sign-up/email').map(call=>call.token);
     const tokenFor=operation=>calls.find(call=>call.operation===operation)?.token;
     if(active){
      assert.equal(scriptLoads,1);
      assert.ok(frames>=3);
      assert.match(signup[0],/^fake-sign-up-\d+-0$/);
      assert.equal(signup[1],signup[0].replace(/-0$/,'-1'));
      assert.match(tokenFor('email-otp/send-verification-otp'),/^fake-verify-email-/);
      assert.match(tokenFor('email-otp/request-password-reset'),/^fake-password-reset-/);
     }else{
      assert.equal(scriptLoads,0);
      assert.equal(frames,0);
      assert.ok(calls.every(call=>call.token===undefined));
     }
     assert.deepEqual(errors,[]);
     assert.deepEqual(external,[]);
     console.log(`PASS ${name} 320 px · Turnstile ${active?'activado y simulado':'desactivado'}`);
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
}finally{await new Promise(done=>server.close(done));}
