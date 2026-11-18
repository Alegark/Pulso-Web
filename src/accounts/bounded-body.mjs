// Shared by the account client and the Worker. The cap applies to streamed
// bytes even when Content-Length is missing or understates the decoded body.
export class BodyLimitError extends Error {
 constructor(){super('body-limit');}
}
export async function readBoundedBody(message,max,signal){
 if(!message.body)throw Error('body');
 if(Number(message.headers.get('content-length'))>max){
  void message.body.cancel().catch(()=>{});
  throw new BodyLimitError();
 }
 const reader=message.body.getReader(),parts=[];
 const cancel=()=>{void reader.cancel().catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 let length=0,complete=false;
 try{
  while(true){
   if(signal?.aborted)throw Error('aborted');
   const {done,value}=await reader.read();
   if(signal?.aborted)throw Error('aborted');
   if(done){complete=true;break;}
   length+=value.byteLength;
   if(length>max||parts.length>=8192)throw new BodyLimitError();
   parts.push(value);
  }
 }finally{
  signal?.removeEventListener('abort',cancel);
  if(!complete)cancel();
  reader.releaseLock();
 }
 if(parts.length===1)return parts[0];
 const bytes=new Uint8Array(length);
 let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return bytes;
}
export async function readBoundedText(message,max,signal,fatal=true){
 return new TextDecoder('utf-8',{fatal}).decode(await readBoundedBody(message,max,signal));
}
export async function readBoundedJson(message,max,signal){
 return JSON.parse(await readBoundedText(message,max,signal));
}
