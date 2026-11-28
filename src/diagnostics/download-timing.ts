/** Closed timing projections shared by the app and its workers. */
import {plain} from './contract';

export const networkTimingKeys=['resolveMs','sendMs','searchPollMs','searchReads','callbackMs','callbackPollMs','callbackReads','transferMs','bytes','parts','otherDc'] as const;
export const importTimingKeys=['analysisMs','writeMs','verifyMs','metadataMs','backend'] as const;
export const downloadTimingKeys=['totalMs','waitMs','refreshMs','kBps','result',...networkTimingKeys,...importTimingKeys] as const;
export const emptyNetworkTiming=()=>({resolveMs:0,sendMs:0,searchPollMs:0,searchReads:0,callbackMs:0,callbackPollMs:0,callbackReads:0,transferMs:0,bytes:0,parts:0,otherDc:null as boolean|null});
export const emptyImportTiming=()=>({analysisMs:0,writeMs:0,verifyMs:0,metadataMs:0,backend:null as 'opfs'|'idb'|null});
export type NetworkTiming=ReturnType<typeof emptyNetworkTiming>&{firstBotReplyMs?:number};
export type ImportTiming=ReturnType<typeof emptyImportTiming>;
export type DownloadResult='received'|'saved'|'failed'|'uncertain'|'cancelled';
export type DownloadTiming=ReturnType<typeof emptyNetworkTiming>&ImportTiming&{totalMs:number;waitMs:number;refreshMs:number;kBps:number;result:DownloadResult};
export const elapsedMs=(start:number)=>Math.round(Math.max(0,performance.now()-start));
export async function measure<T>(report:(ms:number)=>void,work:()=>Promise<T>):Promise<T>{
 const start=performance.now();try{return await work();}finally{report(elapsedMs(start));}
}
function timing(value:unknown,keys:readonly string[]){
 const row=plain(value,keys);if(!row)return null;
 for(const key of keys){
  const v=row[key];
  if(key==='otherDc'?v!==null&&typeof v!=='boolean':key==='backend'?v!==null&&v!=='idb'&&v!=='opfs':
   key==='result'?typeof v!=='string'||!['received','saved','failed','uncertain','cancelled'].includes(v):
   typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1024**3)return null;
 }
 return Object.freeze(row);
}
export const parseNetworkTiming=(value:unknown)=>timing(value,value&&typeof value==='object'&&Object.hasOwn(value,'firstBotReplyMs')?[...networkTimingKeys,'firstBotReplyMs']:networkTimingKeys) as Readonly<NetworkTiming>|null;
export const parseImportTiming=(value:unknown)=>timing(value,importTimingKeys) as Readonly<ImportTiming>|null;
export const parseDownloadTiming=(value:unknown)=>timing(value,downloadTimingKeys) as Readonly<DownloadTiming>|null;
