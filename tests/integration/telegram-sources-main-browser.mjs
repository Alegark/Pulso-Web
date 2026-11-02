/** R124 browser groups. Each test executes unchanged full MAIN, never component-only.
 * Read-only React props observers capture actual handlers/guards; no root mutators.
 */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
export function rawPage({folder=0,ids=[1,2,3],empty=false,end=false}={}){
 const list=empty?[90]:ids;
 return {raw:{_ :end?'messages.dialogs':'messages.dialogsSlice',dialogs:list.map(id=>({_:'dialog',peer:empty?{_:'peerUser',userId:id}:id>=4&&id<=6?{_:'peerChannel',channelId:id}:{_:'peerChat',chatId:id},topMessage:id+100,folderId:folder})),chats:empty?[]:list.map((id,i)=>({...((id>=4&&id<=6)?{_:'channel',accessHash:'124',broadcast:id===4,megagroup:id===5,gigagroup:id===6}:{_:'chat'}),id,title:id===1?'<img src=x onerror=alert(1)> https://example.invalid/ '+ 'L'.repeat(240):id===2||id===3?'Nombre duplicado':`Grupo ficticio ${id}`})),users:empty?[{_:'user',id:90,self:true}]:[],messages:list.map(id=>({_:'message',id:id+100,peerId:empty?{_:'peerUser',userId:id}:id>=4&&id<=6?{_:'peerChannel',channelId:id}:{_:'peerChat',chatId:id},date:10000+id,message:'R124_INCIDENTAL_NEVER_DOM',media:{_:'messageMediaEmpty'}}))}};
}
function observers(){
 globalThis.R124={workers:[],audio:[],errors:[],csp:[],captures:{}};
 addEventListener('securitypolicyviolation',e=>{R124.csp.push(e.violatedDirective);void globalThis.__R124csp?.(e.violatedDirective);});
 const NativeWorker=Worker;globalThis.Worker=class extends NativeWorker{
  constructor(...args){super(...args);const record={url:String(args[0]),sent:[],received:[],terminated:0};this.R124record=record;R124.workers.push(record);this.addEventListener('message',e=>record.received.push(structuredClone(e.data)));}
  postMessage(value,...args){this.R124record.sent.push(value.protocol==='pulso-sources'?structuredClone(value):{type:value.type,version:value.version});return super.postMessage(value,...args);}
  terminate(){this.R124record.terminated++;return super.terminate();}
 };
 const NativeAudio=Audio;globalThis.Audio=function(...args){const a=new NativeAudio(...args);R124.audio.push(a);return a;};globalThis.Audio.prototype=NativeAudio.prototype;
 // Find committed React tree through its native host container; observe only.
 R124.findProps=key=>{
  const el=document.getElementById('root'),k=Object.keys(el).find(k=>k.startsWith('__reactContainer$'));const host=el[k];const root=host.stateNode.current;const stack=[root];
  while(stack.length){const n=stack.pop();if(n.memoizedProps&&Object.hasOwn(n.memoizedProps,key))return n.memoizedProps;if(n.sibling)stack.push(n.sibling);if(n.child)stack.push(n.child);}throw Error('R124 missing real props '+key);
 };
 R124.handler=(selector,event='onClick')=>{const el=document.querySelector(selector);if(!el)throw Error('R124 missing DOM '+selector);return el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))][event];};
 R124.source=()=>R124.findProps('client');
 R124.root=()=>R124.findProps('captureCurrent');
 R124.observe=()=>{const props=R124.root();const s=document.querySelector('.telegram-sources')?R124.source().state:null;return {canConnect:props.canConnect,libraryPending:props.libraryPending,activity:props.activity.count,activityIdle:props.activity.idle,activityResolved:props.activity.resolved,scope:props.scopeKey,state:s?structuredClone(s):null,audio:R124.audio.map(a=>({src:a.src,time:a.currentTime,paused:a.paused,duration:a.duration})),workers:structuredClone(R124.workers)};};
}
export async function runGroups({newContext,origin,fixture,report,run,focus,setContext}){
 let context,page,baseline;
 const button=name=>page.getByRole('button',{name,exact:true});
 const observe=()=>page.evaluate(()=>R124.observe());
 const snap=()=>page.evaluate(async()=>{const {musicalSnapshot}=await import('/__r124/telegram-sources-main-seed.mjs');return musicalSnapshot();});
 const noRPC=()=>fixture.requests.length;
 const until=async(predicate,label,ms=7000)=>{const deadline=Date.now()+ms;while(!predicate()){if(Date.now()>deadline)throw Error('Fixture barrier timeout: '+label);await new Promise(r=>setTimeout(r,20));}};
 const group=async(name,fn)=>{if(focus){const [first,last=first]=focus.split('-').map(Number),n=Number(name.slice(0,2));if(n<first||n>last)return;}report.stage=name;console.log('R124 START '+name);const start=Date.now();try{const detail=await fn();report.groups.push({name,status:'PASS',ms:Date.now()-start,detail:detail??null});console.log('R124 PASS '+name);}catch(e){report.groups.push({name,status:'FAIL',ms:Date.now()-start,error:e.message});if(page&&!page.isClosed()){await import('node:fs/promises').then(async fs=>fs.writeFile(resolve(run,'failure-observation.json'),JSON.stringify(await observe(),null,2))).catch(()=>{});await page.screenshot({path:resolve(run,'failure.png'),fullPage:true}).catch(()=>{});await import('node:fs/promises').then(async fs=>fs.writeFile(resolve(run,'failure-dom.html'),await page.content()));}throw e;}};
 const fresh=async({pending=false}={})=>{
  await context?.close();fixture.set();context=await newContext();setContext(context);await context.exposeBinding('__R124csp',(_source,directive)=>report.csp.push(directive));await context.addInitScript(observers);
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push({page:e.message}));
  await page.goto(origin+'/__r124/seed.html');await page.evaluate(async pending=>{const {seedLibrary}=await import('/__r124/telegram-sources-main-seed.mjs');await seedLibrary({pending});},pending);
  await page.goto(origin+'/');await page.waitForFunction(()=>globalThis.R124?.root().canConnect===true);baseline=await snap();return page;
 };
 const auth=async()=>{
  await page.getByLabel('País y prefijo',{exact:true}).selectOption('US');await page.getByLabel('Número de teléfono',{exact:true}).fill('5550000124');
  await page.locator('.telegram-consent input').check();await button('Enviar código de acceso').click();await page.getByLabel('Código de Telegram',{exact:true}).fill('00000');await button('Confirmar código').click();await page.getByLabel('Contraseña de verificación en dos pasos',{exact:true}).fill('R124_TESTONLY');await button('Verificar contraseña').click();await page.getByRole('heading',{name:'Fuentes de música',exact:true}).waitFor();
  await page.waitForFunction(()=>R124.observe().activity===0);assert.equal((await observe()).canConnect,true);
 };
 const query=async(result=rawPage(),folder='main')=>{fixture.set(result);await button(folder==='main'?'Consultar fuentes':'Consultar archivados').click();await page.waitForFunction(()=>R124.source().state.pending===false);};
 const saveHandler=async(key,name)=>{await button(name).evaluate((el,key)=>{R124.captures[key]=el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onClick;},key);};
 const callHandler=key=>page.evaluate(key=>{R124.captures[key]();},key);
 const captureGuard=key=>page.evaluate(key=>{R124.captures[key]=R124.root().captureCurrent();},key);
 const guard=key=>page.evaluate(key=>R124.captures[key](),key);
 const preserve=async()=>assert.deepEqual(await snap(),baseline,'Musical/config/storage bytes changed during auth/sources');

 await group('01 full MAIN native startup, country/auth callback, binding Saved, zero mount/navigation RPC',async()=>{
  await fresh();const count=noRPC();assert.equal((await observe()).audio.length,1);
  const countries=await page.getByLabel('País y prefijo',{exact:true}).locator('option').count();assert.equal(countries,246);await auth();
  for(const name of ['Biblioteca','Buscar','Inicio'])await page.getByRole('navigation',{name:'Principal'}).getByRole('button',{name,exact:true}).click();
  const o=await observe();assert.equal(noRPC(),count);assert.equal(o.state.rows.length,1);assert.equal(o.state.rows[0].kind,'saved');assert.deepEqual(o.state.selected,[]);assert.equal(o.activity,0);assert.equal(o.canConnect,true);assert(o.state.binding.accountRef);await preserve();
  return {fictionalAuth:true,nativeWorker:true,sourceRPC:0,countries:245,audio:1};
 });
 await group('02 Saved keyboard mark is no ACK; explicit confirmation uses zero dialogs; privacy precedes gesture',async()=>{
  const count=noRPC();const checkbox=page.locator('.telegram-sources input[type=checkbox]');await checkbox.focus();await page.keyboard.press('Space');assert.deepEqual((await observe()).state.selected,[]);
  await button('Usar estas fuentes en esta pestaña').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>R124.source().state.selected.length===1);assert.equal(noRPC(),count);
  const privacy=await page.locator('.telegram-sources').textContent();assert.match(privacy,/mensajes incidentales/);assert.match(privacy,/No indexa ni descarga/);assert.equal(await button('Consultar fuentes').evaluate(b=>!!(b.compareDocumentPosition([...b.closest('section').querySelectorAll('p')].find(p=>p.textContent.includes('mensajes incidentales')))&Node.DOCUMENT_POSITION_PRECEDING)),true);await preserve();
 });
 await group('03 main page gesture once limit25; eligible channels/groups names inert/long/duplicate, fresh clears ACK',async()=>{
  const n=noRPC();const prior=(await observe()).state;await query(rawPage({ids:Array.from({length:24},(_,i)=>i+1)}));const o=await observe();assert.equal(noRPC(),n+1);assert.equal(fixture.events.filter(e=>e.type==='getDialogs').at(-1).limit,25);
  assert.equal(o.state.rows.length,25);assert(o.state.rows.some(r=>r.kind==='channel'));assert(o.state.rows.some(r=>r.kind==='supergroup'));assert(o.state.rows.some(r=>r.kind==='gigagroup'));assert.deepEqual(o.state.selected,[]);assert.equal(o.state.listEpoch,prior.listEpoch+1);assert.notEqual(o.state.operationId,prior.operationId);assert.notEqual(o.state.rows[0].peerRef,prior.rows[0].peerRef);
  assert.equal(await page.locator('.telegram-sources img,.telegram-sources a').count(),0);assert.equal(await page.getByText('R124_INCIDENTAL_NEVER_DOM',{exact:false}).count(),0);assert.equal(o.state.rows[1].name.length,160);assert.equal(o.state.rows[2].name,o.state.rows[3].name);assert.notEqual(o.state.rows[2].peerRef,o.state.rows[3].peerRef);assert.equal(await page.locator('.telegram-sources bdi').nth(1).getAttribute('dir'),'auto');await preserve();
 });
 await group('04 max20 drafts, explicit ACK only, clear, stale old list callbacks cannot act',async()=>{
  const n=noRPC();await saveHandler('oldList','Consultar fuentes');const boxes=page.locator('.telegram-sources input[type=checkbox]');for(let i=0;i<20;i++)await boxes.nth(i).check();assert.equal(await boxes.nth(20).isDisabled(),true);assert.deepEqual((await observe()).state.selected,[]);
  await button('Usar estas fuentes en esta pestaña').click();await page.waitForFunction(()=>R124.source().state.selected.length===20);await button('Quitar selección').click();await page.waitForFunction(()=>R124.source().state.selected.length===0);assert.equal(noRPC(),n);await callHandler('oldList');assert.equal(noRPC(),n);await preserve();
 });
 await group('05 zero candidates still continuation; dedupe across pages; archive separate explicit gesture',async()=>{
  let n=noRPC();await query(rawPage({empty:true}));assert.equal((await observe()).state.rows.length,1);assert.equal((await observe()).state.end,'more');assert.equal(noRPC(),++n);
  fixture.set(rawPage({ids:[1,2]}));await button('Ver más').click();await page.waitForFunction(()=>!R124.source().state.pending);assert.equal(noRPC(),++n);assert.equal((await observe()).state.rows.length,3);
  fixture.set(rawPage({ids:[2,3],end:true}));await button('Ver más').click();await page.waitForFunction(()=>!R124.source().state.pending);assert.equal(noRPC(),++n);assert.equal((await observe()).state.rows.length,4);assert.equal((await observe()).state.end,'exhausted');
  await query(rawPage({folder:1,end:true,ids:[7]}),'archived');assert.equal(noRPC(),++n);assert.equal(fixture.events.filter(e=>e.type==='getDialogs').at(-1).folderId,1);assert.equal((await observe()).state.folder,'archived');assert.deepEqual((await observe()).state.selected,[]);await preserve();
 });
 await group('06 cancel ACK retains exact real Activity until late success settles; stale cancel cannot stop new read',async()=>{
  const n=noRPC();fixture.set({hold:true});await button('Consultar fuentes').click();await until(()=>fixture.requests.length===n+1,'pending getDialogs');await saveHandler('oldCancel','Detener consulta');await button('Detener consulta').click();
  await page.waitForFunction(()=>R124.workers.some(w=>w.received.some(r=>r.reply?.type==='sources.cancelled')));let o=await observe();assert.equal(o.activity,1);assert.equal(o.state.pending,true);assert.equal(o.canConnect,true);assert.equal(noRPC(),n+1);
  fixture.release(rawPage());await page.waitForFunction(()=>!R124.source().state.pending);o=await observe();assert.equal(o.activity,0);assert.equal(o.state.error,'cancelled');assert.equal(o.state.rows.length,1);await preserve();
  fixture.set({hold:true});await button('Consultar fuentes').click();await until(()=>fixture.requests.length===n+2,'new pending getDialogs');const sends=(await observe()).workers.at(-1).sent.length;await callHandler('oldCancel');assert.equal((await observe()).workers.at(-1).sent.length,sends);fixture.release(rawPage({end:true}));await page.waitForFunction(()=>!R124.source().state.pending);
 });
 await group('07 ordinary late error preserves binding; cancel→SESSION_REVOKED purges UI binding without remote logout',async()=>{
  const binding=(await observe()).state.binding;let n=noRPC();fixture.set({hold:true});await button('Consultar fuentes').click();await until(()=>fixture.requests.length===n+1,'ordinary pending');await button('Detener consulta').click();fixture.release({error:{errorMessage:'NETWORK_TESTONLY'}});await page.waitForFunction(()=>!R124.source().state.pending);assert.deepEqual((await observe()).state.binding,binding);assert.equal((await observe()).state.error,'cancelled');
  const logout=fixture.events.filter(e=>e.type==='logout').length;n=noRPC();fixture.set({hold:true});await button('Consultar fuentes').click();await until(()=>fixture.requests.length===n+1,'terminal pending');await button('Detener consulta').click();await page.waitForFunction(()=>R124.workers.at(-1).received.some(r=>r.reply?.type==='sources.cancelled'&&r.reply.targetRequestId===R124.workers.at(-1).sent.filter(c=>c.type==='sources.page').at(-1).requestId));fixture.release({error:{errorMessage:'SESSION_REVOKED'}});await page.locator('.telegram-sources').waitFor({state:'detached'});assert.equal((await observe()).activity,0);assert.equal(fixture.events.filter(e=>e.type==='logout').length,logout);await preserve();
  return {R122LateTerminal:true,realWorker:true};
 });
 await group('08 FLOOD_WAIT 48h preserved first cause, no timer retry or fresh bypass',async()=>{
  await auth();let n=noRPC();const aborts=fixture.events.filter(e=>e.type==='read-abort').length;fixture.set({hold:true});await button('Consultar fuentes').click();await until(()=>fixture.events.filter(e=>e.type==='read-abort').length>aborts,'native core timeout15s',18000);fixture.release({error:{errorMessage:'NETWORK_TESTONLY_LATE'}});await page.waitForFunction(()=>!R124.source().state.pending);assert.equal((await observe()).state.error,'timeout');assert.equal((await observe()).activity,0);assert.equal(noRPC(),n+1);n=noRPC();const start=Date.now();await query({error:{errorMessage:'FLOOD_PREMIUM_WAIT_172800'}});const o=await observe();assert.equal(o.state.error,'rate-limit');assert(o.state.retryAt>=start+172800000);assert.equal(await button('Consultar fuentes').isDisabled(),true);assert.equal(await button('Consultar archivados').isDisabled(),true);await saveHandler('floodButton','Consultar fuentes');await callHandler('floodButton');assert.equal(noRPC(),n+1);await preserve();
 });
 await group('09 native audio/queue/modes/seek and preferences survive auth/list/select; paused audio permits connection',async()=>{
  await fresh();await page.getByRole('navigation',{name:'Principal'}).getByRole('button',{name:'Biblioteca',exact:true}).click();await button('Preparar cola de esta selección').click();await page.waitForFunction(()=>R124.audio[0]?.src&&Number.isFinite(R124.audio[0].duration));await button('Pausar').click();await page.getByLabel(/^Repetición/).selectOption('all');await button('Aleatorio').click();await page.getByLabel('Posición en segundos',{exact:true}).fill('4');
  await page.waitForFunction(()=>R124.observe().activity===0);const audio=await page.evaluate(()=>{R124.captures.audio=R124.audio[0];return {src:R124.audio[0].src,time:R124.audio[0].currentTime,paused:R124.audio[0].paused};});assert.equal(audio.paused,true);assert.equal((await observe()).canConnect,true);baseline=await snap();
  await auth();await query(rawPage({end:true}));await page.locator('.telegram-sources input[type=checkbox]').first().check();await button('Usar estas fuentes en esta pestaña').click();await page.waitForFunction(()=>R124.source().state.selected.length===1);assert.equal(await page.evaluate(()=>R124.audio.length===1&&R124.audio[0]===R124.captures.audio&&R124.audio[0].paused),true);assert.equal((await observe()).audio[0].src,audio.src);assert(Math.abs((await observe()).audio[0].time-audio.time)<0.2);assert.equal(await page.getByLabel(/^Repetición/).inputValue(),'all');assert.equal(await button('Aleatorio').getAttribute('aria-pressed'),'true');await preserve();
  return {nativeAudio:true,nativeIDB:true,nativeOPFS:true,SW:'product SW, local transport only; no offline matrix'};
 });
 await group('10 root sourceReview reservation→release denies captured React guard permanently; no musical writes',async()=>{
  // Independent fresh native seed; no previous player/queue/resource state.
  await fresh();await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{type:'module'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
  await auth();await page.getByRole('navigation',{name:'Principal'}).getByRole('button',{name:'Biblioteca',exact:true}).click();assert.equal((await observe()).activityIdle,true);assert.equal((await observe()).activityResolved,true);assert.equal(await page.evaluate(()=>!!R124.audio[0].getAttribute('src')),false);
  for(const artwork of await page.locator('.tracks .artwork-panel').all()){await artwork.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.waitForFunction(()=>R124.root().activity.idle);}
  await button('Revisar retirada de R124 tono WAV IDB').scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.waitForFunction(()=>R124.root().activity.idle);baseline=await snap();await captureGuard('beforeReview');await saveHandler('beforeReviewButton','Consultar fuentes');const n=noRPC();
  await button('Revisar retirada de R124 tono WAV IDB').click();await button('Quitar esta copia local').waitFor();assert.equal(await guard('beforeReview'),false);assert.equal((await observe()).canConnect,false);await page.locator('.telegram-sources').waitFor({state:'detached'});
  await button('Conservar copia').click();if(await button('Cerrar revisión').count())await button('Cerrar revisión').click();await page.waitForFunction(()=>R124.root().canConnect);assert.equal(await guard('beforeReview'),false);await callHandler('beforeReviewButton');assert.equal(noRPC(),n);
  // Review's own reservation metadata is allowed; no removal confirmation is sent.
  const after=await snap();for(const key of ['tracks','assets','chunks','playlists'])assert.deepEqual(after.stores[key],baseline.stores[key]);assert.deepEqual(after.opfs,baseline.opfs);
 });
 await group('11 handoff Activity ABA and old callback across remount/new binding denied by native root',async()=>{
  if(!context)await fresh();await auth();await captureGuard('beforeHandoff');await saveHandler('beforeHandoffButton','Consultar fuentes');const binding=(await observe()).state.binding,n=noRPC();await button('Ceder control').click();await page.waitForFunction(()=>R124.root().canConnect===false);assert.equal(await guard('beforeHandoff'),false);await page.locator('.telegram-sources').waitFor({state:'detached'});await button('Comprobar disponible').click();await page.waitForFunction(()=>R124.root().canConnect===true);await auth();assert.notEqual((await observe()).state.binding.accountRef,binding.accountRef);assert.equal(await guard('beforeHandoff'),false);await callHandler('beforeHandoffButton');assert.equal(noRPC(),n);
 });
 await group('12 logout during held read forces local close, no false remote revoke; stop/pagehide cleanup',async()=>{
  const n=noRPC(),logout=fixture.events.filter(e=>e.type==='logout').length;fixture.set({hold:true});await button('Consultar fuentes').click();await until(()=>fixture.requests.length===n+1,'logout read');await button('Cerrar sesión en Telegram').click();await page.locator('.telegram-sources').waitFor({state:'detached'});await page.getByText('Se cerró el acceso local, pero no se confirmó la revocación remota.',{exact:false}).waitFor();assert.equal(fixture.events.filter(e=>e.type==='logout').length,logout);assert.equal((await observe()).activity,0);
  // Fixture barrier is still intentionally pending until exact termination.
  assert.equal((await observe()).workers.at(-1).terminated,1);fixture.finishClosed();await auth();const n2=noRPC();fixture.set({hold:true});await button('Consultar fuentes').click();await until(()=>fixture.requests.length===n2+1,'pagehide read');await page.evaluate(()=>dispatchEvent(new Event('pagehide')));await page.locator('.telegram-sources').waitFor({state:'detached'});assert.equal((await observe()).activity,0);assert.equal((await observe()).workers.at(-1).terminated,1);fixture.finishClosed();
 });
 await group('13 pending library is informative, auth/list keep musical bytes and flags; reload has no sources/session DB',async()=>{
  await fresh({pending:true});assert.equal((await observe()).libraryPending,true);const before=await snap();await auth();await query(rawPage({end:true}));await preserve();assert.equal((await observe()).libraryPending,true);assert.equal(await button('Preparar cola de esta selección').isEnabled(),false);
  await page.reload();await page.waitForFunction(()=>R124.root().canConnect);assert.equal(await page.locator('.telegram-sources').count(),0);assert.equal((await observe()).workers.length,0);const after=await snap();assert.deepEqual(after,before);assert(after.databases.every(d=>d.name==='pulso-web-local-v1'));return {sessionDB:0,reloadAutoAuth:0,sourcesPersisted:false,libraryPendingStillTrue:(await observe()).libraryPending};
 });
 await group('14 keyboard/focus intent and long names layout320/568 with font200 (not real zoom)',async()=>{
  await auth();await query(rawPage());for(const viewport of [{width:320,height:568},{width:568,height:320}]){await page.setViewportSize(viewport);await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(run,`layout-${viewport.width}-font200.png`),fullPage:true});}
  const n=noRPC();fixture.set({hold:true});await button('Consultar archivados').click();await until(()=>fixture.requests.length===n+1,'focus barrier');await page.getByRole('navigation',{name:'Principal'}).getByRole('button',{name:'Inicio',exact:true}).focus();fixture.release(rawPage({folder:1,end:true}));await page.waitForFunction(()=>!R124.source().state.pending);assert.equal(await page.getByRole('navigation',{name:'Principal'}).getByRole('button',{name:'Inicio',exact:true}).evaluate(e=>e===document.activeElement),true);await preserve();
 });
 await group('15 native database schema mismatch root deny, old callback cannot revive; unmount closes worker',async()=>{
  await captureGuard('beforeDB');await saveHandler('beforeDBButton','Consultar fuentes');const before=await snap(),n=noRPC();
  await page.evaluate(async()=>{const req=indexedDB.open('pulso-web-local-v1',3);await new Promise((r,j)=>{req.onsuccess=()=>{req.result.close();r();};req.onerror=()=>j(req.error);});});
  await button('Comprobar archivos locales').click();await page.getByRole('heading',{name:'Es necesario volver a abrir Pulso',exact:true}).waitFor();assert.equal((await observe()).canConnect,false);assert.equal(await guard('beforeDB'),false);await page.locator('.telegram-sources').waitFor({state:'detached'});await callHandler('beforeDBButton');assert.equal(noRPC(),n);
  // Read native v3 without product open helpers, retain original records.
  const after=await page.evaluate(async()=>{const req=indexedDB.open('pulso-web-local-v1');const db=await new Promise(r=>req.onsuccess=()=>r(req.result));const tx=db.transaction([...db.objectStoreNames]);const result={};await Promise.all([...db.objectStoreNames].filter(k=>['assets','tracks','playlists','chunks','jobs'].includes(k)).map(k=>new Promise(r=>{const q=tx.objectStore(k).getAll();q.onsuccess=()=>{result[k]=q.result;r();};})));db.close();for(const rows of Object.values(result))for(let i=0;i<rows.length;i++)if(rows[i] instanceof Uint8Array){const b=rows[i];rows[i]={R124nativeBytes:b.byteLength,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('')};}return result;});for(const k of Object.keys(after))assert.deepEqual(after[k],before.stores[k].map(([,v])=>v));
 await page.close();return {nativeUpgradeThenProductVersionError:true,DBCloseReadyCycle:'not exercised: terminal schema change requires reload',unmount:'page close native context; no root unmount mutator'};
 });
 await group('16 public client TTL at exact 15min with page Date fixture and timers not advanced',async()=>{
  await fresh();const epoch=Date.UTC(2030,0,1);await page.clock.setFixedTime(epoch);await auth();await page.locator('.telegram-sources input[type=checkbox]').first().check();await button('Usar estas fuentes en esta pestaña').click();await page.waitForFunction(()=>R124.source().state.selected.length===1);
  await saveHandler('ttlOld','Consultar fuentes');await page.evaluate(()=>{R124.captures.ttl=R124.source().client.captureSourcesCurrent();});assert.equal(await guard('ttl'),true);const n=noRPC();await page.clock.setFixedTime(epoch+899999);assert.equal(await guard('ttl'),true);await page.clock.setFixedTime(epoch+900000);assert.equal(await guard('ttl'),false);const state=await page.evaluate(()=>R124.source().client.sourcesSnapshot());assert.deepEqual(state.selected,[]);assert.deepEqual(state.rows,[]);assert.equal(state.error,'expired');await callHandler('ttlOld');assert.equal(noRPC(),n);await query(rawPage({end:true}));assert.equal(noRPC(),n+1);assert.equal(await guard('ttl'),false);await preserve();return {fixture:'Page Date only; native worker clock and timeout/settlement unchanged',blockedTimers:'15min wall time never elapsed; no TTL cleanup callback advanced'};
 });
 await context.close();setContext(null);
}
