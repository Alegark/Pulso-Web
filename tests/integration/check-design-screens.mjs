import {chromium,webkit,devices} from 'playwright-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

execFileSync(process.execPath,['design/scripts/build-app-demo.mjs']);
const base=resolve('.local/design-screens');await mkdir(base,{recursive:true});
const artifact=resolve('design/prototypes/app-demo.html'),url=pathToFileURL(artifact).href;
const report={scope:'standalone fictional catalogue; no product main/SDK/storage/publication or physical iPhone',sha256:createHash('sha256').update(await readFile(artifact)).digest('hex'),engines:[],cases:[],errors:[],external:[],cleanup:false};
const assert=(condition,label)=>{if(!condition)throw Error(label);};
async function check(engine,name,fn){try{await fn();report.cases.push({engine,name,pass:true});}catch(error){report.cases.push({engine,name,pass:false,error:String(error)});console.log(`FAIL ${engine} ${name}: ${error}`);}}
let browser;
try{
for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  browser=await launcher.launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true}:{headless:true});
  report.engines.push({engine,version:browser.version()});
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:664}});
  await context.route('**/*',route=>{const value=route.request().url();if(/^(file:|blob:|data:)/.test(value))route.continue();else{report.external.push(value);route.abort();}});
  await context.addInitScript(()=>{
    window.designPlayback={elements:[],starts:0};
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){window.designPlayback.starts++;if(!window.designPlayback.elements.includes(this))window.designPlayback.elements.push(this);return play.call(this);};
  });
  const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>report.errors.push({engine,error:String(error)}));
  const nav=name=>page.locator('.music-nav:visible').getByRole('button',{name,exact:true});
  const playerOpener=()=>page.viewportSize().width>=1024?page.locator('.desktop-player__details'):page.locator('.mini-player__expand');
  const openTools=async()=>{const details=page.locator('.demo-tools');if(!await details.getAttribute('open').then(value=>value!==null))await details.locator('summary').click();};
  const fits=async(label)=>{
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}: document overflow`);
    const violations=await page.locator('button:visible').evaluateAll(items=>items.filter(el=>!el.closest('[inert]')).map(el=>({name:el.textContent||el.getAttribute('aria-label'),rect:el.getBoundingClientRect()})).filter(({rect})=>rect.height<43||rect.x<-.5||rect.right>innerWidth+.5).map(({name,rect})=>({name,width:rect.width,height:rect.height,x:rect.x,right:rect.right})));
    assert(!violations.length,`${label}: touch geometry ${JSON.stringify(violations)}`);
  };
  for(const [width,height] of [[320,568],[375,667],[390,480],[390,664],[430,700],[844,390],[1280,800]]){
    await check(engine,`six screens, playlists and expanded controls ${width}x${height}`,async()=>{
      await page.setViewportSize({width,height});await page.goto(url);await page.getByRole('heading',{name:'Tu música, a tu ritmo.'}).waitFor();await fits('home');
      await page.getByRole('button',{name:'Explorar álbum'}).click();await page.getByRole('heading',{name:'Órbita lenta',exact:true}).waitFor();await fits('album');
      await page.getByRole('button',{name:'Luna Norte ↗'}).click();await page.getByRole('heading',{name:'Luna Norte',exact:true}).waitFor();await fits('artist');
      await nav('Buscar').click();await fits('search');await page.getByLabel('Canciones, álbumes o artistas').fill('Luna');await page.locator('.search-form').getByRole('button',{name:'Buscar',exact:true}).click();await page.getByText('Resultados para «Luna»',{exact:true}).waitFor();
      assert(await page.locator('.song-list li').count()===5,'search result count');
      await nav('Biblioteca').click();await openTools();await page.getByRole('button',{name:'Títulos largos',exact:true}).click();await fits('long library');
      await page.getByRole('button',{name:'Playlists',exact:true}).click();await fits('playlists collection');await page.locator('#playlist-media-luz').click();await fits('playlist detail long');
      await page.getByRole('button',{name:'+ Añadir canciones',exact:true}).click();await fits('playlist picker');await page.getByRole('button',{name:'Cancelar selección',exact:true}).click();
      await page.getByRole('button',{name:'Editar playlist',exact:true}).click();await page.getByLabel('Nombre',{exact:true}).fill('Un nombre de playlist larguísimo 🌙 '+ 'Luz'.repeat(13));await fits('playlist edit');await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await fits('long playlist name');
      await playerOpener().click();await page.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor();
      const box=await page.locator('.player-surface').boundingBox();assert(box.y>=-1&&box.y+box.height<=height+1,'expanded viewport bounds');
      assert(await page.locator('.player-surface').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'expanded overflow');
      const geometry=await page.locator('.expanded-transport button').evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect();return [r.width,r.height];}));assert(geometry.every(([w,h])=>w>=44&&h>=44&&Math.abs(w-h)<1),'circular controls');
      await page.getByRole('button',{name:'Mostrar letra',exact:true}).click();await page.locator('.player-detail-view h2').waitFor();assert(await page.locator('.player-surface').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'lyrics view overflow');
      const lyricsClose=await page.getByRole('button',{name:'Cerrar reproductor'}).boundingBox();assert(lyricsClose.y>=-1&&lyricsClose.y+lyricsClose.height<=height+1,'lyrics global close outside viewport');
      await page.getByRole('button',{name:'← Volver al reproductor',exact:true}).click();assert(await page.getByRole('button',{name:'Mostrar letra',exact:true}).evaluate(el=>el===document.activeElement),'lyrics opener focus');
      await page.locator('.player-surface').evaluate(el=>el.scrollTop=el.scrollHeight);
      const close=page.getByRole('button',{name:'Cerrar reproductor'}),closeBox=await close.boundingBox();assert(closeBox.y>=-1&&closeBox.y+closeBox.height<=height+1,'close reachable');await close.click();
      assert(await playerOpener().evaluate(el=>el===document.activeElement),'return focus');
    });
  }
  await page.setViewportSize({width:390,height:664});
  await check(engine,'floating bubbles preserve layout, fit resize and clear the dock',async()=>{
    for(const [width,height] of [[320,568],[390,664],[390,480],[844,390],[1280,800]]){
      await page.setViewportSize({width,height});await page.goto(url);await nav('Buscar').click();
      const before=await page.locator('.page-heading').evaluate(el=>el.getBoundingClientRect().top+scrollY);
      await openTools();await page.getByRole('button',{name:'Probar error de búsqueda',exact:true}).click();await page.locator('.error-bubble__message').waitFor();
      assert(await page.locator('.error-bubble-host').evaluate(el=>getComputedStyle(el).position==='fixed'),'notice is not floating');
      const after=await page.locator('.page-heading').evaluate(el=>el.getBoundingClientRect().top+scrollY);assert(Math.abs(before-after)<1,'notice moved page content');
      const bubble=await page.locator('.error-bubble-host').boundingBox(),dock=await page.locator('.music-dock').boundingBox(),fixed=await page.locator('.music-dock').evaluate(el=>getComputedStyle(el).position==='fixed');
      assert(bubble.x>=0&&bubble.y>=0&&bubble.x+bubble.width<=width+1&&bubble.y+bubble.height<=height+1,'floating notice outside viewport');
      if(fixed)assert(bubble.y+bubble.height<=dock.y-8,'notice overlaps dock');
      await page.getByRole('button',{name:'Cerrar aviso de error'}).click();
    }
    await page.setViewportSize({width:390,height:664});await page.goto(url);await openTools();await page.getByRole('button',{name:'Probar error de reproducción',exact:true}).click();
    await page.setViewportSize({width:390,height:400});const box=await page.locator('.error-bubble-host').boundingBox();assert(box.y>=0&&box.y+box.height<=400+1,'notice did not follow resized viewport');
    await page.getByRole('button',{name:'Cerrar aviso de error'}).click();await page.setViewportSize({width:390,height:664});
  });
  await check(engine,'playlist create, select, reorder, rename, play and delete preserve library',async()=>{
    await page.goto(url);await nav('Biblioteca').click();await page.getByRole('button',{name:'Playlists',exact:true}).click();await page.getByRole('button',{name:'Crear playlist',exact:true}).click();
    assert(await page.getByLabel('Nombre',{exact:true}).evaluate(el=>el===document.activeElement),'create focus');
    await page.getByLabel('Nombre',{exact:true}).fill('   ');assert(await page.locator('.playlist-form').getByRole('button',{name:'Crear playlist',exact:true}).isDisabled(),'blank playlist accepted');
    await page.getByLabel('Nombre',{exact:true}).fill('Rutas nocturnas');await page.getByLabel('Descripción').fill('Para caminar sin prisa.');await page.locator('.playlist-form').getByRole('button',{name:'Crear playlist',exact:true}).click();
    await page.getByRole('heading',{name:'Rutas nocturnas',exact:true}).waitFor();assert(await page.getByRole('button',{name:'▶ Escuchar playlist',exact:true}).isDisabled(),'empty playlist can play');
    await page.getByRole('button',{name:'+ Añadir canciones',exact:true}).click();for(const name of ['Antes de salir','Luz de madrugada','Volver despacio'])await page.getByRole('checkbox',{name:new RegExp(name)}).check();
    await page.getByRole('button',{name:'Añadir selección (3)',exact:true}).click();assert(await page.locator('.playlist-tracks li').count()===3,'playlist addition');
    await page.getByRole('button',{name:'Bajar Antes de salir',exact:true}).click();assert(await page.locator('.playlist-tracks li .song-main strong').allTextContents().then(names=>names.join('|')==='Luz de madrugada|Antes de salir|Volver despacio'),'playlist order');
    await page.getByRole('button',{name:'Quitar Antes de salir de la playlist',exact:true}).click();assert(await page.locator('.playlist-tracks li').count()===2,'playlist remove');
    await page.getByRole('button',{name:'Editar playlist',exact:true}).click();await page.getByLabel('Nombre',{exact:true}).fill('Paseos de noche');await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.getByRole('heading',{name:'Paseos de noche',exact:true}).waitFor();
    assert(await page.evaluate(()=>window.designPlayback.starts)===0,'organizing started audio');
    await page.getByRole('button',{name:'▶ Escuchar playlist',exact:true}).click();await page.locator('.mini-player__expand').click();await page.getByRole('button',{name:'Siguiente canción de muestra'}).click();assert(await page.locator('.expanded-info h2').textContent()==='Volver despacio','playlist playback sequence');await page.getByRole('button',{name:'Cerrar reproductor'}).click();
    await page.getByRole('button',{name:'Eliminar playlist',exact:true}).click();await page.getByRole('button',{name:'Cancelar eliminación',exact:true}).click();assert(await page.getByRole('heading',{name:'Paseos de noche',exact:true}).isVisible(),'cancel deleted playlist');
    await page.getByRole('button',{name:'Eliminar playlist',exact:true}).click();await page.getByRole('button',{name:'Confirmar eliminación de playlist',exact:true}).click();assert(await page.locator('.library-card[data-kind="Playlists"]').count()===3,'delete playlist');
    await page.locator('#playlist-favoritos').click();assert(await page.locator('.playlist-tracks li').count()===7,'delete affected automatic favorites');
  });
  await check(engine,'playlist picker excludes duplicates, empty list and cancel remain usable',async()=>{
    await page.goto(url);await nav('Biblioteca').click();await page.getByRole('button',{name:'Playlists',exact:true}).click();await page.locator('#playlist-media-luz').click();await page.getByRole('button',{name:'+ Añadir canciones',exact:true}).click();
    assert(await page.getByRole('checkbox').count()===5,'existing tracks offered again');await page.getByRole('button',{name:'Cancelar selección',exact:true}).click();assert(await page.locator('.playlist-tracks li').count()===3,'cancel changed playlist');
    for(const name of ['Todo a su tiempo','Luz de madrugada','Sin mirar atrás'])await page.getByRole('button',{name:`Quitar ${name} de la playlist`,exact:true}).click();
    await page.getByRole('heading',{name:'Hazla tuya, canción a canción',exact:true}).waitFor();assert(await page.getByRole('button',{name:'+ Añadir canciones',exact:true}).evaluate(el=>el===document.activeElement),'empty removal lost focus');
    await page.getByRole('button',{name:'Volver',exact:true}).click();await page.locator('#playlist-media-luz').waitFor();
    for(const id of ['media-luz','para-salir']){await page.locator(`#playlist-${id}`).click();await page.getByRole('button',{name:'Eliminar playlist',exact:true}).click();await page.getByRole('button',{name:'Confirmar eliminación de playlist',exact:true}).click();}
    assert(await page.locator('.library-card').count()===1,'automatic favorites was deleted');await page.getByRole('button',{name:'Crear playlist',exact:true}).click();await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert(await page.getByRole('button',{name:'Crear playlist',exact:true}).evaluate(el=>el===document.activeElement),'create cancel focus');
  });
  await check(engine,'floating error with text 200%, dark and short expanded viewport',async()=>{
    await page.goto(url);await page.getByRole('button',{name:'Activar tema oscuro'}).click();await page.evaluate(()=>document.documentElement.style.fontSize='200%');await openTools();await page.getByRole('button',{name:'Probar error de reproducción',exact:true}).click();
    const normal=await page.locator('.error-bubble-host').boundingBox(),dock=await page.locator('.music-dock').boundingBox();assert(normal.y>=0&&normal.y+normal.height<=dock.y-8,'200% error overlaps mini');
    await page.getByRole('button',{name:'Cerrar aviso de error'}).click();await page.locator('.mini-player__expand').click();await page.getByRole('button',{name:'Probar aviso de error aquí'}).click();
    await page.setViewportSize({width:390,height:400});await page.waitForFunction(()=>{const r=document.querySelector('.error-bubble-host').getBoundingClientRect();return r.y>=0&&r.bottom<=innerHeight+1;});
    await page.getByRole('button',{name:'Cerrar aviso de error'}).click();await page.getByRole('button',{name:'Cerrar reproductor'}).click();await page.setViewportSize({width:390,height:664});
  });
  await check(engine,'playlist copied queue survives later list edits',async()=>{
    await page.goto(url);await nav('Biblioteca').click();await page.getByRole('button',{name:'Playlists',exact:true}).click();await page.locator('#playlist-media-luz').click();await page.getByRole('button',{name:'▶ Escuchar playlist',exact:true}).click();
    await page.getByRole('button',{name:'Quitar Luz de madrugada de la playlist',exact:true}).click();await page.locator('.mini-player__expand').click();await page.getByRole('button',{name:'Siguiente canción de muestra'}).click();assert(await page.locator('.expanded-info h2').textContent()==='Luz de madrugada','editing list rewrote active queue');await page.getByRole('button',{name:'Cerrar reproductor'}).click();
    assert(await page.locator('.playlist-tracks li').count()===2,'list edit lost');
  });
  await check(engine,'search error, explicit single retry, dismissal, stale completion',async()=>{
    await page.goto(url);await openTools();await page.getByRole('button',{name:'Probar error de búsqueda',exact:true}).click();
    await page.getByRole('alert').getByText('La búsqueda no se pudo completar',{exact:true}).waitFor();assert(await page.getByLabel('Canciones, álbumes o artistas').inputValue()==='Luna','query lost');
    const before=await page.evaluate(()=>document.activeElement?.getAttribute('id'));assert(before==='music-search'||await page.locator('h1').evaluate(el=>el===document.activeElement),'error stole focus');
    await page.getByRole('button',{name:'Reintentar',exact:true}).click();assert(await page.getByRole('button',{name:'Reintentando…'}).isDisabled(),'retry not guarded');
    await page.getByText('Resultados para «Luna»',{exact:true}).waitFor();assert(await page.locator('.song-list li').count()===5,'retry results');
    await openTools();await page.getByRole('button',{name:'Probar error de búsqueda',exact:true}).click();await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.getByRole('button',{name:'Cerrar aviso de error'}).click();
    await page.waitForTimeout(750);assert(await page.locator('.error-bubble__message').count()===0,'dismissed error returned');assert(await page.getByLabel('Canciones, álbumes o artistas').inputValue()==='Luna','dismiss cleared query');
    await openTools();await page.getByRole('button',{name:'Probar error de búsqueda',exact:true}).click();await page.getByRole('button',{name:'Reintentar',exact:true}).click();await nav('Inicio').click();await page.waitForTimeout(750);assert(await page.getByRole('heading',{name:'Tu música, a tu ritmo.'}).isVisible(),'stale retry changed route');
  });
  await check(engine,'added songs form automatic Favorites and listening stays separate',async()=>{
    await page.goto(url);await nav('Biblioteca').click();assert(await page.locator('.library-filters button').allTextContents().then(labels=>labels.join('|')==='Playlists|Álbumes|Artistas'),'unexpected library categories');
    assert(await page.locator('.library-grid .library-card').first().getAttribute('id')==='playlist-favoritos','favorites not pinned');assert(await page.locator('#playlist-favoritos .favorites-cover__heart').count()===1,'heart artwork missing');
    await page.locator('#playlist-favoritos').click();assert(await page.locator('.playlist-tracks li').count()===6,'automatic seed membership');assert(await page.getByRole('button',{name:'Editar playlist',exact:true}).count()===0,'automatic playlist rename allowed');assert(await page.getByRole('button',{name:'Eliminar playlist',exact:true}).count()===0,'automatic playlist deletion allowed');
    await nav('Inicio').click();await page.getByRole('button',{name:'Escuchar muestra',exact:true}).click();await nav('Biblioteca').click();await page.locator('#playlist-favoritos').click();assert(await page.locator('.playlist-tracks li').count()===6,'listening added a song');
    await nav('Buscar').click();await page.locator('.mobile-browse').getByRole('button',{name:'Álbumes',exact:true}).click();await page.locator('#album-despues').click();await page.getByRole('button',{name:'+ Añadir a Biblioteca',exact:true}).click();await nav('Biblioteca').click();await page.locator('#playlist-favoritos').click();assert(await page.locator('.playlist-tracks li').count()===7,'added album absent from Favorites');
    await page.getByRole('button',{name:'Quitar Volver despacio de Favoritos',exact:true}).click();assert(await page.locator('.playlist-tracks li').count()===6,'remove automatic favorite');await nav('Biblioteca').click();await page.locator('#playlist-media-luz').click();assert(await page.locator('.playlist-tracks li').count()===3,'automatic removal damaged custom playlist');
    await openTools();await page.getByRole('button',{name:'Biblioteca vacía',exact:true}).click();assert(await page.locator('.library-card').count()===1,'empty Favorites is not retained');await page.locator('#playlist-favoritos').click();await page.getByRole('heading',{name:'Tus canciones empiezan aquí'}).waitFor();assert(await page.locator('.playlist-tracks li').count()===0,'empty missing');
  });
  await check(engine,'library mixed grid, category toggles, search, sort and list layout',async()=>{
    await page.goto(url);await nav('Biblioteca').click();assert(await page.locator('.library-card').count()===7,'mixed collections missing');
    await page.getByRole('button',{name:'Álbumes',exact:true}).click();assert(await page.locator('.library-card').count()===2,'album filter');await page.getByRole('button',{name:'Álbumes',exact:true}).click();assert(await page.locator('.library-card').count()===7,'clearing category filter failed');
    await page.getByRole('button',{name:'Buscar en Biblioteca',exact:true}).click();await page.getByLabel('Buscar en tu biblioteca',{exact:true}).fill('Luna');assert(await page.locator('.library-card').count()===2,'library name search');
    await page.getByLabel('Buscar en tu biblioteca',{exact:true}).fill('SinCoincidenciasXYZ');await page.getByRole('heading',{name:'Sin coincidencias en tu biblioteca',exact:true}).waitFor();await page.getByLabel('Buscar en tu biblioteca',{exact:true}).fill('');
    await page.getByRole('button',{name:'Ordenar biblioteca: recientes',exact:true}).click();assert(await page.locator('.library-card').first().getAttribute('id')==='playlist-favoritos','sort unpinned favorites');
    await page.getByRole('button',{name:'Ver biblioteca en lista',exact:true}).click();assert(await page.locator('.library-grid--list').count()===1,'list layout missing');await fits('library list');
    await page.getByRole('button',{name:'Ver biblioteca en cuadrícula',exact:true}).click();await page.getByRole('button',{name:'Activar tema oscuro'}).click();await page.evaluate(()=>document.documentElement.style.fontSize='200%');await fits('library text200');
  });
  await check(engine,'Favorites aggregates song hearts and additions without duplicates',async()=>{
    await page.goto(url);await nav('Biblioteca').click();await page.locator('#playlist-favoritos').click();const saved=await page.locator('.playlist-tracks .song-main strong').allTextContents();await nav('Biblioteca').click();await page.locator('#playlist-media-luz').click();
    assert(await page.locator('.playlist-tracks .song-main strong').allTextContents().then(names=>names.every(name=>saved.includes(name))),'seed playlist contains songs absent from automatic Favorites');
    await nav('Buscar').click();await page.getByLabel('Canciones, álbumes o artistas').fill('Volver');await page.locator('.search-form').getByRole('button',{name:'Buscar',exact:true}).click();await page.getByRole('button',{name:'Añadir a favoritos: Volver despacio',exact:true}).click();
    await nav('Biblioteca').click();await page.locator('#playlist-favoritos').click();assert(await page.locator('.playlist-tracks li').count()===7,'song heart absent from automatic playlist');
    await page.getByRole('button',{name:'+ Añadir canciones',exact:true}).click();assert(await page.getByRole('checkbox').count()===1,'added songs offered twice');await page.getByRole('checkbox',{name:/A unos pasos/}).check();await page.getByRole('button',{name:'Añadir selección (1)',exact:true}).click();assert(await page.locator('.playlist-tracks li').count()===8,'Favorites picker did not add song');
    const names=await page.locator('.playlist-tracks .song-main strong').allTextContents();assert(new Set(names).size===8,'duplicate automatic entries');assert(await page.evaluate(()=>window.designPlayback.starts)===0,'organizing started audio');
  });
  await check(engine,'player saved check reflects actual Favorites membership without playing',async()=>{
    await page.goto(url);await page.locator('.mini-player__expand').click();const saved=page.getByRole('button',{name:'Quitar canción actual de favoritos',exact:true});assert(await saved.getAttribute('aria-pressed')==='true','saved check absent');assert(await saved.locator('path').getAttribute('d')==='m5 12 4.5 4.5L19 7','saved check icon incorrect');
    await saved.click();const add=page.getByRole('button',{name:'Añadir canción actual a favoritos',exact:true});assert(await add.getAttribute('aria-pressed')==='false','unsaved indicator incorrect');assert(await add.locator('path').getAttribute('d')==='M12 5v14M5 12h14','plus icon missing');
    await page.getByRole('button',{name:'Cerrar reproductor'}).click();await nav('Biblioteca').click();await page.locator('#playlist-favoritos').click();assert(await page.locator('.playlist-tracks li').count()===5,'check did not update Favorites');
    await page.locator('.mini-player__expand').click();await page.getByRole('button',{name:'Añadir canción actual a favoritos',exact:true}).click();assert(await page.getByRole('button',{name:'Quitar canción actual de favoritos',exact:true}).getAttribute('aria-pressed')==='true','saved check not restored');assert(await page.evaluate(()=>window.designPlayback.starts)===0,'favorite action started audio');await page.getByRole('button',{name:'Cerrar reproductor'}).click();assert(await page.locator('.playlist-tracks li').count()===6,'restored membership missing');
  });
  await check(engine,'lyrics timed, plain and missing preserve audio and seek without autoplay',async()=>{
    await page.goto(url);await page.getByRole('button',{name:'Escuchar muestra',exact:true}).click();await page.locator('.mini-player__expand').click();await page.getByRole('button',{name:'Pausar sonido de prueba',exact:true}).click();
    const before=await page.evaluate(()=>({starts:window.designPlayback.starts,src:window.designPlayback.elements[0].src}));
    await page.getByRole('button',{name:'Mostrar letra',exact:true}).click();assert(await page.locator('.lyrics-full button').count()===4,'timed original lyrics missing');await page.locator('.lyrics-full button').nth(2).click();assert(await page.locator('.lyrics-full button').nth(2).getAttribute('aria-current')==='true','active line not updated');
    const after=await page.evaluate(()=>({starts:window.designPlayback.starts,src:window.designPlayback.elements[0].src,time:window.designPlayback.elements[0].currentTime,paused:window.designPlayback.elements[0].paused}));assert(after.src===before.src&&after.starts===before.starts&&Math.abs(after.time-4)<.2&&after.paused,'lyrics seek restarted audio');
    await page.getByRole('button',{name:'← Volver al reproductor',exact:true}).click();await page.getByRole('button',{name:'Siguiente canción de muestra'}).click();await page.getByRole('button',{name:'Mostrar letra',exact:true}).click();assert(await page.locator('.lyrics-full>p').count()===4&&await page.locator('.lyrics-full button').count()===0,'plain lyrics invented timings');
    await page.getByRole('button',{name:'Siguiente canción de muestra'}).click();await page.getByRole('heading',{name:'Letra no disponible',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Pausar sonido de prueba',exact:true}).isEnabled(),'missing lyrics blocked audio');await page.getByRole('button',{name:'Cerrar reproductor'}).click();await page.locator('.mini-player__expand').click();assert(await page.locator('.now-playing').getAttribute('data-view')==='player','reopen retained hidden lyrics view');
  });
  await check(engine,'player previous, repeat, shuffle and queue controls act on the same audio',async()=>{
    await page.goto(url);await page.getByRole('button',{name:'Escuchar muestra',exact:true}).click();await page.locator('.mini-player__expand').click();await page.getByRole('button',{name:'Siguiente canción de muestra'}).click();await page.getByRole('button',{name:'Canción anterior de muestra'}).click();assert(await page.locator('.expanded-info h2').textContent()==='Antes de salir','previous track');
    await page.getByRole('button',{name:'Repetir sonido de prueba'}).click();await page.waitForFunction(()=>window.designPlayback.elements[0].loop===false);await page.getByRole('button',{name:'Repetir sonido de prueba'}).click();await page.waitForFunction(()=>window.designPlayback.elements[0].loop===true);
    await page.getByRole('button',{name:'Reproducción aleatoria'}).click();assert(await page.getByRole('button',{name:'Reproducción aleatoria'}).getAttribute('aria-pressed')==='true','shuffle state');await page.getByRole('button',{name:'Siguiente canción de muestra'}).click();assert(await page.locator('.expanded-info h2').textContent()!=='Antes de salir','shuffle repeated current');
    const before=await page.evaluate(()=>window.designPlayback.starts);await page.getByRole('button',{name:'Cola',exact:true}).click();assert(await page.locator('.now-playing__queue li').count()===8,'queue missing');assert(await page.evaluate(()=>window.designPlayback.starts)===before,'opening queue played audio');await page.locator('.now-playing__queue button').last().click();await page.getByRole('button',{name:'← Volver al reproductor',exact:true}).click();assert(await page.locator('.expanded-info h2').textContent()==='A unos pasos','queue selection');assert(await page.evaluate(()=>window.designPlayback.elements.length)===1,'multiple media elements');
  });
  await check(engine,'mobile quick access opens collections and restores the exact tile',async()=>{
    await page.goto(url);assert(await page.locator('.mobile-quick-card').count()===4,'quick collection count');const geometry=await page.locator('.mobile-quick-card>:first-child').evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect();return [r.width,r.height];}));assert(geometry.every(([w,h])=>Math.abs(w-h)<1),'quick art distorted');
    await page.locator('#quick-playlist-favoritos').click();await page.getByRole('heading',{name:'Favoritos',exact:true}).waitFor();await page.getByRole('button',{name:'Volver',exact:true}).click();assert(await page.locator('#quick-playlist-favoritos').evaluate(el=>el===document.activeElement),'quick tile focus lost');
    assert(await page.evaluate(()=>window.designPlayback.starts)===0,'opening a collection played audio');await fits('quick home');
  });
  await check(engine,'mobile discovery opens real sample categories without autoplay',async()=>{
    await page.goto(url);await nav('Buscar').click();await page.locator('.mobile-browse').getByRole('button',{name:'Álbumes',exact:true}).click();assert(await page.locator('.album-card').count()===4,'browse albums');
    await page.locator('.search-form').getByRole('button',{name:'Buscar',exact:true}).click();await page.locator('.mobile-browse').getByRole('button',{name:'Artistas',exact:true}).click();assert(await page.locator('.artist-card').count()===3,'browse artists');
    await page.locator('.search-form').getByRole('button',{name:'Buscar',exact:true}).click();await page.locator('.mobile-browse').getByRole('button',{name:'Favoritos',exact:true}).click();await page.getByRole('heading',{name:'Favoritos',exact:true}).waitFor();assert(await page.evaluate(()=>window.designPlayback.starts)===0,'browse autoplay');
  });
  await check(engine,'song sheet adds to playlist, prevents duplicates and restores context',async()=>{
    await page.goto(url);const opener=page.getByRole('button',{name:'Opciones de Antes de salir',exact:true});await opener.click();const sheet=page.getByRole('dialog',{name:'Opciones de Antes de salir',exact:true});await sheet.waitFor();assert(await page.evaluate(()=>document.body.style.overflow)==='hidden','sheet did not lock background scroll');
    assert(await sheet.getByRole('button',{name:/Para salir/}).isDisabled(),'duplicate playlist option active');await sheet.getByRole('button',{name:/A media luz/}).click();assert(!await sheet.isVisible(),'sheet did not close after addition');assert(await opener.evaluate(el=>el===document.activeElement),'song opener focus lost');assert(await page.evaluate(()=>document.body.style.overflow)!=='hidden','sheet scroll lock leaked');
    await opener.click();assert(await page.getByRole('dialog').getByRole('button',{name:/A media luz/}).isDisabled(),'duplicate newly added song allowed');await page.getByRole('button',{name:'Cerrar opciones de canción'}).click();await nav('Biblioteca').click();await page.locator('#playlist-media-luz').click();assert(await page.locator('.playlist-tracks li').count()===4,'sheet playlist addition missing');assert(await page.evaluate(()=>window.designPlayback.starts)===0,'organizing played audio');
  });
  await check(engine,'song sheet toggles Favorites and Escape restores the row',async()=>{
    await page.goto(url);const opener=page.getByRole('button',{name:'Opciones de Antes de salir',exact:true});await opener.click();await page.getByRole('dialog').getByRole('button',{name:'✓ Quitar de Favoritos',exact:true}).click();assert(await page.getByRole('button',{name:'Añadir a favoritos: Antes de salir',exact:true}).getAttribute('aria-pressed')==='false','sheet saved state mismatch');
    await opener.click();await page.keyboard.press('Escape');assert(await page.locator('.track-action-sheet').evaluate(el=>!el.open),'Escape did not close native sheet');assert(await opener.evaluate(el=>el===document.activeElement),'Escape lost row focus');
  });
  await check(engine,'song sheet long text, short viewport and 200% keep close reachable',async()=>{
    await page.goto(url);await openTools();await page.getByRole('button',{name:'Títulos largos',exact:true}).click();await page.evaluate(()=>document.documentElement.style.fontSize='200%');await page.getByRole('button',{name:'Opciones de Antes de salir',exact:true}).click();await page.setViewportSize({width:320,height:480});
    await page.locator('.track-action-sheet').evaluate(el=>el.scrollTop=el.scrollHeight);const box=await page.getByRole('button',{name:'Cerrar opciones de canción'}).boundingBox();assert(box.y>=-1&&box.y+box.height<=481,'sheet close out of short viewport');assert(await page.locator('.track-action-sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'sheet horizontal overflow');await page.getByRole('button',{name:'Cerrar opciones de canción'}).click();await page.setViewportSize({width:390,height:664});
  });
  await check(engine,'song sheet plays only on explicit action, mobile preview is narrow',async()=>{
    await page.goto(url);await page.getByRole('button',{name:'Opciones de Antes de salir',exact:true}).click();await page.getByRole('button',{name:'▶ Reproducir ahora',exact:true}).click();await page.waitForFunction(()=>window.designPlayback.elements[0]?.currentTime>.1);assert(await page.evaluate(()=>window.designPlayback.elements.length)===1,'sheet created another audio');
    await page.setViewportSize({width:728,height:900});await page.goto(pathToFileURL(resolve('design/prototypes/mobile-preview.html')).href);const frame=page.frameLocator('iframe');await frame.locator('.mobile-quick-grid').waitFor();assert(await frame.locator('body').evaluate(()=>innerWidth)<=390,'phone preview widened into desktop');await frame.locator('#quick-playlist-favoritos').click();await frame.getByRole('heading',{name:'Favoritos',exact:true}).waitFor();await page.setViewportSize({width:390,height:664});
  });
  await check(engine,'one actual audio survives navigation and player; error inside dialog',async()=>{
    await page.goto(url);await page.getByRole('button',{name:'Escuchar muestra',exact:true}).click();await page.waitForFunction(()=>window.designPlayback.elements[0]?.currentTime>.1);
    const before=await page.evaluate(()=>({starts:window.designPlayback.starts,time:window.designPlayback.elements[0].currentTime,src:window.designPlayback.elements[0].src}));
    await nav('Buscar').click();await page.locator('.mini-player__expand').click();await page.getByRole('button',{name:'Cerrar reproductor'}).waitFor();
    const after=await page.evaluate(()=>({starts:window.designPlayback.starts,time:window.designPlayback.elements[0].currentTime,src:window.designPlayback.elements[0].src,count:window.designPlayback.elements.length}));
    assert(after.count===1&&after.starts===before.starts&&after.src===before.src&&after.time>=before.time,'player restarted');
    await page.getByRole('button',{name:'Probar aviso de error aquí'}).click();assert(await page.getByRole('dialog').getByRole('alert').getByText('No pudimos reproducir esta canción',{exact:true}).isVisible(),'dialog error inaccessible');
    await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.waitForFunction(()=>!window.designPlayback.elements[0].paused);await page.locator('.error-bubble__message').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Pausar sonido de prueba'}).click();assert(await page.evaluate(()=>window.designPlayback.elements[0].paused),'pause failed');await page.getByRole('button',{name:'Cerrar reproductor'}).click();
  });
  await check(engine,'rejected playback retry keeps the failure visible',async()=>{
    await page.goto(url);await page.evaluate(()=>{HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('test','NotAllowedError'));});
    await page.getByRole('button',{name:'Escuchar muestra',exact:true}).click();await page.getByRole('alert').getByText('No pudimos iniciar el audio',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.getByRole('button',{name:'Reintentar',exact:true}).waitFor();assert(await page.getByRole('alert').getByText('No pudimos iniciar el audio',{exact:true}).isVisible(),'failed retry hidden');
  });
  await check(engine,'back restores context, error does not expire or steal focus',async()=>{
    await page.goto(url);await nav('Buscar').click();await page.getByLabel('Canciones, álbumes o artistas').fill('Luna');await page.locator('.search-form').getByRole('button',{name:'Buscar',exact:true}).click();await page.getByText('Resultados para «Luna»',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Álbumes',exact:true}).click();await page.locator('#album-orbita').click();await page.getByRole('button',{name:'Volver',exact:true}).click();
    assert(await page.getByLabel('Canciones, álbumes o artistas').inputValue()==='Luna','back lost query');assert(await page.locator('#album-orbita').evaluate(el=>el===document.activeElement),'back lost card focus');
    await openTools();await page.getByRole('button',{name:'Probar error de búsqueda',exact:true}).click();await page.getByLabel('Canciones, álbumes o artistas').focus();await page.waitForTimeout(8100);
    assert(await page.locator('.error-bubble__message').isVisible(),'error auto-dismissed');assert(await page.getByLabel('Canciones, álbumes o artistas').evaluate(el=>el===document.activeElement),'notice stole focus');
    await page.getByRole('button',{name:'Cerrar aviso de error'}).click();assert(await page.getByLabel('Canciones, álbumes o artistas').evaluate(el=>el===document.activeElement),'dismiss lost keyboard focus');
  });
  await check(engine,'text 200%, dark, empty results, keyboard escape and return',async()=>{
    await page.goto(url);await page.getByRole('button',{name:'Activar tema oscuro'}).click();await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    await fits('200% home');await nav('Buscar').click();await page.getByLabel('Canciones, álbumes o artistas').fill('SinCoincidenciasXYZ');await page.locator('.search-form').getByRole('button',{name:'Buscar',exact:true}).click();await page.getByRole('heading',{name:'Sin coincidencias'}).waitFor();await fits('empty text200');
    await page.locator('.mini-player__expand').click();await page.keyboard.press('Escape');assert(await page.locator('.mini-player__expand').evaluate(el=>el===document.activeElement),'escape focus');
  });
  await check(engine,'visual samples captured',async()=>{
    await page.setViewportSize({width:390,height:664});await page.goto(url);await page.screenshot({path:resolve(base,`${engine}-home.png`),fullPage:true});
    await openTools();await page.getByRole('button',{name:'Probar error de búsqueda',exact:true}).click();await page.screenshot({path:resolve(base,`${engine}-error.png`),fullPage:true});
    await nav('Biblioteca').click();await page.getByRole('button',{name:'Playlists',exact:true}).click();await page.screenshot({path:resolve(base,`${engine}-playlists.png`),fullPage:true});await page.locator('#playlist-media-luz').click();await page.screenshot({path:resolve(base,`${engine}-playlist-detail.png`),fullPage:true});
    await page.locator('.mini-player__expand').click();await page.screenshot({path:resolve(base,`${engine}-player.png`)});await page.getByRole('button',{name:'Mostrar letra',exact:true}).click();await page.locator('.player-surface').evaluate(el=>{el.scrollTop=0;return new Promise(resolve=>requestAnimationFrame(()=>resolve(null)));});await page.screenshot({path:resolve(base,`${engine}-lyrics.png`)});await page.getByRole('button',{name:'Cerrar reproductor'}).click();
    await page.setViewportSize({width:1280,height:800});await page.goto(url);await page.screenshot({path:resolve(base,`${engine}-desktop.png`),fullPage:true});
  });
  await check(engine,'inline preview opens playlists and supports floating errors',async()=>{
    await page.setViewportSize({width:390,height:900});await page.goto(pathToFileURL(resolve('design/prototypes/app-preview.html')).href);const frame=page.frameLocator('iframe');await frame.locator('#playlist-media-luz').waitFor();await frame.getByRole('heading',{name:'Tu biblioteca',exact:true}).waitFor();
    await frame.locator('#playlist-media-luz').click();await frame.getByRole('heading',{name:'A media luz',exact:true}).waitFor();await frame.locator('.demo-tools summary').click();await frame.getByRole('button',{name:'Probar error de reproducción',exact:true}).click();assert(await frame.locator('.error-bubble-host').evaluate(el=>getComputedStyle(el).position==='fixed'),'iframe error is not floating');
  });
  await check(engine,'player preview starts paused and supports lyrics and closing',async()=>{
    await page.goto(pathToFileURL(resolve('design/prototypes/player-lyrics-preview.html')).href);const frame=page.frameLocator('iframe');await frame.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor();assert(await frame.getByRole('button',{name:'Reproducir sonido de prueba',exact:true}).isVisible(),'preview autoplayed');
    await frame.getByRole('button',{name:'Mostrar letra',exact:true}).click();assert(await frame.locator('.lyrics-full button').count()===4,'inline player lyrics missing');await frame.getByRole('button',{name:'Cerrar reproductor'}).click();assert(await frame.locator('.mini-player__expand').evaluate(el=>el===document.activeElement),'preview close focus');
  });
  await context.close();await browser.close();browser=null;
}
report.cleanup=true;
}finally{if(browser)await browser.close();await writeFile(resolve(base,'report.json'),JSON.stringify(report,null,2));}
const failures=report.cases.filter(c=>!c.pass);console.log(JSON.stringify({pass:report.cases.length-failures.length,total:report.cases.length,errors:report.errors,external:report.external,cleanup:report.cleanup}));
if(failures.length||report.errors.length||report.external.length)process.exitCode=1;
