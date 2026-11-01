import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {AppFailure,atBoundary,fail,fromKnownError,issuedFailure,makeFailure,nativeDOMName,missingAssetException,type FailureV1} from '../errors/app-failure';
import {readRecord} from './database';
import type {LocalAsset} from '../library/library';
export const ASSET_DIRECTORY='pulso-assets-v1';
export const WRITER_LOCK='pulso-web:local:asset-writer';
export const generationLock=(asset:Pick<LocalAsset,'backend'|'storageKey'>)=>`pulso-web:local:asset:${asset.backend}:${asset.storageKey}`;
export async function assetDirectory(){return atBoundary('open','opfs',async()=>(await navigator.storage.getDirectory()).getDirectoryHandle(ASSET_DIRECTORY,{create:true}));}
export type ReadVerificationV1={state:'valid';failure:null}|{state:'missing'|'corrupt'|'unknown';failure:FailureV1};
export interface AssetReader {
 readonly asset:LocalAsset;
 verify(integrity?:boolean):Promise<boolean>;
 /** Optional scan consumes the already hashed chunks synchronously, under the
  * caller's lock. Consumers must not mutate bytes, reenter, or return promises.
  * onChunk requires integrity=true; otherwise unknown/input-invalid, no reads.
  * check may guard presence-only verification without adding OPFS byte reads.
  */
 verifyDetailed(integrity?:boolean,scan?:{check?:()=>void;onChunk?:(bytes:Uint8Array)=>void}):Promise<ReadVerificationV1>;
 readRange(start:number,end:number):Promise<Uint8Array>;
 release():void;
}
export function verificationFailure(error:unknown,backend:LocalAsset['backend']):ReadVerificationV1 {
 const f=fromKnownError(error,{phase:'verify',backend});
 return {state:f.code==='asset-missing'?'missing':['length-mismatch','digest-mismatch','local-corrupt'].includes(f.code)?'corrupt':'unknown',failure:f};
}
// Lock lifetime belongs to the caller, including verification failures.
export async function openAssetReader(asset:LocalAsset,current=true,control?:{signal:AbortSignal}):Promise<AssetReader> {
 let unlock:(()=>void)|undefined;
 let acquired!:()=>void, rejected!:(error:unknown)=>void;
 const ready=new Promise<void>((resolve,reject)=>{acquired=resolve;rejected=reject;});
 // Only this request's pending acquisition is abortable. A delivered shared
 // lock remains ours until release; cancelling never touches other readers.
 const held=navigator.locks.request(generationLock(asset),{mode:'shared',...(control?{signal:control.signal}:{})},async()=>{
  await new Promise<void>(resolve=>{unlock=resolve;acquired();});
 });
 void held.catch(rejected);
 await atBoundary('open',asset.backend,()=>ready);
 let released=false;
 const release=()=>{if(!released){released=true;unlock?.();}};
 const checkSignal=()=>{if(control?.signal.aborted)fail('open','internal','cancelled',asset.backend);};
 try{
 checkSignal();
 if(current){const now=await atBoundary('read','idb',()=>readRecord<LocalAsset>('assets',asset.id));if(!now||now.revision!==asset.revision||now.backend!==asset.backend||now.storageKey!==asset.storageKey)fail('open','integrity','asset-changed',asset.backend);}
 checkSignal();
 let file:File|null=null;
 if(asset.backend==='opfs'){
 try{
 const root=await navigator.storage.getDirectory();
 const directory=await root.getDirectoryHandle(ASSET_DIRECTORY,{create:false});
 file=await(await directory.getFileHandle(asset.storageKey,{create:false})).getFile();
 }
 catch(error){if(nativeDOMName(error)==='NotFoundError')throw missingAssetException();throw issuedFailure(error)?error:AppFailure.create(fromKnownError(error,{phase:'open',backend:asset.backend}));}
 }
 checkSignal();
 const readRange=async(start:number,end:number)=>atBoundary('read',asset.backend,async()=>{
 if(released)fail('read','internal','input-invalid',asset.backend);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>asset.bytes||end-start>65536)fail('read','internal','input-invalid',asset.backend);
 if(file){const bytes=new Uint8Array(await file.slice(start,end).arrayBuffer());if(bytes.length!==end-start)fail('read','integrity','length-mismatch','opfs');return bytes;}
 const parts:Uint8Array[]=[];let length=0;
 for(let i=Math.floor(start/65536);i<=Math.floor((end-1)/65536);i++){
 const chunk=await readRecord<unknown>('chunks',[asset.storageKey,i]);
 if(chunk===undefined)fail('read','integrity','asset-missing','idb');
 if(!(chunk instanceof Uint8Array))fail('read','integrity','local-corrupt','idb');
 if(chunk.length!==Math.min(65536,asset.bytes-i*65536))fail('read','integrity','length-mismatch','idb');
 const part=chunk.slice(Math.max(0,start-i*65536),Math.min(chunk.length,end-i*65536));parts.push(part);length+=part.length;
 }
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
 });
 const verifyDetailed=async(integrity=true,scan?:{check?:()=>void;onChunk?:(bytes:Uint8Array)=>void}):Promise<ReadVerificationV1>=>{
 // Internal synchronous consumers only. Callback failures are not evidence of
 // missing/corrupt storage; preserve issued guards, otherwise report unknown.
 const callback=(work:()=>void)=>{try{work();}catch(error){
 const guard=issuedFailure(error);
 // Only issued control guards describe this boundary. A consumer cannot
 // establish missing bytes, corrupt storage, or native storage IO failure.
 throw guard&&(guard.code==='cancelled'||guard.code==='owner-unavailable')?error:AppFailure.create(makeFailure('verify','internal','unknown',asset.backend));
 }};
 const check=()=>{if(scan?.check)callback(scan.check);};
 try{
 check();
 if(released)fail('verify','internal','input-invalid',asset.backend);
 // Presence-only OPFS must never acquire a hidden byte-reading pass.
 if(!integrity&&scan?.onChunk)fail('verify','internal','input-invalid',asset.backend);
 if(file&&file.size!==asset.bytes)fail('verify','integrity','length-mismatch',asset.backend);
 const hash=integrity?sha256.create():null;
 // One pass; OPFS presence-only retains its previous no-read behavior.
 if(hash||!file)for(let offset=0;offset<asset.bytes;offset+=65536){
 check();const bytes=await readRange(offset,Math.min(offset+65536,asset.bytes));check();hash?.update(bytes);
 if(scan?.onChunk){check();callback(()=>scan.onChunk!(bytes));}
 }
 check();
 if(hash&&bytesToHex(hash.digest())!==asset.sha256)fail('verify','integrity','digest-mismatch',asset.backend);
 check();return {state:'valid',failure:null};
 }catch(error){return verificationFailure(error,asset.backend);}
 };
 return {asset,release,readRange,verifyDetailed,async verify(integrity=true){return (await verifyDetailed(integrity)).state==='valid';}};
 }catch(error){release();throw error;}
}
