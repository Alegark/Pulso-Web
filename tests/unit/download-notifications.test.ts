import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDownloadNotifications,type NotificationHost} from '../../src/pwa/download-notifications';
function fixture(){let permission:NotificationPermission='default',enabled=false,time=0,requests=0,closed=0;const shown:{title:string;options:NotificationOptions}[]=[];const reg={active:{},showNotification:async(title:string,options:NotificationOptions)=>{shown.push({title,options});},getNotifications:async()=>[{tag:'pulso-download-song',close:()=>closed++},{tag:'other',close:()=>{throw Error('foreign');}}]};const host:NotificationHost={support:()=> 'ready',permission:()=>permission,request:async()=>{requests++;return permission='granted';},registration:async()=>reg,read:()=>enabled,write:v=>{enabled=v;},now:()=>time};return {host,reg,shown,setPermission:(p:NotificationPermission)=>permission=p,tick:()=>time+=16000,requests:()=>requests,closed:()=>closed};}
test('No permission prompt or delivery before explicit activation',async()=>{const f=fixture(),n=createDownloadNotifications(f.host);n.notify('song','a','Song','Loading');await n.settled();assert.equal(f.requests(),0);assert.equal(f.shown.length,0);assert.equal(await n.enable(),true);assert.equal(f.requests(),1);assert.equal(n.state().enabled,true);});
test('iOS browser tab and unsupported browser never prompt',async()=>{for(const support of ['install-ios','unsupported'] as const){const f=fixture();f.host.support=()=>support;const n=createDownloadNotifications(f.host);assert.equal(await n.enable(),false);assert.equal(f.requests(),0);}});
test('Dismissal and denial do not enable',async()=>{for(const permission of ['default','denied'] as const){const f=fixture();f.host.request=async()=>permission;const n=createDownloadNotifications(f.host);assert.equal(await n.enable(),false);assert.equal(n.state().enabled,false);}});
test('Progress replaces same tag, throttles, and terminal result bypasses throttle',async()=>{const f=fixture(),n=createDownloadNotifications(f.host);await n.enable();n.notify('album','a','Album','0/3');await n.settled();n.notify('album','a','Album','1/3');await n.settled();assert.equal(f.shown.length,1);f.tick();n.notify('album','a','Album','2/3');await n.settled();n.notify('album','a','Album','3/3',true);await n.settled();assert.deepEqual(f.shown.map(x=>x.options.body),['0/3','2/3','3/3']);assert.equal(new Set(f.shown.map(x=>x.options.tag)).size,1);assert.equal(f.shown.at(-1)?.options.silent,false);n.notify('album','a','Album','again',true);await n.settled();assert.equal(f.shown.length,3);});
test('Disable cancels pending notifications and only closes Pulso downloads',async()=>{const f=fixture(),n=createDownloadNotifications(f.host);await n.enable();n.notify('song','a','Song','Loading');n.disable();await n.settled();await new Promise(r=>setTimeout(r,0));assert.equal(f.shown.length,0);assert.equal(f.closed(),1);assert.equal(n.state().enabled,false);});
test('Revoked permission and stale or throwing scope cannot publish',async()=>{const f=fixture(),n=createDownloadNotifications(f.host);await n.enable();n.notify('song','a','Song','Loading',false,()=>{throw Error('retired');});let live=true;n.notify('song','b','Song','Loading',false,()=>live);live=false;await n.settled();assert.equal(f.shown.length,0);f.setPermission('denied');n.notify('song','c','Song','Loading');await n.settled();assert.equal(f.shown.length,0);});
test('Notification rejection is isolated from music and exposes fallback feedback',async()=>{const f=fixture();f.reg.showNotification=async()=>{throw Error('not supported');};const n=createDownloadNotifications(f.host);await n.enable();n.notify('song','a','Song','Loading');await n.settled();assert.match(n.state().error!,/dentro de Pulso/);});
test('Disable wins over late permission response',async()=>{const f=fixture();let resolve!:(p:NotificationPermission)=>void;f.host.request=()=>new Promise(r=>resolve=r);const n=createDownloadNotifications(f.host),pending=n.enable();n.disable();resolve('granted');assert.equal(await pending,false);assert.equal(n.state().enabled,false);});
test('Retiring an old song cannot dismiss a newer song notice',async()=>{const f=fixture(),n=createDownloadNotifications(f.host);await n.enable();n.notify('song','new','New','Loading');await n.settled();n.dismiss('song','old');await new Promise(r=>setTimeout(r,0));assert.equal(f.closed(),0);n.dismiss('song','new');await new Promise(r=>setTimeout(r,0));assert.equal(f.closed(),1);});
test('Permission revoked while obtaining the worker blocks late delivery',async()=>{const f=fixture(),n=createDownloadNotifications(f.host);await n.enable();let release!:(r:typeof f.reg)=>void;f.host.registration=()=>new Promise(r=>release=r);n.notify('song','late','Song','Loading');await new Promise(r=>setTimeout(r,0));f.setPermission('denied');release(f.reg);await n.settled();assert.equal(f.shown.length,0);});


test('Consent survives reload while a worker is installing',async()=>{
 const f=fixture();
 f.host.registration=async()=>undefined;
 const original=createDownloadNotifications(f.host);
 assert.equal(await original.enable(),true);
 await Promise.resolve();
 assert.equal(original.state().worker,'waiting');
 assert.equal(f.host.read(),true);
 const reloaded=createDownloadNotifications(f.host);
 reloaded.refresh();
 assert.equal(reloaded.state().preferred,true);
 reloaded.notify('song','a','Song','Waiting');
 await reloaded.settled();
 assert.equal(f.shown.length,0);
 f.host.registration=async()=>f.reg;
 reloaded.refresh();
 await Promise.resolve();
 assert.equal(reloaded.state().worker,'ready');
 reloaded.notify('song','a','Song','Waiting');
 await reloaded.settled();
 assert.equal(f.shown.length,1);
 assert.equal(f.requests(),1);
});
test('Foreground permission updates leave local preference intact and disabling survives reload',async()=>{
 const f=fixture(),n=createDownloadNotifications(f.host);
 await n.enable();
 f.setPermission('denied');n.refresh();
 assert.equal(n.state().enabled,false);assert.equal(n.state().preferred,true);assert.equal(f.host.read(),true);
 assert.equal(await n.enable(),false);assert.equal(f.requests(),1);
 f.setPermission('default');f.host.request=async()=>'default';
 assert.equal(await n.enable(),false);assert.equal(f.host.read(),true);
 f.setPermission('granted');n.refresh();assert.equal(n.state().enabled,true);
 n.disable();
 assert.equal(createDownloadNotifications(f.host).state().enabled,false);
 assert.equal(await createDownloadNotifications(f.host).enable(),true);
 assert.equal(f.requests(),1);
});
test('A failed opt-out write still suppresses alerts after foreground refresh',async()=>{
 const f=fixture(),n=createDownloadNotifications(f.host);await n.enable();
 f.host.write=()=>{throw Error('storage');};
 n.disable();n.refresh();
 assert.equal(n.state().preferred,false);
 n.test();await n.settled();assert.equal(f.shown.length,0);
 assert.match(n.state().error!,/No se pudo guardar/);
});


test('Collection pause has its own tag and a terminal body identical to progress still publishes once',async()=>{
 const f=fixture(),n=createDownloadNotifications(f.host);await n.enable();
 n.notify('album','album','Álbum','Preparando');await n.settled();
 n.notify('collection','playlist','Lista','1 de 2 guardadas');await n.settled();
 n.notify('collection','playlist','Lista','Telegram pide esperar 5 min',false,()=>true,true);await n.settled();
 n.notify('collection','playlist','Lista','2 de 2 guardadas');await n.settled();
 f.tick();n.notify('collection','playlist','Lista','2 de 2 guardadas');await n.settled();
 n.notify('collection','playlist','Lista','2 de 2 guardadas',true);await n.settled();
 n.notify('collection','playlist','Lista','2 de 2 guardadas',true);await n.settled();
 assert.deepEqual(f.shown.map(({options})=>[options.tag,options.body,options.silent]),[
  ['pulso-download-album','Preparando',true],
  ['pulso-download-collection','1 de 2 guardadas',true],
  ['pulso-download-collection','Telegram pide esperar 5 min',true],
  ['pulso-download-collection','2 de 2 guardadas',true],
  ['pulso-download-collection','2 de 2 guardadas',false],
 ]);
});

test('collection completion and pause publish immediately while the page is hidden',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'hidden'}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');});
 const f=fixture(),n=createDownloadNotifications(f.host);await n.enable();
 n.collectionOutcome('finished','Lista','finished',4,4,()=>true,'a');await n.settled();
 n.collectionOutcome('paused','Lista','paused',2,4,()=>true,'a');await n.settled();
 n.collectionOutcome('stale','Lista','paused',2,4,()=>false,'b');await n.settled();
 assert.deepEqual(f.shown.map(({options})=>[options.silent,options.body]),[
  [false,'4 de 4 guardadas'],[false,'2 de 4 guardadas · abre Pulso para continuar'],
 ]);
});

test('orphan cleanup only closes collection progress from the current account',async()=>{
 const f=fixture(),closed:number[]=[];
 const notices=[
  {tag:'pulso-download-collection',data:{account:'a',terminal:false}},
  {tag:'pulso-download-collection',silent:true,data:{account:'a',terminal:true}},
  {tag:'pulso-download-collection',data:{account:'b',terminal:false}},
  {tag:'pulso-download-collection',silent:true},
  {tag:'pulso-download-song',silent:true},
 ];
 f.host.registration=async()=>({...f.reg,getNotifications:async()=>notices.map((notice,index)=>({...notice,close:()=>closed.push(index)}))});
 const n=createDownloadNotifications(f.host);
 n.clearProgress('collection','a',()=>false);await n.settled();assert.deepEqual(closed,[]);
 n.clearProgress('collection','a',()=>true);await n.settled();assert.deepEqual(closed,[0]);
});
