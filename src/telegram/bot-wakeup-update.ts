// A push is just a wake-up hint. Never retain it, use a message ID from it,
// or project it into the trusted getHistory result.
function own(value:unknown,key:string):unknown {
 return value!==null&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
}
function incoming(value:object):boolean {
 const flag=Object.getOwnPropertyDescriptor(value,'out');
 return !flag||('value' in flag&&(flag.value===undefined||flag.value===false));
}

export function isBotWakeupUpdate(raw:unknown,botId:number):boolean {
 if(!Number.isSafeInteger(botId)||botId<=0)return false;
 try{
  const kind=own(raw,'_');
  if(kind==='updateShortMessage')return own(raw,'userId')===botId&&incoming(raw as object);
  const isBotPeer=(peer:unknown)=>own(peer,'_')==='peerUser'&&own(peer,'userId')===botId;
  const matches=(update:unknown)=>{
   const type=own(update,'_');
   if(type!=='updateNewMessage'&&type!=='updateEditMessage')return false;
   const message=own(update,'message');
   if(!message||typeof message!=='object'||own(message,'_')!=='message'||!incoming(message)||!isBotPeer(own(message,'peerId')))return false;
   const sender=Object.getOwnPropertyDescriptor(message,'fromId');
   return !sender||('value' in sender&&(sender.value===undefined||isBotPeer(sender.value)));
  };
  if(kind==='updateShort')return matches(own(raw,'update'));
  if(kind!=='updates'&&kind!=='updatesCombined')return false;
  const updates=own(raw,'updates');
  if(!Array.isArray(updates))return false;
  const length=own(updates,'length');
  if(typeof length!=='number'||!Number.isSafeInteger(length))return false;
  for(let i=0;i<Math.min(length,64);i++)if(matches(own(updates,String(i))))return true;
 }catch{/* Optional signal from untrusted network content. */}
 return false;
}
