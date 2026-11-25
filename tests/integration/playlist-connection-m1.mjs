import {setTimeout as pause} from 'node:timers/promises';
import {WebSocketServer} from 'ws';

export const connectionPath='/__playlist-m1-updates';
export const verificationIdleMs=3_000;
const syntheticHandshakeMs=150;
async function observe(condition,timeout=5_000){
 const deadline=Date.now()+timeout;
 while(!condition()&&Date.now()<deadline)await pause(25);
 return condition();
}

export function installConnectionFixture(server){
 const wss=new WebSocketServer({noServer:true});
 let current;
 server.on('upgrade',(req,socket,head)=>{
  if(req.url!==connectionPath||!current)return;
  wss.handleUpgrade(req,socket,head,peer=>current.add(peer));
 });
 return {
  start(){
   const peers=new Set(),events=[];
   const count=type=>events.filter(value=>value===type).length;
   current={
    add(peer){
     peers.add(peer);
     peer.on('error',()=>{});
     peer.on('close',()=>{peers.delete(peer);events.push('closed');});
     peer.on('message',raw=>{
      const kind=raw.toString();
      if(kind==='processed'){events.push(kind);return;}
      if(kind!=='restore'&&kind!=='import'){peer.close();return;}
      events.push(kind);
      void pause(syntheticHandshakeMs).then(()=>{if(peer.readyState===1){peer.send('ready');events.push('ready');}});
     });
    },
    async offerUpdates(count){
     for(let i=0;i<count;i++){
      for(const peer of peers)if(peer.readyState===1)peer.send('test-update');
      await pause(30);
     }
     await pause(100);
    },
    count,
    waitClosed:()=>observe(()=>peers.size===0),
    get connected(){return peers.size;},
    stop(){for(const peer of peers)peer.terminate();current=undefined;},
   };
   return current;
  },
  close(){for(const peer of wss.clients)peer.terminate();wss.close();},
 };
}

export function installVisibilityFixture(){
 window.testM1Visibility=visible=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,value:visible?'visible':'hidden'});
  Object.defineProperty(document,'hidden',{configurable:true,value:!visible});
  if(visible)window.testM1ReturnAt=performance.now();
  document.dispatchEvent(new Event('visibilitychange'));
 };
}

export async function exerciseConnection(page,input,feed,verify){
 const apply=visible=>page.evaluate(value=>window.testM1Visibility(value),visible);
 const settled=()=>page.waitForFunction(()=>document.querySelector('.music-search-catalog')?.getAttribute('aria-busy')==='false');
 await settled();
 const beforeHide=feed.count('processed');
 if(verify){
  await feed.offerUpdates(3);
  await observe(()=>feed.count('processed')===beforeHide+3);
 }
 const awake=feed.count('processed')-beforeHide;
 await apply(false);
 if(!verify)await pause(250);
 const hiddenClosed=verify?await observe(()=>feed.connected===0):feed.connected===0;
 const beforeProbe=feed.count('processed');
 if(verify)await feed.offerUpdates(9);
 const hiddenProcessed=feed.count('processed')-beforeProbe;
 const beforeReturn=feed.count('ready');
 await apply(true);
 if(!verify)await pause(300);
 const foregroundWarm=verify?await observe(()=>feed.count('ready')===beforeReturn+1):feed.count('ready')===beforeReturn+1;
 if(!verify)return {hiddenClosed,foregroundWarm};

 // Each trigger is observed with the search results already on the screen.
 // Blurring does not navigate and typing can also wake an already focused field.
 await input.blur();
 const idleClosed=await observe(()=>feed.connected===0,verificationIdleMs+1500);
 const beforeFocus=feed.count('ready');
 await input.focus();
 const focusWarm=await observe(()=>feed.count('ready')===beforeFocus+1);
 await observe(()=>feed.connected===0,verificationIdleMs+1500);
 const beforeTyping=feed.count('ready');
 const query=await input.inputValue();
 await input.fill(query+' ');
 const typingWarm=await observe(()=>feed.count('ready')===beforeTyping+1);
 await settled();
 const coldAtTap=await observe(()=>feed.connected===0,verificationIdleMs+1500);
 return {awake,hiddenClosed,hiddenProcessed,foregroundWarm,idleClosed,focusWarm,typingWarm,
  coldAtTap,importsBeforeTap:feed.count('import'),restoresBeforeTap:feed.count('restore')};
}
