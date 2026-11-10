import {chromium,webkit} from 'playwright-core';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {mkdir,readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {createServer} from 'node:http';

if(!process.argv.includes('--skip-build'))execFileSync(process.execPath,['design/scripts/build-app-demo.mjs']);
const base=resolve('.local/design-desktop');await mkdir(base,{recursive:true});
if(process.argv.includes('--serve')){
  const server=createServer(async(req,res)=>{if(new URL(req.url,'http://localhost').pathname!=='/app.html'){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end(await readFile('design/prototypes/app-demo.html'));});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}/app.html`,kind:'standalone design only; no main/SDK/storage'}));const close=()=>server.close(()=>process.exit(0));process.on('SIGTERM',close);process.on('SIGINT',close);await new Promise(()=>{});
}
const url=pathToFileURL(resolve('design/prototypes/app-demo.html')).href;
const report={scope:'desktop design in Linux browsers, fictional data and one original tone; no normal product build/real account/iPhone',sha256:createHash('sha256').update(await readFile('design/prototypes/app-demo.html')).digest('hex'),engines:[],cases:[],errors:[],external:[],cleanup:false};
const assert=(value,message)=>{if(!value)throw Error(message);};
async function check(engine,name,fn){try{await fn();report.cases.push({engine,name,pass:true});}catch(error){report.cases.push({engine,name,pass:false,error:String(error)});console.log(`FAIL ${engine} ${name}: ${error}`);}}
for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await launcher.launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true}:{headless:true});
 try{
  report.engines.push({engine,version:browser.version()});const context=await browser.newContext({viewport:{width:1366,height:768}});const page=await context.newPage();page.setDefaultTimeout(6000);
  page.on('pageerror',error=>report.errors.push({engine,error:String(error)}));page.on('request',r=>{if(/^https?:/.test(r.url()))report.external.push(r.url());});
  await context.addInitScript(()=>{window.desktopPlayback={elements:[],starts:0};const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.desktopPlayback.starts++;if(!window.desktopPlayback.elements.includes(this))window.desktopPlayback.elements.push(this);return play.call(this);};});
  const nav=name=>page.locator('.music-nav:visible').getByRole('button',{name,exact:true});
  const fits=async(label)=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}: horizontal overflow`);
  for(const [width,height] of [[1024,768],[1280,800],[1366,768],[1440,900],[1920,1080]])for(const theme of ['light','dark']){
   await check(engine,`${width}x${height} ${theme}, screens and dock`,async()=>{
    await page.setViewportSize({width,height});await page.goto(url);if(theme==='dark')await page.getByRole('button',{name:'Activar tema oscuro'}).click();await page.locator('.desktop-player').waitFor();await fits('home');
    assert(!await page.locator('.mini-player').isVisible(),'mobile mini visible on desktop');
    // A stable scrollbar gutter can reserve width even while clientWidth still
    // includes it. Compare against the root's actual CSS layout box.
    const metrics=await page.locator('.music-dock').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,layoutWidth:document.documentElement.getBoundingClientRect().width,viewportWidth:innerWidth,viewportHeight:innerHeight};}),dock=metrics;
    assert(metrics.viewportWidth===width&&metrics.viewportHeight===height&&dock.x===0&&Math.abs(dock.width-metrics.layoutWidth)<=1&&Math.abs(dock.y+dock.height-height)<=1,'dock does not span layout viewport: '+JSON.stringify(metrics));
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));const sidebar=await page.locator('.music-sidebar').boundingBox();assert(sidebar.y>=0&&sidebar.y+sidebar.height<=dock.y,'sidebar lost during scroll');
    await nav('Biblioteca').click();await fits('library');await page.locator('#playlist-favoritos').click();await fits('Favorites');await page.getByRole('button',{name:'Volver',exact:true}).click();await page.locator('#album-orbita').click();await fits('album');await page.getByRole('button',{name:'Luna Norte ↗'}).click();await fits('artist');
    await page.getByRole('button',{name:'Abrir reproductor completo',exact:true}).click();await page.locator('.player-surface').waitFor();assert(await page.locator('.player-surface').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'expanded desktop overflow');const art=await page.locator('.expanded-art .cover').boundingBox();assert(Math.abs(art.width-art.height)<1,'art distortion');await page.getByRole('button',{name:'Cerrar reproductor'}).click();assert(await page.locator('.desktop-player__details').evaluate(el=>el===document.activeElement),'dock focus not restored');
   });
  }
  await page.setViewportSize({width:1366,height:768});
  await check(engine,'desktop controls and direct lyrics/queue preserve the audio',async()=>{
   await page.goto(url);await page.getByRole('button',{name:'Reproducir desde barra',exact:true}).click();await page.waitForFunction(()=>window.desktopPlayback.elements[0]?.currentTime>.1);
   const before=await page.evaluate(()=>({starts:window.desktopPlayback.starts,src:window.desktopPlayback.elements[0].src,time:window.desktopPlayback.elements[0].currentTime}));await nav('Biblioteca').click();await page.getByRole('button',{name:'Abrir letra desde barra'}).click();await page.locator('.lyrics-full').waitFor();
   assert(await page.evaluate(()=>window.desktopPlayback.starts)===before.starts,'opening lyrics restarted audio');await page.getByRole('button',{name:'Cerrar reproductor'}).click();assert(await page.getByRole('button',{name:'Abrir letra desde barra'}).evaluate(el=>el===document.activeElement),'direct lyrics focus');
   await page.getByRole('button',{name:'Abrir cola desde barra'}).click();await page.locator('.now-playing__queue').waitFor();await page.getByRole('button',{name:'Cerrar reproductor'}).click();
   await page.getByRole('button',{name:'Pausar desde barra',exact:true}).click();assert(await page.evaluate(()=>window.desktopPlayback.elements[0].paused),'pause failed');await page.getByRole('button',{name:'Silenciar muestra'}).click();await page.waitForFunction(()=>window.desktopPlayback.elements[0].volume===0);await page.getByRole('button',{name:'Activar sonido de muestra'}).click();await page.waitForFunction(()=>Math.abs(window.desktopPlayback.elements[0].volume-.35)<.001);
   await page.getByLabel('Volumen de la muestra',{exact:true}).focus();await page.keyboard.press('Home');await page.waitForFunction(()=>window.desktopPlayback.elements[0].volume===0);await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>window.desktopPlayback.elements[0].volume>0);
   const customVolume=await page.evaluate(()=>window.desktopPlayback.elements[0].volume);await page.getByRole('button',{name:'Silenciar muestra'}).click();await page.getByRole('button',{name:'Activar sonido de muestra'}).click();assert(await page.evaluate(()=>window.desktopPlayback.elements[0].volume).then(value=>Math.abs(value-customVolume)<.001),'unmute lost custom volume');
   await page.getByLabel('Posición desde barra de escritorio').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');assert(await page.evaluate(()=>window.desktopPlayback.elements[0].currentTime)<.3,'seek did not move media');
   assert(await page.evaluate(()=>window.desktopPlayback.elements.length)===1,'audio recreated');assert(await page.evaluate(()=>window.desktopPlayback.elements[0].src)===before.src,'source replaced');
  });
  await check(engine,'desktop search submits without starting playback',async()=>{
   await page.goto(url);await page.getByLabel('Buscar música en la muestra').fill('Luna');await page.locator('.desktop-search').getByRole('button',{name:'Buscar',exact:true}).click();await page.getByText('Resultados para «Luna»',{exact:true}).waitFor();assert(await page.locator('.song-list li').count()===5,'desktop query not submitted');assert(await page.evaluate(()=>window.desktopPlayback.starts)===0,'search played media');
  });
  await check(engine,'text 200%, short windows and breakpoints keep controls reachable',async()=>{
   await page.goto(url);await page.evaluate(()=>document.documentElement.style.fontSize='200%');await fits('200%');await nav('Biblioteca').click();await fits('200% library');await page.getByRole('button',{name:'Abrir reproductor completo',exact:true}).click();await fits('200% player');await page.getByRole('button',{name:'Cerrar reproductor'}).click();
   await page.setViewportSize({width:1280,height:400});assert(await page.locator('.music-dock').evaluate(el=>getComputedStyle(el).position)==='static','short window dock blocks content');await fits('short desktop');
   await page.setViewportSize({width:1023,height:768});await fits('tablet');assert(!await page.locator('.desktop-player').isVisible(),'desktop controls leaked into tablet');await page.setViewportSize({width:390,height:664});assert(await page.locator('.mini-player').isVisible(),'mobile mini missing');await fits('mobile after resize');
  });
  await check(engine,'resizing an active player restores focus to a visible control',async()=>{
   await page.setViewportSize({width:390,height:664});await page.goto(url);await page.locator('.mini-player__expand').click();await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Cerrar reproductor'}).click();assert(await page.locator('.desktop-player__details').evaluate(el=>el===document.activeElement),'focus left on hidden mobile control');await page.setViewportSize({width:1366,height:768});
  });
  await check(engine,'desktop screenshots captured',async()=>{
   await page.setViewportSize({width:1440,height:900});await page.goto(url);await page.screenshot({path:resolve(base,`${engine}-home.png`)});await nav('Biblioteca').click();await page.screenshot({path:resolve(base,`${engine}-library.png`)});await page.getByRole('button',{name:'Abrir reproductor completo',exact:true}).click();await page.screenshot({path:resolve(base,`${engine}-player.png`)});await page.getByRole('button',{name:'Cerrar reproductor'}).click();
  });
  await check(engine,'scaled preview preserves the actual desktop viewport',async()=>{
   await page.setViewportSize({width:728,height:600});await page.goto(pathToFileURL(resolve('design/prototypes/desktop-preview.html')).href);const frame=page.frameLocator('iframe');await frame.locator('.desktop-player').waitFor();assert(await frame.locator('body').evaluate(()=>innerWidth)===1366,'preview is a stretched mobile layout');
   // Chromium's locator coordinates omit the parent iframe transform. Use a real
   // pointer at the rendered location, computed from local rect and frame scale.
   const outer=await page.locator('iframe').boundingBox(),local=await frame.locator('.desktop-player__details').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}),scale=outer.width/1366;
   await page.mouse.click(outer.x+(local.x+local.width/2)*scale,outer.y+(local.y+local.height/2)*scale);await frame.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor();
  });
  await context.close();
 }finally{await browser.close();}
}
report.cleanup=true;await writeFile(resolve(base,'report.json'),JSON.stringify(report,null,2));const failures=report.cases.filter(c=>!c.pass);console.log(JSON.stringify({pass:report.cases.length-failures.length,total:report.cases.length,errors:report.errors,external:report.external,cleanup:report.cleanup}));if(failures.length||report.errors.length||report.external.length)process.exitCode=1;
