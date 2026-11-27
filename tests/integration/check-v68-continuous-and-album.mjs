// Partial U-V68-01 coverage only. U-V68-02, U-V68-03 and U-V68-04 remain untested here.
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';

const ws=await createTestWorkspace('v68-continuous-album');let server;const cases=[];
try{
 await writeFile(`${ws.dir}/seed.html`,'<script type="module" src="/tests/integration/v68-continuous-fixture.ts"></script>');
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:`${ws.dir}/bundle`,rolldownOptions:{input:{main:'index.html',seed:`${ws.dir}/seed.html`}}}});
 server=await preview({configFile:false,build:{outDir:`${ws.dir}/bundle`},preview:{host:'127.0.0.1',port:0}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await launcher.launch(engine==='chromium'?{headless:true,executablePath:'/usr/bin/chromium'}:{headless:true});
  try{for(const entry of ['Inicio','Biblioteca','offline']){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
   try{
    await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))return r.continue();
     if(u.hostname==='itunes.apple.com'&&entry!=='offline'){
      const album={wrapperType:'collection',collectionType:'Album',collectionId:201,collectionName:'Álbum sintético',artistName:'Artista sintético',trackCount:3};
      const tracks=[0,1,2].map(i=>({wrapperType:'track',kind:'song',collectionId:201,collectionName:'Álbum sintético',artistName:'Artista sintético',trackId:301+i,discNumber:1,discCount:1,trackNumber:i+1,trackCount:3,trackName:`Sintética ${i}`,trackTimeMillis:30000}));
      const rows=u.pathname==='/lookup'?[album,...tracks]:[];return r.fulfill({json:{resultCount:rows.length,results:rows},headers:{'access-control-allow-origin':'*'}});
     }return r.abort();});
    await installRequiredAccountFixture(context,origin);await context.addInitScript(()=>{delete Navigator.prototype.serviceWorker;});
    const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(`${origin}/${ws.dir}/seed.html`);await page.waitForFunction(()=>!!window.setupV68SyncedAlbum);await page.evaluate(()=>window.setupV68SyncedAlbum());await page.goto(origin);
    if(entry!=='Inicio')await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
    const card=page.locator(entry==='Inicio'?'.home-albums button':'.library-grid button').filter({hasText:'Álbum sintético'});await card.click();
    assert.equal(await page.getByRole('button',{name:'Ver álbum completo'}).count(),0);
    if(entry==='offline'){await page.getByRole('button',{name:'Ver pistas locales'}).click();await page.getByText('Sintética 0',{exact:true}).first().waitFor();}
    else{await page.locator('.album-page').waitFor();await page.locator('.album-page').getByRole('button',{name:'Opciones del álbum'}).click();await page.getByRole('button',{name:'Retirar álbum',exact:true}).waitFor();}
    cases.push(`${engine}: ${entry}`);
   }finally{await context.close();}
  }}finally{await browser.close();}
 }
 console.log('PASS',cases.length,cases.join('; '));
}catch(error){console.error('FAIL',error.stack||error);process.exitCode=1;}
finally{if(server)await new Promise(r=>server.httpServer.close(r));await ws.cleanup();}
