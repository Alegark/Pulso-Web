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

}
