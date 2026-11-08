import assert from 'node:assert/strict';

/** Artist cases use the complete frozen main. Only public catalogue responses
 * are synthetic; Player, queue, storage and ownership remain the real product. */
export async function runArtistGroups(env) {
 const {group,fresh,pipeline,idle,input,panel,button,nav,report}=env;
 const page=()=>env.page(),context=()=>env.context();
 const artistName='MUSIC_FLOW Artist';
 const heading=()=>page().getByRole('heading',{name:artistName,exact:true});
 const artistButton=id=>page().getByRole('region',{name:'Artistas',exact:true}).getByRole('button',{name:new RegExp('ID '+id+'$')});
 const ownAlbum=(id=42,title='MUSIC_FLOW Album',artistId=2)=>({wrapperType:'collection',collectionType:'Album',collectionId:id,collectionName:title,artistId,artistName:artistId===2?artistName:'MUSIC_FLOW Guest, MUSIC_FLOW Artist',trackCount:1,releaseDate:'2026-01-01T00:00:00Z'});
 async function routes(options={}) {
  const state={mode:'ok',holdSearch:false,holdAlbums:false,long:false,...options,requests:[],held:[]};
  await context().route('https://itunes.apple.com/**',async route=>{
   const url=new URL(route.request().url()),entity=url.searchParams.get('entity'),id=Number(url.searchParams.get('id'));
   const record={entity,id,term:url.searchParams.get('term')};state.requests.push(record);
   let results;
   if(entity==='musicArtist')results=[1,2].map(artistId=>({wrapperType:'artist',artistId,artistName:record.term==='First'?'Obsolete artist':artistName}));
   else if(entity==='album'){
    const artist={wrapperType:'artist',artistId:id,artistName};
    if(state.mode==='error')return route.fulfill({status:502,headers:{'access-control-allow-origin':env.origin},body:''});
    if(state.mode==='empty')results=[artist];
    else if(state.mode==='invalid')results=[{...artist,artistId:id+10},ownAlbum()];
    else results=[artist,...(state.long?Array.from({length:40},(_,i)=>ownAlbum(i===39?42:100+i,i===39?'Exact chosen album':'Catalogue album '+i)):[ownAlbum(),ownAlbum(43,'Associated release',3)])];
   }else if(entity==='song'){
    const album=ownAlbum(id,state.long?'Exact chosen album':'MUSIC_FLOW Album');
    results=[album,{wrapperType:'track',kind:'song',collectionId:id,trackId:81,artistId:2,discNumber:1,discCount:1,trackNumber:1,trackCount:1,trackName:'MUSIC_FLOW Song (Live version)',artistName,trackTimeMillis:45000}];
   }else throw Error('Unexpected catalogue entity '+entity);
   const send=()=>route.fulfill({status:200,headers:{'access-control-allow-origin':env.origin,'content-type':'application/json'},body:JSON.stringify({resultCount:results.length,results})});
   if(entity==='musicArtist'&&state.holdSearch||entity==='album'&&state.holdAlbums){state.held.push(send);return;}
   await send();
  });
  state.release=async()=>{for(const send of state.held.splice(0))await send().catch(()=>{/* A cancelled native fetch may already have discarded its route. */});};
  return state;
 }
 async function searchArtists(query=artistName){await input().fill(query);await panel().getByRole('button',{name:'Buscar artistas',exact:true}).click();await artistButton(2).waitFor();}
 async function openArtist(id=2){await artistButton(id).click();await heading().waitFor();}
 const waitUntil=async(fn)=>{const until=Date.now()+20000;while(!fn()){assert(Date.now()<until,'Catalogue route barrier timed out');await new Promise(resolve=>setTimeout(resolve,20));}};
 const noHorizontalOverflow=()=>page().evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

 await group('22 artist search is explicit and only selecting an artist opens its page',async()=>{
  await fresh({control:true});const api=await routes(),rpc=report.rpc.length;
  await input().fill(artistName);await input().press('Enter');
  assert.equal(api.requests.length,0);assert.equal(await heading().count(),0);
  await panel().getByRole('button',{name:'Buscar artistas',exact:true}).click();await artistButton(2).waitFor();
  assert.equal(await heading().count(),0);assert.equal(api.requests.length,1);
  await openArtist();await button('Associated release · MUSIC_FLOW Guest, MUSIC_FLOW Artist · 2026-01-01 · 1 pistas').waitFor();
  assert.equal(api.requests.filter(r=>r.entity==='album').length,1);assert.equal(report.rpc.length,rpc);
  return {enterDoesNotOpen:true,selectionRequired:true,mixedCreditsAccepted:true,telegram:0};
 });

 await group('23 homonyms use canonical IDs and Back restores long-list focus and scroll',async()=>{
  await fresh({control:true});await page().setViewportSize({width:320,height:568});await page().evaluate(()=>{document.documentElement.style.fontSize='200%';});
  const api=await routes({long:true}),rpc=report.rpc.length;await searchArtists();await openArtist(2);
  const target=button('Exact chosen album · MUSIC_FLOW Artist · 2026-01-01 · 1 pistas');await target.waitFor();await target.scrollIntoViewIfNeeded();
  const scroll=await page().evaluate(()=>scrollY);assert(scroll>0,'Long artist page must actually scroll');assert(await noHorizontalOverflow());
  await target.click();await page().getByText('1 pistas · 1 discos',{exact:false}).waitFor();
  assert(api.requests.some(r=>r.entity==='album'&&r.id===2));assert.deepEqual(api.requests.filter(r=>r.entity==='song').map(r=>r.id),[42]);
  await button('Volver al artista').click();await target.waitFor();
  await page().waitForFunction(()=>document.activeElement?.textContent?.includes('Exact chosen album'));
  const restored=await page().evaluate(()=>scrollY);assert(Math.abs(restored-scroll)<4,`Scroll ${scroll} became ${restored}`);
  await button('Volver a búsqueda').click();await artistButton(2).waitFor();
  await page().waitForFunction(()=>document.activeElement?.textContent?.includes('ID 2'));
  assert.equal(await input().inputValue(),artistName);assert.equal(report.rpc.length,rpc);
  await page().setViewportSize({width:568,height:320});assert(await noHorizontalOverflow());
  return {canonicalArtist:2,canonicalAlbum:42,scrollRestored:true,focusRestored:true,queryPreserved:true,telegram:0,font:'200%',widths:[320,568]};
 });

 await group('24 unavailable empty and invalid artist album lists stay honest',async()=>{
  const cases=[];
  for(const mode of ['error','empty','invalid']){
   await fresh({control:true});const api=await routes({mode}),rpc=report.rpc.length;
   await searchArtists();await openArtist();
   await page().getByText(mode==='empty'?'No se encontraron álbumes en los resultados disponibles.':'No se pudo consultar la lista de álbumes.',{exact:true}).waitFor();
   assert.equal(await page().locator('.album-page:visible li button').count(),0);assert.equal(report.rpc.length,rpc);
   assert.equal(api.requests.filter(r=>r.entity==='album').length,1);cases.push({mode,albumsShown:0,telegram:0});
  }
  return {cases};
 });

 await group('25 stale query hidden view and revoked scope deny old artist publication',async()=>{
  await fresh({control:true});const api=await routes({holdSearch:true}),rpc=report.rpc.length;
  await input().fill('First');await panel().getByRole('button',{name:'Buscar artistas',exact:true}).click();await waitUntil(()=>api.held.length===1);
  api.holdSearch=false;await input().fill('Second');await api.release();await artistButton(2).waitFor();
  assert.equal(await page().getByRole('button',{name:/Obsolete artist/}).count(),0);
  await page().evaluate(()=>{const el=[...document.querySelectorAll('section[aria-label="Artistas"] button')].find(b=>b.textContent.endsWith('ID 2'));const key=Object.keys(el).find(k=>k.startsWith('__reactProps$'));MUSIC_FLOW.saved.artistButton=el;MUSIC_FLOW.saved.oldArtistClick=el[key].onClick;MUSIC_FLOW.saved.oldAuthority=MUSIC_FLOW.root().captureCurrent();MUSIC_FLOW.saved.scope=MUSIC_FLOW.root().scopeKey;});
  api.holdAlbums=true;await openArtist();await waitUntil(()=>api.held.length===1);await nav('Inicio').click();
  // Explicit TESTONLY lifecycle event on the real main, not a BFCache claim.
  await page().evaluate(()=>dispatchEvent(new Event('pagehide')));await api.release();
  await page().waitForFunction(()=>MUSIC_FLOW.root().scopeKey!==MUSIC_FLOW.saved.scope);
  assert.equal(await page().evaluate(()=>MUSIC_FLOW.saved.oldAuthority()),false);
  await page().evaluate(()=>MUSIC_FLOW.saved.oldArtistClick({currentTarget:MUSIC_FLOW.saved.artistButton}));
  await nav('Buscar').click();assert.equal(await heading().count(),0);assert.equal(await page().locator('.album-page:visible li button').count(),0);assert.equal(report.rpc.length,rpc);
  return {lateOldQueryDiscarded:true,hiddenPublicationDenied:true,oldScopeDenied:true,staleClickDenied:true,scopeLifecycle:'TESTONLY pagehide event',telegram:0};
 });

 await group('26 artist and album navigation preserve native playing Audio queue and modes',async()=>{
  await pipeline('download-option');const api=await routes(),rpc=report.rpc.length;
  await page().locator('#player select').selectOption('all');await page().getByRole('button',{name:'Aleatorio',exact:true}).click();
  await page().evaluate(()=>{MUSIC_FLOW.saved.playingAudio=MUSIC_FLOW.audio[0];});
  const before=await page().evaluate(()=>({source:MUSIC_FLOW.audio[0].src,time:MUSIC_FLOW.audio[0].currentTime,playCalls:MUSIC_FLOW.playCalls,queue:document.querySelector('#player > ol').textContent,repeat:document.querySelector('#player select').value,shuffle:[...document.querySelectorAll('#player button')].find(b=>b.textContent==='Aleatorio').getAttribute('aria-pressed')}));
  await searchArtists();await openArtist();await button('MUSIC_FLOW Album · MUSIC_FLOW Artist · 2026-01-01 · 1 pistas').click();await page().getByText('1 pistas · 1 discos',{exact:false}).waitFor();
  await button('Volver al artista').click();await button('Volver a búsqueda').click();
  const after=await page().evaluate(()=>({sameAudio:MUSIC_FLOW.audio[0]===MUSIC_FLOW.saved.playingAudio,audioCount:MUSIC_FLOW.audio.length,source:MUSIC_FLOW.audio[0].src,time:MUSIC_FLOW.audio[0].currentTime,paused:MUSIC_FLOW.audio[0].paused,playCalls:MUSIC_FLOW.playCalls,queue:document.querySelector('#player > ol').textContent,repeat:document.querySelector('#player select').value,shuffle:[...document.querySelectorAll('#player button')].find(b=>b.textContent==='Aleatorio').getAttribute('aria-pressed')}));
  assert(after.sameAudio);assert.equal(after.audioCount,1);assert.equal(after.source,before.source);assert.equal(after.paused,false);assert(after.time>before.time);assert.equal(after.playCalls,before.playCalls);assert.equal(after.queue,before.queue);assert.equal(after.repeat,before.repeat);assert.equal(after.shuffle,before.shuffle);assert.equal(report.rpc.length,rpc);
  return {nativeAudio:true,sameAudio:true,sourceStable:true,queueStable:true,modesStable:true,positionAdvanced:true,newPlayCalls:0,newTelegram:0,metadataRequests:api.requests.length};
 });
 await group('27 opening album cards never queries Telegram and only a track starts playback',async()=>{
  await fresh();await env.ready();env.fixture.set({mode:'download-option'});
  const before=report.rpc.length;await input().fill('MUSIC_FLOW Album');
  await page().waitForFunction(()=>MUSIC_FLOW.panel().suggestions.some(row=>row.kind==='album')&&!MUSIC_FLOW.panel().suggestionsPending);
  await panel().locator('.music-search-dropdown [data-catalog-kind="album"]').first().click();
  await page().getByText('1 pistas · 1 discos',{exact:false}).waitFor();await idle();
  assert.equal(report.rpc.length,before,'Opening the quick album card must be metadata-only');
  assert.equal(await page().evaluate(()=>MUSIC_FLOW.playCalls),0);
  await button('Volver a búsqueda').click();await input().press('Enter');
  await panel().locator('.music-search-catalog [data-catalog-kind="album"]').first().click();
  await page().getByText('1 pistas · 1 discos',{exact:false}).waitFor();await idle();
  assert.equal(report.rpc.length,before,'Opening the results album card must be metadata-only');
  assert.equal(await page().evaluate(()=>MUSIC_FLOW.playCalls),0);
  const searches=report.rpc.filter(r=>r.method==='messages.sendMessage').length;
  const callbacks=report.rpc.filter(r=>r.method==='messages.getBotCallbackAnswer').length;
  await page().locator('.album-page ol li button').first().click();await env.playing();await idle();
  assert.equal(report.rpc.filter(r=>r.method==='messages.sendMessage').length,searches+1);
  assert.equal(report.rpc.filter(r=>r.method==='messages.getBotCallbackAnswer').length,callbacks+1);
  const data=await env.state();assert.equal(data.assets.length,1);
  assert(data.settings.some(row=>row?.trackId===data.tracks[0].id&&row.added===false));
  return {quickAlbumOpenRpc:0,resultsAlbumOpenRpc:0,playBeforeTrack:0,explicitTrackSearch:1,explicitTrackCallback:1,oneAsset:true,automaticLibraryAdd:false};
 });

 await group('28 unified suggestions and explicit selection remain metadata only',async()=>{
  await fresh();await env.ready();env.fixture.set({mode:'download-option'});const before=report.rpc.length;
  await input().fill('MUSIC_FLOW Album');
  await page().waitForFunction(()=>{const p=MUSIC_FLOW.panel();return ['track','album','artist'].every(k=>p.suggestions.some(r=>r.kind===k))&&!p.suggestionsPending;},{timeout:20000});
  for(const kind of ['track','album','artist'])assert((await panel().locator('.music-search-dropdown [data-catalog-kind="'+kind+'"]').count())>=1);
  assert((await panel().locator('.music-search-dropdown [data-catalog-kind]').count())<=6);
  assert.equal(await panel().getByRole('button',{name:/Buscar álbumes|Buscar artistas|Cancelar búsqueda/}).count(),0);
  await input().press('Enter');for(const kind of ['track','album','artist'])assert(await panel().locator('.music-search-catalog [data-catalog-kind="'+kind+'"]').count());
  assert.equal(report.rpc.length,before);await panel().locator('.music-search-catalog [data-catalog-kind="album"][data-suggestion-id="itunes:album:42"]').click();
  await page().getByText('1 pistas · 1 discos',{exact:false}).waitFor();assert.equal(report.rpc.length,before);
  await button('Volver a búsqueda').click();await panel().locator('.music-search-catalog [data-catalog-kind="artist"]').click();
  await heading().waitFor();assert.equal(report.rpc.length,before);await button('Volver a búsqueda').click();
  const n=report.rpc.filter(r=>r.method==='messages.sendMessage').length;await panel().locator('.music-search-catalog [data-catalog-kind="track"]').first().click();await env.playing();await idle();
  assert.equal(report.rpc.filter(r=>r.method==='messages.sendMessage').length,n+1);
  return {threeCategories:true,enterRpc:0,albumRpc:0,artistRpc:0,selectedSongQueries:1};
 });

 await group('29 clearing rejects held metadata and stale callbacks without duplicate dispatch',async()=>{
  await fresh();await env.ready();const before=report.rpc.length;let release,started=0;
  await context().route('https://itunes.apple.com/**',async route=>{started++;await new Promise(r=>{release=r;});await route.fulfill({status:200,headers:{'access-control-allow-origin':env.origin,'content-type':'application/json'},body:JSON.stringify({resultCount:1,results:[{wrapperType:'collection',collectionType:'Album',collectionId:99,collectionName:'Obsolete',artistName:'MUSIC_FLOW Artist',trackCount:1}]})}).catch(()=>{});});
  await input().fill('MUSIC_FLOW Album');await waitUntil(()=>started===1);await page().waitForFunction(()=>MUSIC_FLOW.panel().suggestions.some(r=>r.kind==='track'));
  await input().press('Enter');await input().press('Enter');assert.equal(started,1);
  await page().evaluate(()=>{const el=document.querySelector('.music-search-catalog [data-catalog-kind="track"]');const k=Object.keys(el).find(x=>x.startsWith('__reactProps$'));MUSIC_FLOW.saved.staleClick=el[k].onClick;MUSIC_FLOW.saved.staleElement=el;});
  await input().fill('');release();await page().evaluate(()=>MUSIC_FLOW.saved.staleClick({currentTarget:MUSIC_FLOW.saved.staleElement}));
  await page().waitForTimeout(500);assert.equal(await panel().locator('[data-suggestion-id]').count(),0);assert.equal(await panel().locator('.music-search-catalog').count(),0);assert.equal(started,1);assert.equal(report.rpc.length,before);
  return {heldResponseDiscarded:true,staleCallbackRejected:true,enterDidNotDuplicate:true,telegram:0};
 });
 await group('30 unified navigation keeps audio queue and responsive layout',async()=>{
  await pipeline('download-option');const before=await page().evaluate(()=>({audio:MUSIC_FLOW.audio[0].src,time:MUSIC_FLOW.audio[0].currentTime,plays:MUSIC_FLOW.playCalls,queue:document.querySelector('#player > ol').textContent}));const rpc=report.rpc.length;
  await page().setViewportSize({width:320,height:568});await page().evaluate(()=>{document.documentElement.style.fontSize='200%';});
  await input().fill('MUSIC_FLOW Album');await page().waitForFunction(()=>MUSIC_FLOW.panel().suggestions.some(r=>r.kind==='artist')&&!MUSIC_FLOW.panel().suggestionsPending);await input().press('Enter');
  assert(await noHorizontalOverflow());await panel().locator('.music-search-catalog [data-catalog-kind="artist"]').click();await heading().waitFor();await button('Volver a búsqueda').click();
  await page().setViewportSize({width:568,height:320});assert(await noHorizontalOverflow());
  const after=await page().evaluate(()=>({audio:MUSIC_FLOW.audio[0].src,time:MUSIC_FLOW.audio[0].currentTime,paused:MUSIC_FLOW.audio[0].paused,plays:MUSIC_FLOW.playCalls,queue:document.querySelector('#player > ol').textContent}));
  assert.equal(after.audio,before.audio);assert(after.time>before.time);assert.equal(after.paused,false);assert.equal(after.plays,before.plays);assert.equal(after.queue,before.queue);assert.equal(report.rpc.length,rpc);
  return {audioContinues:true,queuePreserved:true,newTelegram:0,widths:[320,568],text:'200%'};
 });

 await group('31 pending artists resume after album navigation without losing known rows',async()=>{
  await fresh();await env.ready();const rpc=report.rpc.length;let firstRelease,artistRequests=0;
  await context().route('https://itunes.apple.com/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname!=='/search'||url.searchParams.get('entity')!=='musicArtist')return route.fallback();
   artistRequests++;
   const first=artistRequests===1;
   if(first)await new Promise(resolve=>{firstRelease=resolve;});
   const results=[{wrapperType:'artist',artistId:first?999:2,artistName:first?'Obsolete artist':artistName}];
   await route.fulfill({status:200,headers:{'access-control-allow-origin':env.origin,'content-type':'application/json'},body:JSON.stringify({resultCount:1,results})}).catch(()=>{});
  });
  await input().fill('MUSIC_FLOW Album');
  await waitUntil(()=>artistRequests===1&&!!firstRelease);
  await page().waitForFunction(()=>{const s=MUSIC_FLOW.panel().suggestions;return s.some(r=>r.kind==='album')&&s.some(r=>r.kind==='track');});
  await input().press('Enter');
  const rows=()=>panel().locator('.music-search-catalog [data-catalog-kind]');
  const known=await rows().evaluateAll(els=>els.map(e=>e.getAttribute('data-suggestion-id')).sort());
  assert(known.some(x=>x.startsWith('itunes:album:')));assert(known.some(x=>x.startsWith('lrclib:')));
  await panel().locator('.music-search-catalog [data-catalog-kind="album"]').first().click();
  await page().getByText('1 pistas · 1 discos',{exact:false}).waitFor();
  firstRelease();await button('Volver a búsqueda').click();
  const restored=await rows().evaluateAll(els=>els.map(e=>e.getAttribute('data-suggestion-id')));
  for(const id of known)assert(restored.includes(id),'Known row lost on return: '+id);
  await panel().locator('.music-search-catalog [data-catalog-kind="artist"]').filter({hasText:artistName}).waitFor();
  assert(artistRequests>=2);assert.equal(await panel().getByText('Obsolete artist').count(),0);
  const final=await rows().evaluateAll(els=>els.map(e=>e.getAttribute('data-suggestion-id')));
  for(const id of known)assert(final.includes(id),'Known row lost after completion: '+id);
  assert.equal(report.rpc.length,rpc);
  return {heldNativeArtist:true,albumOpenedBeforeArtist:true,knownRowsPreserved:true,validArtistCompleted:true,obsoleteArtistAbsent:true,telegram:0,artistRequests};
 });

 await group('32 LRCLIB error clears on successful return while known catalogue rows survive',async()=>{
  await fresh();const rpc=report.rpc.length;let healthy=false,failures=0,successes=0;
  await context().route('https://lrclib.net/api/v2/search**',async route=>{
   const headers={'access-control-allow-origin':env.origin,'access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Lrclib-Client','content-type':'application/json'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   if(!healthy){failures++;return route.fulfill({status:500,headers,body:''});}
   successes++;return route.fulfill({status:200,headers,body:JSON.stringify([{id:321,trackName:'MUSIC_FLOW Recovered Song',artistName,albumName:'MUSIC_FLOW Album',duration:45}])});
  });
  await input().fill('MUSIC_FLOW Album');
  await page().waitForFunction(()=>{const p=MUSIC_FLOW.panel();return !p.suggestionsPending&&!!p.suggestionsError&&['album','artist'].every(k=>p.suggestions.some(r=>r.kind===k));});
  assert.equal(failures,1);await input().press('Enter');
  const rows=()=>panel().locator('.music-search-catalog [data-catalog-kind]');
  const error=panel().getByRole('alert').filter({hasText:'No se pudieron obtener sugerencias'});await error.waitFor();
  const known=await rows().evaluateAll(els=>els.map(e=>e.getAttribute('data-suggestion-id')));
  assert(known.some(id=>id.startsWith('itunes:album:')));assert(known.some(id=>id.startsWith('itunes:artist:')));
  assert.equal(await panel().locator('.music-search-catalog [data-catalog-kind="track"]').count(),0);
  await panel().locator('.music-search-catalog [data-catalog-kind="album"]').first().click();
  await page().getByText('1 pistas · 1 discos',{exact:false}).waitFor();healthy=true;
  await button('Volver a búsqueda').click();
  await panel().locator('.music-search-catalog [data-catalog-kind="track"]').filter({hasText:'MUSIC_FLOW Recovered Song'}).waitFor();
  await page().waitForFunction(()=>!MUSIC_FLOW.panel().suggestionsPending);
  const final=await rows().evaluateAll(els=>els.map(e=>e.getAttribute('data-suggestion-id')));
  for(const id of known)assert(final.includes(id),'Known row lost after recovery: '+id);
  assert.equal(await error.count(),0);assert(successes>=1);assert.equal(report.rpc.length,rpc);
  return {initialHttp500:true,partialAlbumAndArtist:true,initialErrorVisible:true,recoveredTrack:true,knownRowsPreserved:true,oldErrorCleared:true,telegram:0,failures,successes};
 });

 async function resolutionRoutes(mode='ok') {
  const state={requests:[],held:[],mode};
  const album={wrapperType:'collection',collectionType:'Album',collectionId:771,collectionName:'MUSIC_FLOW Album',artistId:72,artistName,trackCount:17};
  await context().route('https://itunes.apple.com/**',async route=>{
   const u=new URL(route.request().url()),entity=u.searchParams.get('entity'),term=u.searchParams.get('term'),id=Number(u.searchParams.get('id'));
   state.requests.push({path:u.pathname,entity,term,id});
   let results=[];
   if(u.pathname==='/search'&&entity==='musicArtist'){
    if(term===artistName){if(mode==='rate')return route.fulfill({status:429,headers:{'access-control-allow-origin':env.origin},body:''});results=mode==='missing'?[]:mode==='ambiguous'?[{wrapperType:'artist',artistId:72,artistName},{wrapperType:'artist',artistId:73,artistName}]:[{wrapperType:'artist',artistId:72,artistName}];}
   }else if(u.pathname==='/search'&&entity==='album')results=mode==='concrete'?[album]:[];
   else if(entity==='album')results=[{wrapperType:'artist',artistId:72,artistName},album,{...album,collectionId:772,artistName:artistName+', Guest'}];
   else if(entity==='song')results=[album,...Array.from({length:17},(_,i)=>({wrapperType:'track',kind:'song',collectionId:771,trackId:900+i,artistId:72,discNumber:1,discCount:1,trackNumber:17-i,trackCount:17,trackName:'Fixture track '+(17-i),artistName}))];
   const send=()=>route.fulfill({status:200,headers:{'access-control-allow-origin':env.origin,'content-type':'application/json'},body:JSON.stringify({resultCount:results.length,results})});
   if(mode==='hold'&&u.pathname==='/lookup'&&entity==='album'){state.held.push(send);return;}
   await send().catch(()=>{});
  });
  state.release=async()=>{for(const send of state.held.splice(0))await send().catch(()=>{});};
  return state;
 }
 async function selectAlbum(){await input().fill('MUSIC_FLOW Album');await page().waitForFunction(()=>MUSIC_FLOW.panel().suggestions.some(x=>x.kind==='album')&&!MUSIC_FLOW.panel().suggestionsPending,{timeout:20000});await input().press('Enter');await panel().locator('.music-search-catalog [data-catalog-kind="album"]').first().click();}
 await group('33 inferred album resolves unique artist and ordered 17 tracks without bot or play',async()=>{
  await fresh();await env.ready();const api=await resolutionRoutes(),rpc=report.rpc.length;await selectAlbum();await page().getByText('17 pistas · 1 discos',{exact:false}).waitFor({timeout:30000});
  const tracks=await page().locator('.album-page ol li button strong').allTextContents();assert.deepEqual(tracks,Array.from({length:17},(_,i)=>'Fixture track '+(i+1)));
  assert.equal(api.requests.filter(x=>x.path==='/lookup'&&x.entity==='album').length,1);assert.equal(api.requests.filter(x=>x.path==='/search'&&x.entity==='musicArtist'&&x.term===artistName).length,1);assert.deepEqual(api.requests.filter(x=>x.entity==='song').map(x=>x.id),[771]);assert.equal(report.rpc.length,rpc);assert.equal(await page().evaluate(()=>MUSIC_FLOW.playCalls),0);return {tracks:17,artistLookup:1,albumLookup:1,telegram:0,play:0};
 });
 await group('34 concrete edition opens by ID without new search',async()=>{
  await fresh();await env.ready();const api=await resolutionRoutes('concrete'),rpc=report.rpc.length;await input().fill('MUSIC_FLOW Album');await page().waitForFunction(()=>MUSIC_FLOW.panel().suggestions.some(x=>x.id==='itunes:album:771')&&!MUSIC_FLOW.panel().suggestionsPending,{timeout:20000});await input().press('Enter');const before=api.requests.length;await panel().locator('.music-search-catalog [data-catalog-kind="album"]').click();await page().getByText('17 pistas · 1 discos',{exact:false}).waitFor({timeout:30000});assert.deepEqual(api.requests.slice(before).map(x=>[x.path,x.entity,x.id]),[['/lookup','song',771]]);assert.equal(report.rpc.length,rpc);return {directId:771,extraSearch:0,telegram:0};
 });
 await group('35 Back and scope loss reject held artist releases',async()=>{
  for(const action of ['back','scope']){await fresh();const api=await resolutionRoutes('hold'),rpc=report.rpc.length;await selectAlbum();await waitUntil(()=>api.held.length===1);if(action==='back')await button('Volver a búsqueda').click();else {await nav('Inicio').click();await page().evaluate(()=>dispatchEvent(new Event('pagehide')));}await api.release();await page().waitForTimeout(400);assert.equal(api.requests.filter(x=>x.entity==='song').length,0);assert.equal(await page().locator('.album-page:visible ol li').count(),0);assert.equal(report.rpc.length,rpc);}return {back:true,scope:true,lateDispatch:0,telegram:0};
 });
 await group('36 absent ambiguous and rate-limited artist remain honest without bot',async()=>{
  const cases=[];for(const mode of ['missing','ambiguous','rate']){await fresh();const api=await resolutionRoutes(mode),rpc=report.rpc.length;await selectAlbum();await page().getByText(mode==='rate'?'No se pudo consultar el catálogo de álbumes.':'No se encontraron ediciones compatibles en los resultados disponibles.',{exact:true}).waitFor({timeout:30000});assert.equal(api.requests.filter(x=>x.path==='/lookup').length,0);assert.equal(report.rpc.length,rpc);assert.equal(await page().evaluate(()=>MUSIC_FLOW.playCalls),0);cases.push(mode);}return {cases,lookup:0,telegram:0,play:0};
 });

}
