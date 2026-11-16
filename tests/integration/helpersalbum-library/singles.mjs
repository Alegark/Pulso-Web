import assert from 'node:assert/strict';
export async function runSingleGroups(e){
 const {group,fresh,ready,idle,input,panel,button,playing,state,observe,sends,callbacks,fixture,report,origin}=e;
 const title='MUSIC_FLOW Song (Live version)';
 const collection={wrapperType:'collection',collectionType:'Album',collectionId:42,collectionName:'MUSIC_FLOW Album',artistName:'MUSIC_FLOW Artist',trackCount:1};
 const track={wrapperType:'track',kind:'song',collectionId:42,collectionName:'MUSIC_FLOW Album',trackId:81,discNumber:1,discCount:1,trackNumber:1,trackCount:1,trackName:title,artistName:'MUSIC_FLOW Artist',trackTimeMillis:45000};
 async function routes({hold=false,contradict=false,batch=false,searchTitle=null}={}){
  const data={requests:[],held:[],hold};
  await e.context().route('https://itunes.apple.com/**',async route=>{
   const url=new URL(route.request().url()),entity=url.searchParams.get('entity');data.requests.push({path:url.pathname,entity});
   let results=entity==='musicArtist'?[{wrapperType:'artist',artistId:2,artistName:'MUSIC_FLOW Artist'}]:entity==='song'?(url.pathname==='/search'?(batch?[track]:[]):contradict?[{...collection,trackCount:2},{...track,trackCount:2},{...track,trackId:82,trackName:'MUSIC_FLOW Second',trackNumber:2,trackCount:2}]:[collection,track]):[searchTitle?{...collection,collectionName:searchTitle}:collection];
   const send=()=>route.fulfill({status:200,headers:{'access-control-allow-origin':origin,'content-type':'application/json'},body:JSON.stringify({resultCount:results.length,results})});
   if(data.hold&&url.pathname==='/lookup'&&entity==='song'){data.held.push(send);return;}
   await send();
  });
  data.release=async()=>{for(const send of data.held.splice(0))await send().catch(()=>{});};return data;
 }
 const wait=async(fn)=>{const until=Date.now()+20000;while(!fn()){assert(Date.now()<until,'single route barrier');await new Promise(r=>setTimeout(r,20));}};
 async function search(query='MUSIC_FLOW Album'){await input().fill(query);await e.page().waitForFunction(()=>MUSIC_FLOW.panel().suggestions.some(x=>x.id==='single-edition:42')&&!MUSIC_FLOW.panel().suggestionsPending);}
 const pending=()=>panel().locator('[data-suggestion-id="single-edition:42"]');
 await group('51 single filters and resolved cached recording reuse without RPC or restart',async()=>{
  await fresh({singleAlias:true});e.setMetaRows([]);const api=await routes({searchTitle:'MUSIC_FLOW Single'});const rpc=report.rpc.length;await search('MUSIC_FLOW Single');
  assert.equal(await panel().locator('[data-catalog-kind="album"]').count(),0);assert.equal(api.requests.filter(r=>r.path==='/lookup').length,0);
  await button('Canciones').click();assert.equal(await pending().count(),1);await button('Álbumes').click();assert.equal(await pending().count(),0);await button('Todo').click();await pending().click();await playing();await idle();
  const first=await observe(),before=await state();assert(first.panel.chosen==='itunes:42:1:1:81');assert.equal(report.rpc.length,rpc);assert.equal(before.assets.length,1);
  const audio=first.audio[0],calls=await e.page().evaluate(()=>MUSIC_FLOW.playCalls);await input().fill('MUSIC_FLOW Song');await input().fill('MUSIC_FLOW Album');await e.page().waitForFunction(()=>MUSIC_FLOW.panel().suggestions.some(x=>x.kind==='track'&&x.source==='local'));
  const rows=(await observe()).panel.suggestions.filter(r=>r.kind==='track');assert.equal(rows.length,1);await panel().locator(`[data-suggestion-id="${rows[0].id}"]`).click();await e.page().waitForTimeout(250);
  assert.equal((await observe()).audio[0].src,audio.src);assert((await observe()).audio[0].time>=audio.time);assert.equal(await e.page().evaluate(()=>MUSIC_FLOW.playCalls),calls);assert.equal(report.rpc.length,rpc);assert.deepEqual((await state()).assets,before.assets);
  return {filters:['Todo','Canciones','Álbumes'],realId:first.panel.chosen,rpc:0,noRestart:true,assets:1,lookupRequests:api.requests.filter(r=>r.path==='/lookup').length};
 });
 await group('52 explicit pending single downloads one real recording with one send callback import and play',async()=>{
  await fresh({idb:process.env.MUSIC_FLOW_SINGLE_IDB==='1'});await ready();e.setMetaRows([]);const api=await routes();fixture.set({mode:'download-option'});await search();const n=sends(),c=callbacks(),plays=await e.page().evaluate(()=>MUSIC_FLOW.playCalls);assert.equal(api.requests.filter(r=>r.path==='/lookup').length,0);
  await pending().click();
  if(process.env.MUSIC_FLOW_EXPECT_OPFS_UNAVAILABLE==='1'){
   await panel().getByText('No se pudo guardar la canción.',{exact:true}).waitFor();await idle();const saved=await state(),observed=await observe();assert.equal(saved.assets.length,0);assert.equal(saved.tracks.length,0);assert.equal(sends()-n,1);assert.equal(callbacks()-c,1);assert.equal(await e.page().evaluate(()=>MUSIC_FLOW.playCalls)-plays,0);assert.equal(observed.audio.length,1);assert(observed.audio[0].paused);const error=observed.workers.flatMap(w=>w.received).find(r=>r.type==='error'&&r.outcome?.primary?.backend==='opfs');assert.equal(error.outcome.primary.phase,'open');assert.equal(error.outcome.writeState,'not-started');return {expectedUnavailable:true,assets:0,tracks:0,playCalls:0,sends:1,callbacks:1,outcome:error.outcome};
  }
  await playing();await idle();const saved=await state();assert.equal(sends()-n,1);assert.equal(callbacks()-c,1);assert.equal(saved.assets.length,1);assert.equal(saved.assets[0].backend,process.env.MUSIC_FLOW_SINGLE_IDB==='1'?'idb':'opfs');assert.equal(saved.tracks.length,1);assert.equal(saved.tracks[0].title,title);assert.equal((await observe()).panel.chosen,'itunes:42:1:1:81');assert.equal(await e.page().evaluate(()=>MUSIC_FLOW.playCalls)-plays,1);assert.equal(await e.page().locator('.album-page').count(),0);
  return {sends:1,callbacks:1,imports:saved.assets.length,backend:saved.assets[0].backend,playCalls:1,title:saved.tracks[0].title,sha256:saved.assets[0].sha256};
 });
 await group('53 pending single cancellation and query change reject late metadata without Telegram or playback',async()=>{
  const outcomes=[];
  for(const action of ['cancel','edit','hide','playback']){
   await fresh(action==='playback'?{singleAlias:true}:{});await ready();e.setMetaRows([]);const api=await routes({hold:action!=='playback',searchTitle:action==='playback'?'MUSIC_FLOW Single':null});
   if(action==='playback'){await input().fill('MUSIC_FLOW Song');await panel().locator('[data-catalog-kind="track"]').first().click();await playing();api.hold=true;}
   await search(action==='playback'?'MUSIC_FLOW Single':'MUSIC_FLOW Album');const rpc=report.rpc.length,plays=await e.page().evaluate(()=>MUSIC_FLOW.playCalls);await pending().evaluate(el=>{const k=Object.keys(el).find(k=>k.startsWith('__reactProps$'));MUSIC_FLOW.saved.singleClick=el[k].onClick;});
   await pending().click();await wait(()=>api.held.length===1);if(report.readinessProbe&&action!=='playback')assert.equal(await e.page().evaluate(()=>globalThis.__MUSIC_FLOWupdateWorkPending()),true,'pending single must block automatic updates');await e.page().evaluate(()=>{const fn=MUSIC_FLOW.saved.singleClick;fn({currentTarget:document.body});fn({currentTarget:document.body});});assert.equal(api.held.length,1);
   if(action==='cancel')await button('Cancelar consulta').click();else if(action==='edit')await input().fill('Another Query');else if(action==='hide')await e.nav('Inicio').click();else await button('Pausar desde minirreproductor').click();
   await api.release();await e.page().waitForTimeout(300);if(report.readinessProbe&&action!=='playback')assert.equal(await e.page().evaluate(()=>globalThis.__MUSIC_FLOWupdateWorkPending()),false,'cancelled single releases update blocker');assert.equal(report.rpc.length,rpc);assert.equal(await e.page().evaluate(()=>MUSIC_FLOW.playCalls),plays);assert.equal((await state()).assets.length,action==='playback'?1:0);if(action==='playback')assert((await observe()).audio[0].paused);outcomes.push(action);
  }
  return {lateMetadataRejected:outcomes,telegram:0,playback:0};
 });
 await group('54 detail count contradiction corrects classification without choosing arbitrary track',async()=>{
  await fresh();await ready();e.setMetaRows([]);await routes({contradict:true});await search();const rpc=report.rpc.length;await pending().click();await e.page().getByText('No se pudo confirmar una única canción. Actualiza las sugerencias para comprobar la edición.',{exact:true}).waitFor();
  await e.page().waitForFunction(()=>MUSIC_FLOW.panel().suggestions.some(x=>x.id==='itunes:album:42'&&x.kind==='album'));assert.equal(report.rpc.length,rpc);assert.equal((await state()).assets.length,0);assert.equal(await e.page().evaluate(()=>MUSIC_FLOW.playCalls),0);return {correctedToAlbum:true,arbitraryTrack:false,telegram:0};
 });
 await group('55 batch single uses actual recording metadata and groups its local copy without album hints',async()=>{
  const outcomes=[];
  for(const cached of [false,true]){
   await fresh(cached?{singleAlias:true}:{});e.setMetaRows([]);const api=await routes({batch:true});await input().fill('MUSIC_FLOW Album');
   await wait(()=>api.requests.some(r=>r.path==='/search'&&r.entity==='song'));
   await e.page().waitForFunction(cached=>MUSIC_FLOW.panel().suggestions.some(r=>cached?r.source==='local':r.id==='itunes:42:1:1:81'),cached);
   const rows=(await observe()).panel.suggestions;assert.equal(rows.filter(r=>r.kind==='track').length,1);assert.equal(rows.filter(r=>r.kind==='album').length,0);assert.equal(rows[0].title,title);assert.equal(rows[0].source,cached?'local':'itunes');assert.equal(api.requests.filter(r=>r.path==='/lookup').length,0);
   outcomes.push({cached,source:rows[0].source,id:rows[0].id,detailRequests:0});
  }
  for(const width of [320,390,1280]){await e.page().setViewportSize({width,height:844});assert(await e.page().evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  return {outcomes,trackRows:1,albumRows:0,widths:[320,390,1280]};
 });
}
