import type {CatalogId} from '../library/catalog-id';
import {musicBrainzId} from '../library/catalog-id';
import {copyLibraryDownloadCheckpoint} from '../library/library-download-checkpoint';
import type {LibraryDownloadRequest} from '../library/library-download';
import type {SongChoice} from '../library/selected-song';
import type {UpdateTarget} from './automatic-update';

type DownloadAction=
 | {kind:'library';request:LibraryDownloadRequest;checkpointId?:string;automatic?:boolean}
 | {kind:'repair';trackId:string;title:string;retry:'safe'|'preserve'}
 | {kind:'song';choice:SongChoice}
 | {kind:'album';editionId:CatalogId;title:string;artist:string};

const key='pulso-shell:download-intent:v1';
const lifetime=90_000;
const isId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const title=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=640;
function validAction(action:DownloadAction):boolean{
 switch(action?.kind){
  case 'library': {
   const request=action.request;
   return !!request&&title(request.title)&&typeof request.play==='boolean'&&request.repair===undefined&&
    !!copyLibraryDownloadCheckpoint({...request,cursor:0,pending:null})&&
    (!request.play||request.trackIds.length===1)&&
    (action.automatic===undefined||action.automatic===true&&!!action.checkpointId)&&
    (action.checkpointId===undefined||!request.play&&isId(action.checkpointId));
  }
  case 'repair':return isId(action.trackId)&&title(action.title)&&['safe','preserve'].includes(action.retry);
  case 'album':return (musicBrainzId(action.editionId)||typeof action.editionId==='number'&&Number.isSafeInteger(action.editionId)&&action.editionId>0)&&title(action.title)&&title(action.artist);
  case 'song': {
   const choice=action.choice;
   return !!choice&&['local','itunes','musicbrainz','lrclib','spotify'].includes(choice.source)&&title(choice.id)&&title(choice.title)&&
    (choice.artist===null||title(choice.artist))&&(choice.album===null||title(choice.album))&&
    (choice.displayTitle===undefined||title(choice.displayTitle))&&(choice.searchArtist===undefined||title(choice.searchArtist))&&
    (choice.duration===null||Number.isFinite(choice.duration)&&choice.duration>=0);
  }
  default:return false;
 }
}

export function createDownloadIntentStore(session:Pick<Storage,'getItem'|'setItem'|'removeItem'>,bundle:string,now=Date.now){
 function save(account:string,action:DownloadAction,target:UpdateTarget){
  if(!isId(account)||!validAction(action))throw Error('Invalid download to resume');
  const raw=JSON.stringify({account,action,bundle:target.bundle,expires:now()+lifetime});
  session.setItem(key,raw);
  return ()=>{try{if(session.getItem(key)===raw)session.removeItem(key);}catch{/* The intent expires on its own. */}};
 }
 function discard(account:string,target:UpdateTarget){
  try{
   const raw=session.getItem(key);
   if(!raw||raw.length>200_000)return;
   const item=JSON.parse(raw);
   if(item?.account===account&&item.bundle===target.bundle)session.removeItem(key);
  }catch{/* Storage can be unavailable. */}
 }
 function read(account:string){
  try{
   const raw=session.getItem(key);
   if(raw===null)return null;
   const item=raw.length<=200_000?JSON.parse(raw):null;
   if(!item||!Number.isSafeInteger(item.expires)||item.expires<=now()||item.expires>now()+lifetime||!validAction(item.action)){
    session.removeItem(key);return null;
   }
   return item.account===account&&item.bundle===bundle?item.action as DownloadAction:null;
  }catch{return null;}
 }
 function take<K extends DownloadAction['kind']>(account:string,kind:K){
  const action=read(account);
  if(action?.kind!==kind)return null;
  try{session.removeItem(key);return action as Extract<DownloadAction,{kind:K}>;}
  catch{return null;}
 }
 return {save,discard,read,take};
}

type BeforeDownload=(current:()=>boolean,remember:(target:UpdateTarget)=>()=>void,discard:(target:UpdateTarget)=>void)=>Promise<boolean>;
let host:{beforeDownload:BeforeDownload;store:ReturnType<typeof createDownloadIntentStore>}|undefined;
export function installDownloadUpdates(beforeDownload:BeforeDownload,bundle:string){
 host={beforeDownload,store:createDownloadIntentStore({
  getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key),
 },bundle)};
}
export async function downloadWithCurrentApp(account:string|undefined,action:DownloadAction,current:()=>boolean){
 if(!current())return false;
 if(!host)return true;
 if(!account)return false;
 const {beforeDownload,store}=host;
 return await beforeDownload(current,target=>store.save(account,action,target),target=>store.discard(account,target))&&current();
}
export function pendingDownloadAfterUpdate(account:string|undefined){
 return account?host?.store.read(account):null;
}
export function takeDownloadAfterUpdate<K extends DownloadAction['kind']>(account:string|undefined,kind:K){
 return account?host?.store.take(account,kind):null;
}

// Consuming a song or album intent removes it from sessionStorage before its
// metadata and local copies are ready. Keep its priority during that gap.
const resolvingHandoffs=new Map<string,object>();
const handoffListeners=new Set<()=>void>();
export function subscribeDownloadHandoffs(listener:()=>void){
 handoffListeners.add(listener);
 return ()=>{handoffListeners.delete(listener);};
}
export function reserveDownloadHandoff(account:string){
 const token={};resolvingHandoffs.set(account,token);
 return ()=>{
  if(resolvingHandoffs.get(account)!==token)return;
  resolvingHandoffs.delete(account);
  for(const notify of handoffListeners)notify();
 };
}
export function downloadHandoffInProgress(account:string){return resolvingHandoffs.has(account);}
