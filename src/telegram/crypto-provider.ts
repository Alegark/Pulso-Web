import type {ICryptoProvider,IAesCtr,IEncryptionScheme} from '@mtcute/core/utils.js';
import {WebCryptoProvider} from '@mtcute/web';
import {__getWasm} from '@mtcute/wasm';
import {createCheckedGunzip} from './checked-gunzip.mjs';
type Checked=((input:Uint8Array)=>Uint8Array)&{readonly terminal:boolean};
/** All forwarding, including retained/async capabilities, shares this single fence. */
export function completeFacade(provider:ICryptoProvider,checked:Checked):ICryptoProvider {
 let retired=false;
 const live=()=>{if(retired)throw Error('adapter-retired');};
 const observe=(error:unknown)=>{try{if(error instanceof WebAssembly.RuntimeError)retired=true;}catch{retired=true;}};
 const sync=<T>(fn:()=>T):T=>{live();try{const value=fn();live();return value;}catch(e){observe(e);throw e;}finally{if(checked.terminal)retired=true;}};
 const asyncCall=async<T>(fn:()=>T|PromiseLike<T>):Promise<T>=>{live();try{const value=await fn();live();return value;}catch(e){observe(e);throw e;}finally{if(checked.terminal)retired=true;}};
 return Object.freeze({
  initialize:()=>sync(()=>undefined), // openCrypto has already initialized the one SDK instance
  sha1:(d:Uint8Array)=>sync(()=>provider.sha1(d)),sha256:(d:Uint8Array)=>sync(()=>provider.sha256(d)),
  pbkdf2:(...a:Parameters<ICryptoProvider['pbkdf2']>)=>asyncCall(()=>provider.pbkdf2(...a)),
  hmacSha256:(...a:Parameters<ICryptoProvider['hmacSha256']>)=>asyncCall(()=>provider.hmacSha256(...a)),
  factorizePQ:(d:Uint8Array)=>asyncCall(()=>provider.factorizePQ(d)),
  randomFill:(d:Uint8Array)=>sync(()=>provider.randomFill(d)),randomBytes:(n:number)=>sync(()=>provider.randomBytes(n)),
  gzip:(d:Uint8Array,n:number)=>sync(()=>provider.gzip(d,n)),gunzip:(d:Uint8Array)=>sync(()=>checked(d)),
  createAesCtr:(key:Uint8Array,iv:Uint8Array,encrypt:boolean):IAesCtr=>sync(()=>{const ctx=provider.createAesCtr(key,iv,encrypt);return Object.freeze({process:(d:Uint8Array)=>sync(()=>ctx.process(d)),close:()=>sync(()=>ctx.close?.())});}),
  createAesIge:(key:Uint8Array,iv:Uint8Array):IEncryptionScheme=>sync(()=>{const ctx=provider.createAesIge(key,iv);return Object.freeze({encrypt:(d:Uint8Array)=>sync(()=>ctx.encrypt(d)),decrypt:(d:Uint8Array)=>sync(()=>ctx.decrypt(d))});}),
 });
}
let opened=false;
export async function openCrypto(module:WebAssembly.Module):Promise<ICryptoProvider>{
 if(opened)throw Error('realm-already-used');opened=true;
 if(WebAssembly.Module.imports(module).length)throw Error('wasm-imports');
 const dedicated=new WebAssembly.Instance(module).exports;
 const checked=createCheckedGunzip(dedicated) as Checked;
 const provider=new WebCryptoProvider({wasmInput:module});await provider.initialize();
 if(__getWasm().memory===dedicated.memory)throw Error('instance-separation');
 return completeFacade(provider,checked);
}
