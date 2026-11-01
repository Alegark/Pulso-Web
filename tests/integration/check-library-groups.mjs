import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
let server,browser,page;
const report={passed:false,cases:[],iphoneVerified:false};
try{
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext();await context.addInitScript(()=>{window.pulsoGroups={audio:[]};const NativeAudio=window.Audio;window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.pulsoGroups.audio.push(this);}};});
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.name));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
 const files=await page.evaluate(async()=>{
  const raw=new Uint8Array(await(await fetch('/fixtures/A.mp3')).arrayBuffer()),text=s=>new TextEncoder().encode(s),sync=n=>new Uint8Array([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);
  const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length;}return b;};
  const offset=new TextDecoder().decode(raw.slice(0,3))==='ID3'?10+raw[6]*2097152+raw[7]*16384+raw[8]*128+raw[9]:0;
  const frame=(name,value)=>{const body=join(new Uint8Array([3]),text(value));return join(text(name),sync(body.length),new Uint8Array(2),body);};
  return [['Tema compartido','Artista A','Álbum común'],['Tema compartido','Artista B','Álbum común'],['Versión alternativa','Artista A','Álbum común'],['Sin etiquetas',null,null]].map(([title,artist,album])=>{
   const tag=join(frame('TIT2',title),...(artist?[frame('TPE1',artist)]:[]),...(album?[frame('TALB',album)]:[]));return [...join(text('ID3'),new Uint8Array([4,0,0]),sync(tag.length),tag,raw.slice(offset))];
  });
 });
 await page.waitForFunction(()=>{const i=document.querySelector('input[type=file]');return i instanceof HTMLInputElement&&!i.disabled;});
 await page.getByLabel('Importar audios',{exact:true}).setInputFiles(files.map((bytes,i)=>({name:`Propio-${i}.mp3`,mimeType:'audio/mpeg',buffer:Buffer.from(bytes)})));
 await page.getByRole('status').filter({hasText:'4 importadas, 0 ya existentes.'}).waitFor();assert.equal(await page.locator('.tracks>li').count(),4);
 await page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 const player=page.getByRole('region',{name:'Reproductor',exact:true});
 await player.getByLabel(/Repetición/).selectOption('one');await player.getByRole('button',{name:'Reproducir',exact:true}).click();await page.waitForFunction(()=>window.pulsoGroups.audio[0]?.currentTime>0&&!window.pulsoGroups.audio[0].paused);
 await page.evaluate(()=>{window.pulsoGroups.before={src:window.pulsoGroups.audio[0].src,queue:[...document.querySelectorAll('#player ol>li>button:first-child')].map(b=>b.textContent)};});
 const mode=page.getByLabel('Agrupación de biblioteca',{exact:true});await mode.selectOption('artists');
 await page.getByLabel('Grupo de artista',{exact:true}).selectOption({label:'Artista A · 2 pistas'});assert.equal(await page.locator('.tracks>li').count(),2);
 await mode.selectOption('albums');await page.getByLabel('Grupo de álbum',{exact:true}).selectOption({label:'Álbum común · Artista B · 1 pistas'});assert.equal(await page.locator('.tracks>li').count(),1);
 await page.getByText('Completitud desconocida.',{exact:false}).waitFor();
 const unchanged=await page.evaluate(()=>({oneEngine:window.pulsoGroups.audio.length===1,stillPlaying:!window.pulsoGroups.audio[0].paused,sameSource:window.pulsoGroups.audio[0].src===window.pulsoGroups.before.src,sameQueue:JSON.stringify([...document.querySelectorAll('#player ol>li>button:first-child')].map(b=>b.textContent))===JSON.stringify(window.pulsoGroups.before.queue)}));
 assert.deepEqual(unchanged,{oneEngine:true,stillPlaying:true,sameSource:true,sameQueue:true});await player.getByRole('button',{name:'Pausar',exact:true}).click();
 report.cases.push({name:'same-title variants remain distinct; artist/album navigation preserves playing engine and four-entry queue',passed:true});
 await page.getByLabel('Grupo de álbum',{exact:true}).selectOption({label:'Álbum común · Artista A · 2 pistas'});
 await page.getByLabel('Nueva playlist',{exact:true}).fill('Selección propia');await page.getByRole('button',{name:'Crear playlist',exact:true}).click();
 const rows=page.locator('.tracks>li');await rows.nth(0).getByRole('button',{name:'Añadir a playlist',exact:true}).click();
 const added=async index=>page.waitForFunction(index=>{const row=document.querySelectorAll('.tracks>li')[index];return row&&[...row.querySelectorAll('button')].find(b=>b.textContent==='Añadir a playlist')?.disabled;},index);
 await added(0);
 await rows.nth(1).getByRole('button',{name:'Añadir a playlist',exact:true}).click();
 await added(1);
 await page.getByLabel(/^Vista/).selectOption({label:'Selección propia'});assert.equal(await rows.count(),2);assert.equal(await player.locator('ol>li').count(),4);
 await page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('#player ol>li').length===2);assert.equal(await player.locator('ol>li').count(),2);
 report.cases.push({name:'playlist intersects album group; only explicit prepare replaces queue with two entries',passed:true});
 const second=rows.nth(1);await second.getByText('Editar metadatos de Versión alternativa',{exact:true}).click();const form=second.locator('form');await form.getByLabel('Álbum',{exact:true}).fill('Álbum manual');await form.getByRole('button',{name:'Guardar metadatos',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.tracks>li').length===1);assert.equal(await player.locator('ol>li').count(),2);
 await page.getByLabel('Grupo de álbum',{exact:true}).selectOption({label:'Álbum manual · Artista A · 1 pistas'});await page.getByText(/Datos:.*correcciones manuales/).waitFor();
 const changed=rows.first();await changed.getByText('Editar metadatos de Versión alternativa',{exact:true}).click();await changed.locator('form').getByLabel('Álbum',{exact:true}).fill('');await changed.getByRole('button',{name:'Guardar metadatos',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.tracks>li').length===2);assert.equal(await page.getByLabel('Grupo de álbum',{exact:true}).inputValue(),'');assert.equal(await player.locator('ol>li').count(),2);
 report.cases.push({name:'manual metadata recomputes groups; disappearing selection resets without altering queue',passed:true});
 await page.getByLabel('Buscar por título, artista o álbum',{exact:true}).fill('versión');assert.equal(await rows.count(),1);assert.equal(await rows.first().getByRole('button',{name:'Subir Versión alternativa',exact:true}).isDisabled(),true);
 assert.equal(await page.getByLabel('Importar audios',{exact:true}).isDisabled(),false);
 await page.reload();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();assert.equal(await rows.count(),4);assert.equal(await player.locator('ol>li').count(),2);assert.equal(await page.evaluate(()=>window.pulsoGroups.audio.length===1&&window.pulsoGroups.audio[0].paused),true);assert.deepEqual(errors,[]);
 report.cases.push({name:'filtered playlist reorder guarded; import remains available; reopen preserves organization and paused queue',passed:true});
 report.passed=true;
}catch(error){report.failure={error:error.message,status:page&&!page.isClosed()?await page.getByRole('status').allTextContents():[]};throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));console.log(JSON.stringify(report));}
