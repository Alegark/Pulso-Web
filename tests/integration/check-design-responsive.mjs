import {build} from 'vite';
import {chromium,webkit,devices} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';

const base=resolve('.local/design-responsive'),out=resolve(base,'build');
await mkdir(base,{recursive:true});
const files=['src/ui/PlayerSurface.tsx','src/ui/MiniPlayer.tsx','src/ui/design-tokens.css','src/ui/responsive-shell.css','design/scripts/build-mobile.mjs','design/prototypes/player-mobile.html','design/prototypes/player-phone.html','tests/integration/design-responsive.html','tests/integration/design-responsive.tsx'];
const hashes={};for(const path of files)hashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
await build({configFile:false,logLevel:'error',build:{outDir:out,emptyOutDir:true,rolldownOptions:{input:'tests/integration/design-responsive.html'}}});
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    let file=path==='/prototype-mobile.html'?resolve('design/prototypes/player-mobile.html'):path==='/prototype-phone.html'?resolve('design/prototypes/player-phone.html'):path==='/prototype-directions.html'?resolve('design/prototypes/player-directions.html'):resolve(out,'.'+path);
    if(!file.startsWith(out+sep)&&!['/prototype-mobile.html','/prototype-phone.html','/prototype-directions.html'].includes(path))throw Error('path');
    const data=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4'}[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')){
  console.log(JSON.stringify({origin,fixture:origin+'/tests/integration/design-responsive.html',mobile:origin+'/prototype-mobile.html',phone:origin+'/prototype-phone.html',kind:'isolated UI fixture; not normal product build'}));
  const close=()=>server.close(()=>process.exit(0));process.on('SIGINT',close);process.on('SIGTERM',close);
  await new Promise(()=>{});
}
const report={scope:'UI components with actual Player + own fixture audio; product main/SDK not built or accepted',hashes,engines:[],cases:[],errors:[],external:[],cleanup:false};
const assert=(value,label)=>{if(!value)throw Error(label);};
let browser;
async function check(engine,name,fn){try{await fn();report.cases.push({engine,name,pass:true});}catch(error){report.cases.push({engine,name,pass:false,error:String(error)});console.log('FAIL '+engine+' '+name+': '+String(error));}}
try{
for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  browser=await launcher.launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true}:{headless:true});
  report.engines.push({engine,version:browser.version(),profile:'iPhone 13 descriptor dimensions/touch; Linux engine, not physical Safari'});
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:664}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(report.external.push(r.request().url()),r.abort()));
  const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>report.errors.push({engine,error:String(e)}));
  for(const [width,height]of [[320,568],[375,667],[390,480],[390,664],[390,844],[430,700],[844,390],[1280,800]]){
    await check(engine,`product components ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});await page.goto(origin+'/tests/integration/design-responsive.html');await page.locator('.mini-player').waitFor();
      await page.locator('button').filter({hasText:'Títulos largos'}).click();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Document horizontal overflow');
      await page.locator('.mini-player__expand').click();await page.locator('[role="dialog"]').waitFor();
      const box=await page.locator('[role="dialog"]').boundingBox();assert(box.y>=-1&&box.y+box.height<=height+1,'Player outside visible viewport');
      assert(await page.locator('.player-surface').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Player horizontal overflow');
      const miniButtons=await page.locator('.mini-player__toggle,.mini-player__expand').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height};}));
      assert(miniButtons.every(r=>Math.abs(r.width-r.height)<=1&&r.width>=44&&r.height>=44),'Distorted native mini buttons');
      const art=await page.locator('.player-surface .artwork-placeholder').boundingBox();assert(Math.abs(art.width-art.height)<=1,'Distorted artwork');
      assert(await page.locator('header').evaluate(el=>el.inert),'Background not inert');
      await page.locator('.player-surface').evaluate(el=>el.scrollTop=el.scrollHeight);
      const close=page.getByRole('button',{name:'Cerrar reproductor'}),closeBox=await close.boundingBox();assert(closeBox.y>=-1&&closeBox.y+closeBox.height<=height+1,'Close control unreachable');
      await close.click();assert(await page.locator('.mini-player__expand').evaluate(el=>document.activeElement===el),'Focus not restored');
      await page.locator('.shell-nav button').filter({hasText:'Buscar'}).click();await page.locator('input[type="search"]').fill('Muestra local');
      assert(await page.locator('input[type="search"]').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),'Small input font');
      if(width===390&&height===664)await page.screenshot({path:resolve(base,engine+'-components.png'),fullPage:true});
    });
  }
  await check(engine,'theme, 200% text, focus loop and viewport change while open',async()=>{
    await page.setViewportSize({width:390,height:664});await page.goto(origin+'/tests/integration/design-responsive.html');await page.locator('.mini-player').waitFor();
    await page.locator('button').filter({hasText:'Títulos largos'}).click();await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.style.fontSize='200%';});
    await page.locator('.mini-player__expand').click();assert(await page.locator('.player-surface').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Enlarged text overflow');
    await page.setViewportSize({width:390,height:480});await page.waitForFunction(()=>Math.abs(document.getElementById('player').getBoundingClientRect().height-innerHeight)<2);
    await page.locator('.player-surface').evaluate(el=>el.scrollTop=el.scrollHeight);await page.getByRole('button',{name:'Cerrar reproductor'}).click();
    await page.evaluate(()=>document.documentElement.style.fontSize='');await page.locator('.mini-player__expand').click();
    const last=page.locator('.player-surface>ol li:last-child button:last-child');await last.focus();await page.keyboard.press('Tab');assert(await page.getByRole('button',{name:'Cerrar reproductor'}).evaluate(el=>document.activeElement===el),'Focus loop escaped');
    await page.keyboard.press('Escape');assert(await page.locator('[role="dialog"]').count()===0,'Escape did not close');
    assert(await page.locator('header').evaluate(el=>!el.inert),'Background remained inert');assert(await page.locator('body').evaluate(el=>el.style.overflow===''),'Scroll lock remained');
  });
  await check(engine,'actual Player progress and source survive open/close',async()=>{
    await page.setViewportSize({width:390,height:664});await page.goto(origin+'/tests/integration/design-responsive.html');await page.locator('.mini-player').waitFor();
    await page.getByRole('button',{name:'Reproducir desde minirreproductor'}).click();await page.waitForFunction(()=>window.designFixture.audio.currentTime>.1&&!window.designFixture.audio.paused);
    const before=await page.evaluate(()=>({generation:window.designFixture.player.generation,starts:window.designFixture.starts,src:window.designFixture.audio.src,time:window.designFixture.audio.currentTime}));
    await page.locator('.mini-player__expand').click();await page.getByRole('button',{name:'Cerrar reproductor'}).click();
    const after=await page.evaluate(()=>({generation:window.designFixture.player.generation,starts:window.designFixture.starts,src:window.designFixture.audio.src,time:window.designFixture.audio.currentTime,paused:window.designFixture.audio.paused}));
    assert(before.generation===after.generation&&before.src===after.src&&before.starts===after.starts&&!after.paused&&after.time>=before.time,'Expansion changed playback lifetime');
    await page.getByRole('button',{name:'Pausar desde minirreproductor'}).click();
  });
  for(const [path,width,height]of [['directions',390,664],['mobile',390,664],['mobile',728,1100],['phone',390,664],['phone',390,844],['phone',844,390],['phone',320,568]]){
    await page.setViewportSize({width,height});await page.goto(origin+'/prototype-'+path+'.html');
    const inner=path==='mobile'?page.frameLocator('#mobile'):page;
    await inner.locator('.app').waitFor();
    for(let i=0;i<3;i++)await check(engine,`${path} ${width}×${height} / ${['Bruma','Grafito','Tinta'][i]}`,async()=>{
      await inner.locator('.proto-picker-item').nth(i).click();await inner.locator('.app[data-theme="'+['bruma','grafito','tinta'][i]+'"]').waitFor();
      if(path==='mobile'){
        const frame=await page.locator('#mobile').boundingBox();assert(frame.y+frame.height<=height+1,'Preview frame outside viewport');await page.getByRole('button',{name:'Reproductor',exact:true}).click();
      }else await inner.locator('.dock-copy').click();
      await inner.locator('.expanded').waitFor({state:'visible'});await inner.locator('.expanded').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
      const surface=await inner.locator('.expanded').boundingBox();assert(surface.y>=-1&&surface.y+surface.height<=height+1,'Prototype player outside viewport');
      const cover=await inner.locator('.expanded .cover').boundingBox();assert(Math.abs(cover.width-cover.height)<1.5,'Prototype cover stretched');
      const buttons=await inner.locator('.transport .icon-button,.expanded-heading .icon-button,.now-favorite').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label'),width:r.width,height:r.height};}));
      assert(buttons.every(r=>Math.abs(r.width-r.height)<=1&&r.width>=44&&r.height>=44),'Distorted prototype buttons: '+JSON.stringify(buttons));
      assert(await inner.locator('.expanded').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Prototype horizontal overflow');
      await inner.locator('.expanded').evaluate(el=>el.scrollTop=el.scrollHeight);const close=inner.getByRole('button',{name:'Cerrar reproductor',exact:true});await close.click();
      if(engine==='webkit'&&path==='phone'&&width===390&&height===664&&i===0)await page.screenshot({path:resolve(base,'webkit-phone-fixed.png'),fullPage:true});
    });
  }
  await context.close();await browser.close();browser=null;
}
}catch(error){report.error=String(error);}
finally{
  await browser?.close();await new Promise(r=>server.close(r));report.cleanup=true;
  report.pass=!report.error&&!report.errors.length&&!report.external.length&&report.cases.every(c=>c.pass);
  await writeFile(resolve(base,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(c=>!c.pass),engines:report.engines,errors:report.errors,external:report.external,cleanup:report.cleanup},null,2));
  if(!report.pass)process.exitCode=1;
}
