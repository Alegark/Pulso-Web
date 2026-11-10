// Native React/controller browser fixture; all provider responses are synthetic.
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sourcePaths=['src/ui/MusicSearchController.tsx','src/ui/MusicSearchPanel.tsx','src/library/music-search-catalog.ts','src/library/music-suggestions.ts','src/library/album-catalog.ts','src/library/catalog-artwork.ts','tests/integration/music-search-combined-fixture.tsx','tests/integration/music-search-combined.mjs'];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const before=await sourceHashes();
const dir='.local/music-search-combined';await mkdir(dir,{recursive:true});
await writeFile(`${dir}/fixture.html`,'<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/tests/integration/music-search-combined-fixture.tsx"></script>');
await build({configFile:false,logLevel:'error',build:{outDir:`${dir}/build`,emptyOutDir:true,rolldownOptions:{input:`${dir}/fixture.html`}}});
const server=await preview({configFile:false,build:{outDir:`${dir}/build`},preview:{host:'127.0.0.1',port:0,strictPort:true}});
const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
const context=await browser.newContext({serviceWorkers:'block'});let bot=0;const requests=[];let release;
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.origin===origin)return route.continue();
 requests.push(u.href);
 if(u.hostname==='lrclib.net'){
  const q=u.searchParams.get('q');if(q==='Tardía Ejemplo')await new Promise(r=>{release=r;});
  return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify([
   {id:1,trackName:'Canción uno',artistName:'Ejemplo',albumName:'Noche',duration:120},
   {id:2,trackName:'Canción dos',artistName:'Ejemplo',albumName:'Noche',duration:123},
   {id:3,trackName:'Otra',artistName:'Ejemplo',albumName:'Otro',duration:100},
   {id:4,trackName:'Noche',artistName:'Otro',albumName:'Otro',duration:100}])}).catch(()=>{});
 }
 if(u.hostname==='itunes.apple.com'){
  const entity=u.searchParams.get('entity');let rows=[];
  if(entity==='album')rows=[{wrapperType:'collection',collectionType:'Album',collectionId:11,collectionName:'Noche',artistName:'Ejemplo',trackCount:2},{wrapperType:'collection',collectionType:'Album',collectionId:12,collectionName:'Otro',artistName:'Ejemplo',trackCount:2}];
  if(entity==='musicArtist')rows=[{wrapperType:'artist',artistType:'Artist',artistId:21,artistName:'Ejemplo'},{wrapperType:'artist',artistType:'Artist',artistId:22,artistName:'Ejemplo Noche'}];
  return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({resultCount:rows.length,results:rows})});
 }
 bot++;return route.abort();
});
try{
 const page=await context.newPage();page.on('pageerror',e=>console.error(e));page.setDefaultTimeout(5000);await page.goto(`${origin}/${dir}/fixture.html`);
 const input=page.getByLabel('Canción, álbum o artista',{exact:true});
 for(const q of ['Noche Ejemplo','Ejemplo Noche']){
  await input.fill(q);await input.press('Enter');
  await page.locator('[data-suggestion-id="lrclib:1"]').waitFor();await page.locator('[data-suggestion-id="itunes:album:11"]').waitFor();
  assert.equal(await page.locator('[data-suggestion-id="lrclib:2"]').count(),1);
  for(const id of ['lrclib:3','lrclib:4','itunes:album:12','itunes:artist:21'])assert.equal(await page.locator(`[data-suggestion-id="${id}"]`).count(),0,id);
  assert.equal(bot,0);
 }
 await page.locator('[data-suggestion-id="itunes:album:11"]').click();assert.equal(bot,0);
 assert.equal(await page.locator('input[type=search]:visible').count(),0);
 await page.getByRole('button',{name:/Volver/}).first().click();
 await input.fill('Tardía Ejemplo');await page.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,1000));
 assert.ok(release);await input.fill('');release();await new Promise(r=>setTimeout(r,1000));
 assert.equal(await page.locator('[data-suggestion-id]:visible').count(),0);assert.equal(bot,0);
 assert.deepEqual(await sourceHashes(),before);
 const evidence={passed:true,orders:2,enterBotRequests:0,albumNavigationOnly:true,lateCleared:true,providerRequests:requests.length,sources:before,limitations:'Chromium controller fixture with synthetic providers and null Telegram client; not physical iPhone or live providers.'};
 await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await context.close();await browser.close();await new Promise(r=>server.httpServer.close(r));}
