import type {CatalogId} from './catalog-id';
import {copyLibraryDownloadCheckpoint} from './library-download-checkpoint';
import type {LibraryDownloadRequest} from './library-download';
import {copySavedAlbum,type SavedAlbum} from './saved-albums';

export type CollectionDownloadJob=
 | {kind:'album';id:string;key:string;title:string;album:SavedAlbum}
 | {kind:'library';id:string;key:string;title:string;request:LibraryDownloadRequest};

export const albumDownloadKey=(id:CatalogId)=>'album:'+id;
export const libraryDownloadKey=(key:string)=>'library:'+key;
export const collectionQueueStorageKey=(account:string)=>'pulso:collection-download-queue:v1:'+account;
const limit=50;

function copyJob(value:unknown):CollectionDownloadJob|null{
 const job=value as CollectionDownloadJob|null;
 if(!job||typeof job.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(job.id)||typeof job.key!=='string'||job.key.length>1000||typeof job.title!=='string'||!job.title||job.title.length>640)return null;
 if(job.kind==='album'){
  const album=copySavedAlbum(job.album);
  return album&&job.key===albumDownloadKey(album.edition.id)?{kind:'album',id:job.id,key:job.key,title:album.edition.title,album}:null;
 }
 if(job.kind!=='library'||!job.key.startsWith('library:')||job.request?.play!==false)return null;
 const request=copyLibraryDownloadCheckpoint({...job.request,cursor:0,pending:null});
 if(!request||request.id!==job.id||request.title!==job.title)return null;
 return {kind:'library',id:job.id,key:job.key,title:job.title,request:{id:request.id,title:job.title,trackIds:request.trackIds,play:false}};
}

export function createCollectionDownloadQueue(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,account:string){
 const key=collectionQueueStorageKey(account);
 const read=():CollectionDownloadJob[]=>{
  const raw=storage.getItem(key);
  if(!raw)return [];
  const rows:unknown=JSON.parse(raw);
  if(!Array.isArray(rows)||rows.length>limit)throw Error('Invalid download queue');
  const jobs=new Map<string,CollectionDownloadJob>();
  for(const value of rows){
   const job=copyJob(value);
   if(job&&!jobs.has(job.key))jobs.set(job.key,job);
  }
  return [...jobs.values()];
 };
 const write=(jobs:CollectionDownloadJob[])=>{
  if(jobs.length)storage.setItem(key,JSON.stringify(jobs));
  else storage.removeItem(key);
 };
 return {
  read,
  add(value:CollectionDownloadJob){
   const job=copyJob(value),jobs=read();
   if(!job)throw Error('Invalid queued collection');
   const position=jobs.findIndex(item=>item.key===job.key);
   if(position>=0)return position+1;
   if(jobs.length>=limit)throw Error('Full download queue');
   jobs.push(job);write(jobs);return jobs.length;
  },
  remove(key:string,expectedId?:string){
   const jobs=read(),next=jobs.filter(job=>job.key!==key||expectedId!==undefined&&job.id!==expectedId);
   if(jobs.length!==next.length)write(next);
  },
 };
}
