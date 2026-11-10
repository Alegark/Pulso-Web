import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const server=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','4177','--strictPort'],{stdio:'ignore'});
let browser;
try {
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4177/tests/integration/now-playing-organize.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 for(const size of [{width:320,height:700},{width:640,height:700}]){
  const page=await browser.newPage({viewport:size,reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:4177/tests/integration/now-playing-organize.html');
  if(size.width===640)await page.addStyleTag({content:'html { zoom: 2 }'});
  const add=page.getByRole('button',{name:'Añadir canción actual a Favoritos'});
  await add.focus();await page.keyboard.press('Enter');
  assert.equal(await add.isDisabled(),true);assert.equal(await add.getAttribute('aria-pressed'),'false');
  await page.getByRole('button',{name:'Simular error'}).click();assert.equal(await add.getAttribute('aria-pressed'),'false');assert.equal(await page.getByRole('status').last().innerText(),'No se pudo guardar');
  await add.click();await page.getByRole('button',{name:'Confirmar'}).click();
  const remove=page.getByRole('button',{name:'Quitar canción actual de Favoritos'});assert.equal(await remove.getAttribute('aria-pressed'),'true');
  assert.equal(await remove.locator('.np-favorite__check').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Cambiar pista'}).click();assert.equal(await page.getByRole('heading',{name:'b'}).isVisible(),true);
  await page.close();
 }
 const motion=await browser.newPage();await motion.goto('http://127.0.0.1:4177/tests/integration/now-playing-organize.html');
 await motion.getByRole('button',{name:'Añadir canción actual a Favoritos'}).click();
 await motion.getByRole('button',{name:'Confirmar'}).click();
 const check=motion.locator('.np-favorite__check');
 assert.equal(await check.evaluate(e=>getComputedStyle(e).transitionDuration),'0.2s, 0.2s');
 assert.ok(await check.evaluate(e=>e.getAnimations().some(a=>a.playState==='running')));
 await check.evaluate(async e=>Promise.all(e.getAnimations().map(a=>a.finished)));
 assert.equal(await check.evaluate(e=>getComputedStyle(e).opacity),'1');assert.equal(await motion.locator('.np-favorite__plus').evaluate(e=>getComputedStyle(e).opacity),'0');
 await motion.getByRole('button',{name:'Alternar reproductor'}).click();await motion.getByRole('button',{name:'Alternar reproductor'}).click();
 assert.equal(await check.evaluate(e=>e.getAnimations().length),0);await motion.close();
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4177/tests/integration/now-playing-organize.html');
 await page.evaluate(()=>{const b=document.querySelector('.np-favorite');const k=Object.keys(b).find(k=>k.startsWith('__reactProps$'));window.savedClick=b[k].onClick;});
 await page.evaluate(()=>{window.invalidateScope();window.savedClick();});
 assert.equal(await page.getByRole('button',{name:'Añadir canción actual a Favoritos'}).isEnabled(),true);
 console.log('PASS: favorito directo, pendiente, error, teclado, movimiento reducido y callback obsoleto');
} finally {await browser?.close();server.kill();}
